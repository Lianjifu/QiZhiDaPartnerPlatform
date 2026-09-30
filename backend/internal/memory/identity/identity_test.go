package identity

import (
	"errors"
	"testing"
)

func TestSetGet(t *testing.T) {
	s := NewStore()
	p := Profile{WorkspaceID: "ws1", DigitalPartnerID: "de-A", PreferredName: "听风", Locale: "zh-CN", PrimaryLanguage: "zh"}
	if err := s.Set(p); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err := s.Get("ws1", "de-A")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.PreferredName != "听风" {
		t.Fatalf("name=%s", got.PreferredName)
	}
}

func TestSetInvalid(t *testing.T) {
	s := NewStore()
	if err := s.Set(Profile{WorkspaceID: "", DigitalPartnerID: "x"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid: %v", err)
	}
	if err := s.Set(Profile{WorkspaceID: "ws", DigitalPartnerID: ""}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("expected ErrInvalid: %v", err)
	}
}

func TestGetNotFound(t *testing.T) {
	s := NewStore()
	if _, err := s.Get("ws", "missing"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expected ErrNotFound: %v", err)
	}
}

func TestDelete(t *testing.T) {
	s := NewStore()
	s.Set(Profile{WorkspaceID: "ws", DigitalPartnerID: "de"})
	if err := s.Delete("ws", "de"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if err := s.Delete("ws", "de"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second delete must be ErrNotFound: %v", err)
	}
}

func TestListAll(t *testing.T) {
	s := NewStore()
	s.Set(Profile{WorkspaceID: "ws", DigitalPartnerID: "b"})
	s.Set(Profile{WorkspaceID: "ws", DigitalPartnerID: "a"})
	s.Set(Profile{WorkspaceID: "other", DigitalPartnerID: "a"})
	got := s.ListAll("ws")
	if len(got) != 2 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0].DigitalPartnerID != "a" || got[1].DigitalPartnerID != "b" {
		t.Fatalf("sort: %+v", got)
	}
}

func TestShouldRefuseSingleTerm(t *testing.T) {
	p := Profile{HardNo: []string{"工资", "medical"}}
	if reason, ok := p.ShouldRefuse("我的工资是多少"); !ok || reason != "工资" {
		t.Fatalf("must refuse 工资, got %v %v", reason, ok)
	}
	if _, ok := p.ShouldRefuse("any medical questions"); !ok {
		t.Fatal("medical must trigger refusal")
	}
	if _, ok := p.ShouldRefuse("随便问问"); ok {
		t.Fatal("unrelated query must not refuse")
	}
}

func TestShouldRefuseMultiTerm(t *testing.T) {
	p := Profile{HardNo: []string{"员工 健康 信息", "客户 隐私"}}
	if _, ok := p.ShouldRefuse("可以查 员工 健康 档案吗"); !ok {
		t.Fatal("multi-term must trigger")
	}
	if _, ok := p.ShouldRefuse("薪资"); ok {
		t.Fatal("unrelated must not trigger")
	}
}

func TestShouldRefuseEmptyQuery(t *testing.T) {
	p := Profile{HardNo: []string{"x"}}
	if _, ok := p.ShouldRefuse(""); ok {
		t.Fatal("empty query must not refuse")
	}
}
