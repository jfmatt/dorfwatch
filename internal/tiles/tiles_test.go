package tiles

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		in      string
		edges   string
		blossom string
	}{
		{"immimm", "immimm", ""},
		{"IMMIMM", "immimm", ""},
		{"rpp*rgg", "rpprgg", "p"},
		{"rppr*gg", "rpprgg", "r"},
		{"i m m i m m", "immimm", ""},
		{"c123 4m", "c1234m", ""},
		{"hhgirm", "hhgirm", ""},
		// The blossom is on the feature, so it does not matter which of that
		// feature's edges carries the '*'.
		{"p*ppmgm", "pppmgm", "p"},
		{"pp*pmgm", "pppmgm", "p"},
		{"ppp*mgm", "pppmgm", "p"},
	}
	for _, tc := range tests {
		edges, blossom, err := Parse(tc.in, false)
		if err != nil {
			t.Errorf("Parse(%q) error: %v", tc.in, err)
			continue
		}
		if edges != tc.edges {
			t.Errorf("Parse(%q) edges = %q, want %q", tc.in, edges, tc.edges)
		}
		if blossom != tc.blossom {
			t.Errorf("Parse(%q) blossom = %q, want %q", tc.in, blossom, tc.blossom)
		}
	}
}

func TestParseRejectsBadInput(t *testing.T) {
	// 'o' was the road character before road moved to 'r' and river to 'i'.
	for _, in := range []string{"rmmxmm", "ommmmm", "*rmmrmm", "rm*mr*mm", "r.r"} {
		if _, _, err := Parse(in, false); err == nil {
			t.Errorf("Parse(%q) = nil error, want failure", in)
		}
	}
	if _, _, err := Parse("r.r", true); err != nil {
		t.Errorf("Parse(%q, allowWildcard) error: %v", "r.r", err)
	}
}

