package server

import "testing"

// TestParseServiceMode covers the input surface after the qzda-sys /
// qzda-collab / qzda-cap / qzda-workflow binaries folded into qzda-app.
// Legacy names ("sys" / "collab" / "cap" / "workflow" / "qzda-sys" / ...)
// must still parse to ModeApp for backward compatibility — older scripts
// that export DE_SERVICE=sys should keep working.
func TestParseServiceMode(t *testing.T) {
	cases := []struct {
		in   string
		want ServiceMode
	}{
		{"", ModeApp},
		{"app", ModeApp},
		{"qzda-app", ModeApp},
		{"sys", ModeApp},
		{"collab", ModeApp},
		{"cap", ModeApp},
		{"workflow", ModeApp},
		{"qzda-sys", ModeApp},
		{"qzda-collab", ModeApp},
		{"qzda-cap", ModeApp},
		{"qzda-workflow", ModeApp},
		{"all", ModeAll},
		{"test", ModeAll},
		{"unknown-thing", ModeApp},
	}
	for _, tc := range cases {
		if got := ParseServiceMode(tc.in); got != tc.want {
			t.Errorf("ParseServiceMode(%q)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestServiceModeString(t *testing.T) {
	if ModeApp.String() != "qzda-app" {
		t.Errorf("ModeApp.String()=%q want qzda-app", ModeApp.String())
	}
	if ModeAll.String() != "qzda-all" {
		t.Errorf("ModeAll.String()=%q want qzda-all", ModeAll.String())
	}
}

func TestServiceModeIsUnified(t *testing.T) {
	if !ModeApp.IsUnified() {
		t.Error("ModeApp.IsUnified()=false want true (monolith owns every path)")
	}
	if !ModeAll.IsUnified() {
		t.Error("ModeAll.IsUnified()=false want true")
	}
}
