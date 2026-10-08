// service_retry.go — LLM / RAG 调用的指数退避重试器。
//
// 适用场景:网络抖动 / 上游 5xx / 超时。重试;处理 4xx 类业务错误
// 由调用方通过 policy.isRetryable 自定义,默认任意非 nil 错误都重试。
//
// 不重试场景:
//   - context 已取消(上游主动中断)
//   - 调用方返回 isRetryable(err) == false
//   - 已达 maxAttempts 上限
//
// 默认 1 + 2 次重试,基数 2s(2s/4s),总耗时上限 ~6s;
// 适合 SSE 流式场景的"再给一次机会",不至于让用户久等。
package copilot

import (
	"context"
	"errors"
	"time"
)

// retryPolicy 是一次调用的重试策略。
//
// 字段:
//   - maxAttempts: 包含首次的最大尝试次数(< 1 时按 1 处理)
//   - baseDelay  : 第一次重试前的等待基数,后续按 2^n 指数退避
//   - isRetryable: 自定义错误分类;nil 时默认"任意错误都重试"
type retryPolicy struct {
	maxAttempts int
	baseDelay   time.Duration
	isRetryable func(error) bool
}

// defaultRetryPolicy 是 copilot 模块的默认策略:
// 1 次首调 + 2 次重试,基数 2s(总等待 2s + 4s = 6s,合理 SSE 容错窗口)。
var defaultRetryPolicy = retryPolicy{
	maxAttempts: 3,
	baseDelay:   2 * time.Second,
	isRetryable: func(err error) bool { return err != nil },
}

// withLLMRetry 把 LLM 流式调用包一层指数退避。
//
// 用法(在 copilot_react.go 等 6 个调用点可替换):
//
//	reply, rt, err := withLLMRetry(ctx, func(ctx context.Context) (string, ResolvedTurn, error) {
//	    return s.Deps.Routing.StreamLLMForCopilotFn(ctx, ...)
//	})
func withLLMRetry(
	ctx context.Context,
	op func(context.Context) (string, ResolvedTurn, error),
) (string, ResolvedTurn, error) {
	return withRetryLLM(ctx, defaultRetryPolicy, op)
}

// withLLMRetryCustom 允许调用方覆盖默认策略(测试 / 性能敏感场景)。
func withRetryLLM(
	ctx context.Context,
	policy retryPolicy,
	op func(context.Context) (string, ResolvedTurn, error),
) (string, ResolvedTurn, error) {
	var (
		reply    string
		resolved ResolvedTurn
	)
	err := withRetry(ctx, policy, func(ctx context.Context) error {
		var callErr error
		reply, resolved, callErr = op(ctx)
		return callErr
	})
	return reply, resolved, err
}

// withRAGRetry 把 RAG 检索调用包一层指数退避。
// 默认 1 + 2 次重试,基数 2s。
func withRAGRetry(
	ctx context.Context,
	op func(context.Context) (any, error),
) (any, error) {
	var result any
	err := withRetry(ctx, defaultRetryPolicy, func(ctx context.Context) error {
		var callErr error
		result, callErr = op(ctx)
		return callErr
	})
	return result, err
}

// withRetry 是通用指数退避器:
//
//  1. 检查 ctx;若已取消,合并最后一次错误返回
//  2. 调用 op;成功即返回
//  3. 失败:若 isRetryable(err) == false 立即返回(不重试)
//  4. 等待 baseDelay * 2^(attempt-1),期间 ctx 取消也立即返回
//  5. 重复,达上限返回最后一次错误
//
// 返回的错误始终非 nil(若所有尝试都失败);成功时为 nil。
func withRetry(
	ctx context.Context,
	policy retryPolicy,
	op func(context.Context) error,
) error {
	if policy.maxAttempts < 1 {
		policy.maxAttempts = 1
	}
	if policy.isRetryable == nil {
		policy.isRetryable = func(err error) bool { return err != nil }
	}
	delay := policy.baseDelay
	var lastErr error
	for attempt := 1; attempt <= policy.maxAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			if lastErr != nil {
				return errors.Join(lastErr, err)
			}
			return err
		}
		lastErr = op(ctx)
		if lastErr == nil {
			return nil
		}
		if !policy.isRetryable(lastErr) {
			return lastErr
		}
		if attempt == policy.maxAttempts {
			break
		}
		// 等待期间 ctx 取消立即合并返回,不耗到满 delay
		select {
		case <-ctx.Done():
			return errors.Join(lastErr, ctx.Err())
		case <-time.After(delay):
		}
		delay *= 2
	}
	return lastErr
}