package settings

import "net/http"

// listWebhooksConfig returns the webhook configuration roster (URL /
// events / secret-fingerprint — full secret material never leaves the
// vault). Used by the Frontend integrations page to render the
// per-webhook event subscriptions and enable flags.
func (s *Service) listWebhooksConfig(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.WebhooksConfig, nil
}
