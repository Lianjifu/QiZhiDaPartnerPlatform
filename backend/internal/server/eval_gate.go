package server

import (
	"os"
	"strconv"
	"strings"

	apperr "github.com/qizhida-partner-platform/backend/pkg/errors"
)

func evalRecallMin() float64 {
	v := strings.TrimSpace(os.Getenv("DE_EVAL_RECALL_MIN"))
	if v == "" {
		if productionLikeEnv() {
			return 0.7
		}
		return 0
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0.7
	}
	if n > 1 {
		n = n / 100
	}
	return n
}

func evalScoreMin() float64 {
	v := strings.TrimSpace(os.Getenv("DE_EVAL_SCORE_MIN"))
	if v == "" {
		if productionLikeEnv() {
			return 80
		}
		return 0
	}
	n, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 80
	}
	return n
}

// requirePackageEvalSetLocked enforces a passed package-scoped eval set in production.
// Caller holds Store lock or RLock.
func (s *Server) requirePackageEvalSetLocked(ws, pkgID string) error {
	if !productionLikeEnv() {
		return nil
	}
	min := evalRecallMin()
	if min <= 0 {
		return nil
	}
	pkgID = strings.TrimSpace(pkgID)
	bestRecall := -1.0
	passed := false
	for _, ev := range knowledgeSliceMaps(s.Store.KnowledgeExtra["evaluations"]) {
		if str(ev["workspaceId"]) != "" && str(ev["workspaceId"]) != ws {
			continue
		}
		if pkgID != "" && str(ev["packageId"]) != pkgID {
			continue
		}
		recall := toFloat(ev["recallAtK"])
		if recall > 1 {
			recall = recall / 100
		}
		if recall > bestRecall {
			bestRecall = recall
		}
		if str(ev["status"]) == "passed" && recall >= min {
			passed = true
		}
	}
	if !passed {
		if bestRecall < 0 {
			return apperr.BadReq(apperr.EvalSetRequired, "生产发布须先通过评测集")
		}
		return apperr.BadReq(apperr.EvalSetFailed, "评测集未达门禁，无法发布")
	}
	return nil
}
