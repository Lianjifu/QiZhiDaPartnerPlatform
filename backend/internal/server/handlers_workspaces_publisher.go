package server

import (
	"crypto/ed25519"
	"encoding/base64"
	"net/http"
	"strings"
	"time"

	"github.com/qizhida-partner-platform/backend/internal/auth"
	"github.com/qizhida-partner-platform/backend/services/qzda-sandbox/signing"
	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

// publisherKeyInfo is the public-facing publisher key response shape —
// NEVER includes privateKey. Used by GET, POST register, POST rotate
// (register mode).
type publisherKeyInfo struct {
	KeyID     string `json:"keyId"`
	PublicKey string `json:"publicKey"`
	Name      string `json:"name"`
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
	CreatedBy string `json:"createdBy,omitempty"`
}

// publisherKeyGenerateResponse is INDEPENDENT from any store type. The
// privateKey field is populated only in the HTTP response body of POST
// /publisher-key (mode=generate) and POST /publisher-key/rotate
// (mode=generate). The store NEVER carries a privateKey field — that
// is the load-bearing invariant for this endpoint set.
type publisherKeyGenerateResponse struct {
	KeyID      string `json:"keyId"`
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
	Name       string `json:"name"`
	Status     string `json:"status"`
	CreatedAt  string `json:"createdAt"`
}

// extractWorkspaceIDFromPublisherPath pulls the workspace ID out of paths
// like "/api/workspaces/w1/publisher-key" or ".../publisher-key/rotate".
func extractWorkspaceIDFromPublisherPath(r *http.Request) (string, error) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 4 {
		return "", apperr.NotFoundErr(apperr.NotFound, "无效路径")
	}
	if parts[0] != "api" || parts[1] != "workspaces" {
		return "", apperr.NotFoundErr(apperr.NotFound, "无效路径")
	}
	if parts[3] != "publisher-key" && !strings.HasPrefix(parts[3], "publisher-key/") {
		return "", apperr.NotFoundErr(apperr.NotFound, "无效路径")
	}
	return parts[2], nil
}

// getWorkspacePublisherKey returns the workspace's active publisher key
// (without privateKey). 404 if no active key.
func (s *Server) getWorkspacePublisherKey(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	wsID, err := extractWorkspaceIDFromPublisherPath(r)
	if err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	s.Store.RLock()
	defer s.Store.RUnlock()
	doc := s.Store.ActivePublisherKey(wsID)
	if doc == nil {
		return nil, apperr.NotFoundErr(apperr.NotFound, "工作区尚未配置发布者密钥")
	}
	return publisherKeyInfoFromDoc(doc), nil
}

// createOrRegisterWorkspacePublisherKey handles POST
// /api/workspaces/:wsID/publisher-key. Body: {mode, name, publicKey?}.
func (s *Server) createOrRegisterWorkspacePublisherKey(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	wsID, err := extractWorkspaceIDFromPublisherPath(r)
	if err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	mode := strings.ToLower(strings.TrimSpace(str(body["mode"])))
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		name = wsID + " publisher"
	}

	s.Store.Lock()
	if existing := s.Store.ActivePublisherKey(wsID); existing != nil {
		s.Store.Unlock()
		return nil, apperr.New("E_CONFLICT", 409,
			"工作区已有 active 发布者密钥；请先 rotate 或 revoke")
	}

	keyID, publicKeyB64, privateKeyB64, err := s.mintPublisherKey(mode, str(body["publicKey"]))
	if err != nil {
		s.Store.Unlock()
		return nil, err
	}
	doc := store.NewWorkspacePublisherKey(wsID, keyID, publicKeyB64, name, id.Name)
	s.Store.WorkspacePublisherKeys[str(doc["id"])] = doc
	action := "注册发布者公钥"
	if mode == "generate" || mode == "" {
		action = "创建发布者密钥"
	}
	s.Store.AppendAudit(wsID, id.Name, action, keyID, "success", "name="+name)
	s.Store.Unlock()
	s.persistWorkspacePublisherKey()

	if mode == "generate" || mode == "" {
		return publisherKeyGenerateResponse{
			KeyID:      keyID,
			PublicKey:  publicKeyB64,
			PrivateKey: privateKeyB64,
			Name:       name,
			Status:     store.PublisherKeyStatusActive,
			CreatedAt:  formatTimeISO(doc["createdAt"]),
		}, nil
	}
	out := publisherKeyInfoFromDoc(doc)
	out.CreatedBy = id.Name
	return out, nil
}

