package settings

import "net/http"

// listAPIKeys returns the API key roster (id / label / scopes /
// created-at — secret material itself is never returned over the
// wire). Used by the Frontend integrations page to render the
// per-key "rotate / revoke" buttons.
func (s *Service) listAPIKeys(r *http.Request) (any, error) {
	s.Store.RLock()
	defer s.Store.RUnlock()
	return s.Store.APIKeys, nil
}
