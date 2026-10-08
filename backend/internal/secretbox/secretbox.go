// Package secretbox seals credentials with AES-256-GCM for local durable storage.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"os"
	"strings"
)

const prefix = "enc:v1:"

var ErrKeyMissing = errors.New("QZDA_CREDENTIAL_KEY 未配置")

// KeyFromEnv reads QZDA_CREDENTIAL_KEY, a base64-encoded 32-byte key.
func KeyFromEnv() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("QZDA_CREDENTIAL_KEY"))
	if raw == "" {
		return nil, ErrKeyMissing
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, errors.New("QZDA_CREDENTIAL_KEY 必须是 base64 编码的 32 字节")
	}
	return key, nil
}

func IsSealed(value string) bool {
	return strings.HasPrefix(value, prefix)
}

func Seal(key []byte, plaintext string) (string, error) {
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return prefix + base64.StdEncoding.EncodeToString(sealed), nil
}

func Open(key []byte, value string) (string, error) {
	if !IsSealed(value) {
		return "", errors.New("值不是加密格式")
	}
	gcm, err := newGCM(key)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("密文格式错误")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", errors.New("密文校验失败")
	}
	return string(plain), nil
}

func newGCM(key []byte) (cipher.AEAD, error) {
	if len(key) != 32 {
		return nil, errors.New("加密密钥必须为 32 字节")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