// rotateWorkspacePublisherKey handles POST .../publisher-key/rotate.
// Body: {mode?="generate"|"register", name?, publicKey?}.
func (s *Server) rotateWorkspacePublisherKey(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if !auth.Has(id, "publisher_key.rotate") {
		return nil, apperr.Forbidden(apperr.RoleForbidden, "需要 publisher_key.rotate 权限")
	}
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	wsID, err := extractWorkspaceIDFromPublisherPath(r)
	if err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	body, _ := decodeMap(r)
	mode := strings.ToLower(strings.TrimSpace(str(body["mode"])))
	name := strings.TrimSpace(str(body["name"]))
	if name == "" {
		name = wsID + " publisher"
	}

	s.Store.Lock()
	old := s.Store.ActivePublisherKey(wsID)
	if old == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound,
			"工作区尚未配置发布者密钥；请先 POST 创建")
	}
	oldKeyID := str(old["keyId"])

	keyID, publicKeyB64, privateKeyB64, err := s.mintPublisherKey(mode, str(body["publicKey"]))
	if err != nil {
		s.Store.Unlock()
		return nil, err
	}

	newDoc := store.NewWorkspacePublisherKey(wsID, keyID, publicKeyB64, name, id.Name)
	s.Store.WorkspacePublisherKeys[str(newDoc["id"])] = newDoc
	s.Store.MarkPublisherKeyRotated(wsID, oldKeyID, keyID)
	s.Store.AppendAudit(wsID, id.Name, "轮换发布者密钥", keyID, "success",
		"previousKeyId="+oldKeyID)
	s.Store.Unlock()
	s.persistWorkspacePublisherKey()

	if mode == "register" {
		out := publisherKeyInfoFromDoc(newDoc)
		out.CreatedBy = id.Name
		return out, nil
	}
	return publisherKeyGenerateResponse{
		KeyID:      keyID,
		PublicKey:  publicKeyB64,
		PrivateKey: privateKeyB64,
		Name:       name,
		Status:     store.PublisherKeyStatusActive,
		CreatedAt:  formatTimeISO(newDoc["createdAt"]),
	}, nil
}

// revokeWorkspacePublisherKey handles DELETE /api/workspaces/:wsID/publisher-key.
func (s *Server) revokeWorkspacePublisherKey(r *http.Request) (any, error) {
	id := identityFrom(r.Context())
	if err := requireSkillWrite(id); err != nil {
		return nil, err
	}
	wsID, err := extractWorkspaceIDFromPublisherPath(r)
	if err != nil {
		return nil, err
	}
	if err := s.requireWorkspaceAccess(id, wsID); err != nil {
		return nil, err
	}
	s.Store.Lock()
	doc := s.Store.ActivePublisherKey(wsID)
	if doc == nil {
		s.Store.Unlock()
		return nil, apperr.NotFoundErr(apperr.NotFound, "工作区未配置发布者密钥")
	}
	keyID := str(doc["keyId"])
	s.Store.MarkPublisherKeyRevoked(wsID, keyID)
	s.Store.AppendAudit(wsID, id.Name, "撤销发布者密钥", keyID, "success", "")
	s.Store.Unlock()
	s.persistWorkspacePublisherKey()
	return map[string]any{"keyId": keyID, "status": store.PublisherKeyStatusRevoked}, nil
}

// mintPublisherKey returns (keyId, publicKeyB64, privateKeyB64, err). When
// mode=="register", privateKeyB64 is the empty string and the operator
// retains their key offline. When mode=="generate" (or empty), both
// privateKeyB64 and publicKeyB64 are populated.
func (s *Server) mintPublisherKey(mode, publicKeyInput string) (keyID, pubB64, privB64 string, err error) {
	switch mode {
	case "register":
		raw, decErr := base64.StdEncoding.DecodeString(strings.TrimSpace(publicKeyInput))
		if decErr != nil || len(raw) != ed25519.PublicKeySize {
			return "", "", "", apperr.BadReq(apperr.BadRequest,
				"publicKey 必须为 base64 32 字节 Ed25519 公钥")
		}
		return signing.KeyIDFor(raw), base64.StdEncoding.EncodeToString(raw), "", nil
	case "generate", "":
		priv, genErr := signing.GenerateEd25519Key()
		if genErr != nil {
			return "", "", "", apperr.New("E_INTERNAL", 500, "无法生成 Ed25519 密钥: "+genErr.Error())
		}
		pub := priv.Public().(ed25519.PublicKey)
		pubB := append(ed25519.PublicKey(nil), pub...)
		privB := append(ed25519.PrivateKey(nil), priv...)
		return signing.KeyIDFor(pubB),
			base64.StdEncoding.EncodeToString(pubB),
			base64.StdEncoding.EncodeToString(privB),
			nil
	default:
		return "", "", "", apperr.BadReq(apperr.BadRequest, "mode 必须为 generate 或 register")
	}
}