func TestCanonicalIsRotationInvariant(t *testing.T) {
	want, _, err := Canonical("rmmrmm", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, rot := range Rotations("rmmrmm") {
		got, _, err := Canonical(rot, "")
		if err != nil {
			t.Fatalf("Canonical(%q): %v", rot, err)
		}
		if got != want {
			t.Errorf("Canonical(%q) = %q, want %q", rot, got, want)
		}
	}
}

func TestCanonicalKeepsBlossomOnItsFeature(t *testing.T) {
	edges, blossom, err := Canonical("rppr*gg", "")
	if err != nil {
		t.Fatal(err)
	}
	if blossom != "r" {
		t.Errorf("blossom = %q, want the road feature %q", blossom, "r")
	}

	// Same physical tile picked up from a different edge: the canonical form
	// and the blossom must both come out the same.
	edges2, blossom2, err := Canonical("ppr*ggr", "")
	if err != nil {
		t.Fatal(err)
	}
	if edges2 != edges || blossom2 != blossom {
		t.Errorf("rotated input gave %s, want %s", Format(edges2, blossom2), Format(edges, blossom))
	}
}

func TestCanonicalBlossomIsPerFeatureNotPerEdge(t *testing.T) {
	// A blossom sits in the middle of an area, so every spelling that puts the
	// '*' on that area is the same tile.
	want, wantBlossom, err := Canonical("p*ppmgm", "")
	if err != nil {
		t.Fatal(err)
	}
	for _, in := range []string{"pp*pmgm", "ppp*mgm", "pmgmp*p", "gmp*ppm"} {
		edges, blossom, err := Canonical(in, "")
		if err != nil {
			t.Fatalf("Canonical(%q): %v", in, err)
		}
		if edges != want || blossom != wantBlossom {
			t.Errorf("Canonical(%q) = %s, want %s", in, Format(edges, blossom), Format(want, wantBlossom))
		}
	}
}

func TestCanonicalRejectsBlossomNotOnTheTile(t *testing.T) {
	if _, _, err := Canonical("mmmmmm", "p"); err == nil {
		t.Error("want an error when the blossom feature is not an edge of the tile")
	}
	if _, _, err := Canonical("mmmmmm", "zz"); err == nil {
		t.Error("want an error for a blossom that is not a feature")
	}
}

func TestCanonicalRejectsWrongLength(t *testing.T) {
	for _, in := range []string{"rmm", "rmmrmmr", ""} {
		if _, _, err := Canonical(in, ""); err == nil {
			t.Errorf("Canonical(%q) = nil error, want failure", in)
		}
	}
}

func TestCanonicalRejectsContradictoryBlossom(t *testing.T) {
	if _, _, err := Canonical("rpp*rgg", "g"); err == nil {
		t.Error("want error when '*' and the blossom feature disagree")
	}
}

func TestMatch(t *testing.T) {
	tests := []struct {
		pattern, edges string
		want           bool
	}{
		{"i.i", "imimmm", true},    // gentle river curve
		{"i.i", "immimm", false},   // wide curve: two gaps between rivers
		{"immimm", "mmimmi", true}, // same tile, different rotation
		{"mi", "immmmm", true},     // wraps around the end
		{"...", "mmmmmm", true},
		{"", "mmmmmm", true},
		{"rrrrrrr", "rrrrrr", false}, // longer than a tile
		{"vv", "vmvmvm", false},
	}
	for _, tc := range tests {
		if got := Match(tc.pattern, tc.edges); got != tc.want {
			t.Errorf("Match(%q, %q) = %v, want %v", tc.pattern, tc.edges, got, tc.want)
		}
	}
}

func TestSatisfies(t *testing.T) {
	tests := []struct {
		want, edge byte
		ok         bool
		why        string
	}{
		{'p', 'p', true, "a feature matches itself"},
		{'p', '1', true, "a pink flag is a sakura region"},
		{'v', '2', true, "a red flag is a village region"},
		{'g', '3', true, "a green flag is a rice region"},
		{'v', '1', false, "a pink flag is not a village"},
		{'p', '4', true, "the rainbow flag counts as any colour"},
		{'2', '4', true, "and as any flag"},
		{'i', '4', false, "but not as a river"},
		{'1', 'p', false, "plain sakura carries no flag"},
		{'4', '1', false, "a pink flag is not a rainbow flag"},
		{'i', 'c', true, "a cloud can be played as any ordinary terrain"},
		{'4', 'c', true, "including a flag"},
		{'h', 'c', false, "but hot springs appear only on their own tiles"},
		{'j', 'c', false, "and so does Mt. Fuji"},
		{'c', 'i', false, "but a river is not a cloud"},
		{'c', '4', false, "and nor is a rainbow flag"},
	}
	for _, tc := range tests {
		if got := Satisfies(tc.want, tc.edge); got != tc.ok {
			t.Errorf("Satisfies(%q, %q) = %v, want %v — %s",
				string(tc.want), string(tc.edge), got, tc.ok, tc.why)
		}
	}
}

func TestDefinitelyIs(t *testing.T) {
	tests := []struct {
		want, edge byte
		ok         bool
		why        string
	}{
		{'p', 'p', true, "a feature is itself"},
		{'p', '1', true, "a pink flag really is a pink region"},
		{'v', '2', true, "a red flag really is a village region"},
		{'g', '3', true, "a green flag really is a rice region"},
		{'i', 'c', false, "a cloud need not be a river"},
		{'m', 'c', false, "nor a meadow"},
		{'c', 'c', true, "but it is definitely a cloud"},
		{'p', '4', false, "a rainbow flag need not be pink"},
		{'1', '4', false, "nor a pink flag"},
		{'4', '4', true, "but it is definitely the rainbow flag"},
	}
	for _, tc := range tests {
		if got := DefinitelyIs(tc.want, tc.edge); got != tc.ok {
			t.Errorf("DefinitelyIs(%q, %q) = %v, want %v — %s",
				string(tc.want), string(tc.edge), got, tc.ok, tc.why)
		}
	}
}

func TestMatchFollowsTheFlagAndCloudRules(t *testing.T) {
	if !Match("p", "1mmvvm") {
		t.Error("searching sakura should find a pink flag")
	}
	if Match("1", "pmmmmm") {
		t.Error("searching a pink flag should not find plain sakura")
	}
	if !Match("ii", "ccmmmm") {
		t.Error("two clouds could be a river running through")
	}
	if Match("c", "immmmm") {
		t.Error("a river is not a cloud")
	}
}

func TestAreaOf(t *testing.T) {
	for _, tc := range []struct{ in, want byte }{
		{'1', 'p'}, {'2', 'v'}, {'3', 'g'},
		{'4', '4'}, {'c', 'c'}, {'m', 'm'}, {'i', 'i'},
	} {
		if got := AreaOf(tc.in); got != tc.want {
			t.Errorf("AreaOf(%q) = %q, want %q", string(tc.in), string(got), string(tc.want))
		}
	}
}

func TestFormat(t *testing.T) {
	if got := Format("rpprgg", "r"); got != "r*pprgg" {
		t.Errorf("Format = %q, want %q", got, "r*pprgg")
	}
	if got := Format("rpprgg", "g"); got != "rpprg*g" {
		t.Errorf("Format = %q, want %q", got, "rpprg*g")
	}
	if got := Format("rpprgg", ""); got != "rpprgg" {
		t.Errorf("Format = %q, want %q", got, "rpprgg")
	}
}

func writeCatalog(t *testing.T, tilesJSON, achJSON string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "tiles.json"), []byte(tilesJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if achJSON != "" {
		if err := os.WriteFile(filepath.Join(dir, "achievements.json"), []byte(achJSON), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func TestLoadCanonicalizesAndDefaults(t *testing.T) {
	dir := writeCatalog(t, `{"version":1,"tiles":[
		{"id":"L001","kind":"landscape","edges":"mmrmmr"},
		{"id":"L002","kind":"task","task":"river","edges":"rppr*gg","copies":2}
	]}`, "")
	cat, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	// Edges keep the rotation from the file; Canonical is derived from them.
	if cat.Tiles[0].Edges != "mmrmmr" {
		t.Errorf("edges = %q, want the recorded rotation %q", cat.Tiles[0].Edges, "mmrmmr")
	}
	if cat.Tiles[0].Canonical != "mmrmmr" {
		t.Errorf("canonical = %q, want %q", cat.Tiles[0].Canonical, "mmrmmr")
	}
	if cat.Tiles[0].Copies != 1 {
		t.Errorf("copies defaulted to %d, want 1", cat.Tiles[0].Copies)
	}
	// "rppr*gg": the '*' follows the second road edge, so the blossom is on the
	// road, not the sakura.
	if cat.Tiles[1].Blossom != "r" {
		t.Errorf("blossom = %q, want %q", cat.Tiles[1].Blossom, "r")
	}
	if len(cat.Achievements) != 0 {
		t.Errorf("achievements = %v, want empty when the file is absent", cat.Achievements)
	}
}

func TestLoadRejectsBadData(t *testing.T) {
	cases := map[string]string{
		"bad feature":                   `{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmx"}]}`,
		"short edges":                   `{"tiles":[{"id":"A","kind":"landscape","edges":"mmm"}]}`,
		"duplicate id":                  `{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmm"},{"id":"A","kind":"landscape","edges":"rrrrrr"}]}`,
		"bad kind":                      `{"tiles":[{"id":"A","kind":"castle","edges":"mmmmmm"}]}`,
		"empty id":                      `{"tiles":[{"id":"","kind":"landscape","edges":"mmmmmm"}]}`,
		"bad unlock":                    `{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmm","unlock":"nope"}]}`,
		"bad copies":                    `{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmm","copies":-2}]}`,
		"blossom not on the tile":       `{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmm","blossom":"p"}]}`,
		"task tile without a task type": `{"tiles":[{"id":"A","kind":"task","edges":"mmmmmm"}]}`,
		"unknown task type":             `{"tiles":[{"id":"A","kind":"task","task":"castle","edges":"mmmmmm"}]}`,
		"task type on a landscape tile": `{"tiles":[{"id":"A","kind":"landscape","task":"road","edges":"mmmmmm"}]}`,
	}
	for name, body := range cases {
		dir := writeCatalog(t, body, `{"achievements":[]}`)
		if _, err := Load(dir); err == nil {
			t.Errorf("%s: Load = nil error, want failure", name)
		}
	}
}

func TestLoadKeepsTheRecordedRotation(t *testing.T) {
	// The temple tiles are entered with the single region at the top so they
	// all draw the same way up; loading must not rotate them.
	dir := writeCatalog(t, `{"tiles":[
		{"id":"A","kind":"temple","edges":"vmgmgm"},
		{"id":"B","kind":"temple","edges":"gmpmpm"},
		{"id":"C","kind":"temple","edges":"pmvmvm"}
	]}`, "")
	cat, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range []string{"vmgmgm", "gmpmpm", "pmvmvm"} {
		if got := cat.Tiles[i].Edges; got != want {
			t.Errorf("tile %s edges = %q, want %q", cat.Tiles[i].ID, got, want)
		}
		if cat.Tiles[i].Canonical == "" {
			t.Errorf("tile %s has no canonical form", cat.Tiles[i].ID)
		}
	}
}

func TestLoadCanonicalIsRotationIndependent(t *testing.T) {
	// The same tile entered three ways round must share one canonical form.
	dir := writeCatalog(t, `{"tiles":[
		{"id":"A","kind":"landscape","edges":"immimm"},
		{"id":"B","kind":"landscape","edges":"mmimmi"},
		{"id":"C","kind":"landscape","edges":"mimmim"}
	]}`, "")
	cat, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	for _, tile := range cat.Tiles {
		if tile.Canonical != cat.Tiles[0].Canonical {
			t.Errorf("tile %s canonical = %q, want %q", tile.ID, tile.Canonical, cat.Tiles[0].Canonical)
		}
	}
	if len(cat.Warnings) != 2 {
		t.Errorf("warnings = %v, want two duplicates flagged", cat.Warnings)
	}
}

func TestLoadWarnsOnIdenticalDesigns(t *testing.T) {
	dir := writeCatalog(t, `{"tiles":[
		{"id":"A","kind":"landscape","edges":"mmrmmr"},
		{"id":"B","kind":"landscape","edges":"rmmrmm"}
	]}`, "")
	cat, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.Warnings) != 1 || !strings.Contains(cat.Warnings[0], "A") {
		t.Errorf("warnings = %v, want one mentioning tile A", cat.Warnings)
	}
}

func TestLoadAcceptsEveryTaskType(t *testing.T) {
	for _, tt := range TaskTypes {
		body := `{"tiles":[{"id":"A","kind":"task","task":"` + tt.Key + `","edges":"mmmmmm"}]}`
		cat, err := Load(writeCatalog(t, body, ""))
		if err != nil {
			t.Errorf("task type %q: %v", tt.Key, err)
			continue
		}
		if cat.Tiles[0].Task != tt.Key {
			t.Errorf("task type = %q, want %q", cat.Tiles[0].Task, tt.Key)
		}
	}
}

func TestCatalogExposesTaskTypes(t *testing.T) {
	cat, err := Load(writeCatalog(t, `{"tiles":[]}`, ""))
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.TaskTypes) != 7 {
		t.Fatalf("task types = %d, want 7", len(cat.TaskTypes))
	}
	for _, tt := range cat.TaskTypes {
		if tt.Key == "special-7" {
			if tt.Values != nil {
				t.Errorf("special-7 should have no value deck, got %v", tt.Values)
			}
			continue
		}
		if got := tt.Values; len(got) != 6 || got[0] != 4 || got[2] != 5 || got[4] != 6 {
			t.Errorf("%s values = %v, want [4 4 5 5 6 6]", tt.Key, got)
		}
	}
}

func TestLoadResolvesAchievements(t *testing.T) {
	dir := writeCatalog(t,
		`{"tiles":[{"id":"A","kind":"landscape","edges":"mmmmmm","unlock":"a01"}]}`,
		`{"achievements":[{"id":"a01","name":"First harvest"}]}`)
	cat, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(cat.Achievements) != 1 {
		t.Fatalf("achievements = %v", cat.Achievements)
	}
}
