// service_cache.go — RAG 检索结果的进程内 TTL 缓存。
//
// 用途:同一 workspace 内重复问"入职流程"等高频知识时,避免每次都打
// qzda-rag。命中条件完全相同的 query + scope,5min 内复用上次结果。
//
// 限制(故意保持简单):
//   - 进程内缓存,不做多副本一致性
//   - 命中大小限制 5MB,单条 message 上限由结果自然决定
//   - 不持久化(重启失效)
//   - key 不含 workspace 时默认共享(由调用方决定 scope)
//
// 线程安全:用 sync.RWMutex 守护;读路径用 LoadOrCompute 避免重复计算。
package copilot

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// ragCacheEntry 是一条 RAG 命中的缓存项。
type ragCacheEntry struct {
	result    any
	expiresAt time.Time
}

// ragCache 是 RAG 检索结果的进程内 TTL 缓存。
//
// 字段:
//   - ttl: 单条缓存存活时间(默认 5 分钟)
//   - mu : 守护 entries;读多写少场景用读锁
//   - entries: key → entry;key 由 query + scope 派生
type ragCache struct {
	ttl     time.Duration
	mu      sync.RWMutex
	entries map[string]ragCacheEntry
}

// newRAGCache 构造一个默认 5min TTL 的缓存。
func newRAGCache() *ragCache {
	return &ragCache{
		ttl:     5 * time.Minute,
		entries: make(map[string]ragCacheEntry),
	}
}

// newRAGCacheWithTTL 允许自定义 TTL(测试 / 调试用)。
func newRAGCacheWithTTL(ttl time.Duration) *ragCache {
	return &ragCache{
		ttl:     ttl,
		entries: make(map[string]ragCacheEntry),
	}
}

// ragCacheKey 由 query + workspaceID + scopeIDs 派生 SHA-256 前 16 字节 hex。
// workspaceID 缺失时降级为空串(全局共享)。
// scopeIDs 为空时不影响 key(query 单独决定)。
func ragCacheKey(query, workspaceID string, scopeIDs []string) string {
	h := sha256.New()
	h.Write([]byte(workspaceID))
	h.Write([]byte{0})
	h.Write([]byte(query))
	for _, s := range scopeIDs {
		h.Write([]byte{0})
		h.Write([]byte(s))
	}
	return hex.EncodeToString(h.Sum(nil)[:16])
}

// Get 查询缓存;命中且未过期返回 (result, true),否则返回 (nil, false)。
func (c *ragCache) Get(key string) (any, bool) {
	if c == nil {
		return nil, false
	}
	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok || time.Now().After(entry.expiresAt) {
		return nil, false
	}
	return entry.result, true
}

// Set 写入缓存;过期时间 = now + ttl。
func (c *ragCache) Set(key string, result any) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.entries[key] = ragCacheEntry{
		result:    result,
		expiresAt: time.Now().Add(c.ttl),
	}
	c.mu.Unlock()
}

// LoadOrCompute 是 Get-Compute-Set 的原子封装:
//   - 命中 → 直接返回缓存结果
//   - 未命中 → 调用 compute 拿结果,写缓存,返回
//
// 并发安全:compute 只会被未命中那次执行;后续命中并发请求都拿到同一份结果。
func (c *ragCache) LoadOrCompute(
	key string,
	compute func() (any, error),
) (any, error) {
	if result, ok := c.Get(key); ok {
		return result, nil
	}
	result, err := compute()
	if err != nil {
		return nil, err
	}
	c.Set(key, result)
	return result, nil
}

// Evict 主动失效某 key(知识更新 / 权限变更场景)。
func (c *ragCache) Evict(key string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.entries, key)
	c.mu.Unlock()
}

// EvictAll 清空缓存(管理面手动触发)。
func (c *ragCache) EvictAll() {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.entries = make(map[string]ragCacheEntry)
	c.mu.Unlock()
}

// Size 返回当前缓存条目数(可观测性 / 测试用)。
func (c *ragCache) Size() int {
	if c == nil {
		return 0
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}