func publisherKeyInfoFromDoc(doc map[string]any) publisherKeyInfo {
	return publisherKeyInfo{
		KeyID:     str(doc["keyId"]),
		PublicKey: str(doc["publicKey"]),
		Name:      str(doc["name"]),
		Status:    str(doc["status"]),
		CreatedAt: formatTimeISO(doc["createdAt"]),
		CreatedBy: str(doc["createdBy"]),
	}
}

// formatTimeISO renders a time.Time as RFC3339. Falls back to the empty
// string when the input is missing or wrong type.
func formatTimeISO(v any) string {
	if v == nil {
		return ""
	}
	if t, ok := v.(time.Time); ok {
		return t.UTC().Format(time.RFC3339)
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// persistWorkspacePublisherKey fires a fire-and-forget persistence hook.
// Called after Store.Unlock so the snapshot inside can take its own RLock.
func (s *Server) persistWorkspacePublisherKey() {
	if s.Store == nil {
		return
	}
	s.Store.Persist("workspace_publisher_keys")
}

// resolvePublisherKey looks up the publisher's public key for a given
// (workspace, keyId) pair and returns:
//
//	pub     — the resolved Ed25519 public key (32 bytes)
//	trust   — "workspace-active" | "workspace-rotated" | "global" | "dev-auto"
//	err     — SkillSignatureUnknownKey if no match
//
// Resolution order:
//  1. The workspace's currently active publisher key.
//  2. The workspace's most-recent rotated key (grace window for in-flight
//     imports signed by a key that was just rotated out).
//  3. The workspace's any status="rotated" entry with matching keyId.
//  4. The global TrustStore (builtin publisher + dev keypair, when env
//     permits). Tagged "global" so PolicyWorkspace can reject it.
func (s *Server) resolvePublisherKey(wsID, keyID string) (pub ed25519.PublicKey, trust string, err error) {
	s.Store.RLock()
	defer s.Store.RUnlock()

	// 1. workspace current active
	if doc := s.Store.ActivePublisherKey(wsID); doc != nil && str(doc["keyId"]) == keyID {
		if raw, decErr := base64.StdEncoding.DecodeString(str(doc["publicKey"])); decErr == nil && len(raw) == ed25519.PublicKeySize {
			return ed25519.PublicKey(raw), "workspace-active", nil
		}
	}
	// 2. any entry with matching keyId in this workspace, status=rotated
	for _, doc := range s.Store.WorkspacePublisherKeys {
		if str(doc["workspaceId"]) != wsID || str(doc["keyId"]) != keyID {
			continue
		}
		if str(doc["status"]) != store.PublisherKeyStatusRotated {
			continue
		}
		if raw, decErr := base64.StdEncoding.DecodeString(str(doc["publicKey"])); decErr == nil && len(raw) == ed25519.PublicKeySize {
			return ed25519.PublicKey(raw), "workspace-rotated", nil
		}
	}
	// 3. global trust store (builtin + prod-trusted publishers)
	if s.SkillTrustStore != nil {
		if raw, lookupErr := s.SkillTrustStore.LookupPublic(keyID); lookupErr == nil {
			return raw, "global", nil
		}
	}
	// 4. dev-mode auto keypair (for tests / local)
	if s.SkillDevKey != nil {
		tk, _ := s.SkillDevKey.TrustedKey("")
		if tk.KeyID == keyID {
			raw, _ := base64.StdEncoding.DecodeString(tk.PublicKey)
			if len(raw) == ed25519.PublicKeySize {
				return ed25519.PublicKey(raw), "dev-auto", nil
			}
		}
	}
	return nil, "", apperr.New(apperr.SkillSignatureUnknownKey, 400,
		"未知发布者 keyId: "+keyID)
}
