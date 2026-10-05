package server

import (
	"testing"

	"github.com/qizhida-partner-platform/backend/internal/store"
	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func TestCheckModelBudgetLocked(t *testing.T) {
	t.Setenv("QZDA_MODEL_BUDGET_ENFORCE", "1")
	st := store.New()
	srv := New(st)
	st.Lock()
	st.ModelBudgets = []map[string]any{
		{"workspaceId": "w1", "usedUsd": 800.0, "limitUsd": 500},
	}
	err := srv.checkModelBudgetLocked("w1")
	st.Unlock()
	if err == nil {
		t.Fatal("expected budget deny")
	}
	ae, ok := err.(*apperr.AppError)
	if !ok || ae.Code != apperr.BudgetExceeded {
		t.Fatalf("err=%v", err)
	}
}
