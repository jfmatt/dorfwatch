package store

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := New(filepath.Join(t.TempDir(), "saves"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestCreateAndGetRoundTrip(t *testing.T) {
	s := newTestStore(t)
	created, err := s.Create("Spring valley")
	if err != nil {
		t.Fatal(err)
	}
	if created.ID == "" {
		t.Fatal("created campaign has no id")
	}

	got, err := s.Get(created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "Spring valley" {
		t.Errorf("name = %q, want %q", got.Name, "Spring valley")
	}
	if got.Game != nil {
		t.Error("a new campaign should not have a game in progress")
	}
}

func TestCreateDefaultsBlankName(t *testing.T) {
	s := newTestStore(t)
	c, err := s.Create("   ")
	if err != nil {
		t.Fatal(err)
	}
	if c.Name == "" {
		t.Error("blank name was not defaulted")
	}
}

func TestSavePreservesCreatedAtAndStampsUpdatedAt(t *testing.T) {
	s := newTestStore(t)
	c, err := s.Create("Campaign")
	if err != nil {
		t.Fatal(err)
	}

	later := c.CreatedAt.Add(time.Hour)
	s.now = func() time.Time { return later }

	num := 3
	c.Game = &Game{StartedAt: later, Plays: []Play{{TileID: "L001", Kind: "task", TaskNumber: &num, At: later}}}
	c.CreatedAt = time.Time{} // a client sending garbage must not win
	saved, err := s.Save(c.ID, c)
	if err != nil {
		t.Fatal(err)
	}
	if saved.CreatedAt.IsZero() {
		t.Error("CreatedAt was overwritten by the client value")
	}
	if !saved.UpdatedAt.Equal(later) {
		t.Errorf("UpdatedAt = %v, want %v", saved.UpdatedAt, later)
	}

	reloaded, err := s.Get(c.ID)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Game == nil || len(reloaded.Game.Plays) != 1 {
		t.Fatalf("game did not round-trip: %+v", reloaded.Game)
	}
	if got := reloaded.Game.Plays[0].TaskNumber; got == nil || *got != 3 {
		t.Errorf("task number = %v, want 3", got)
	}
}

func TestSaveKeepsExistingNameWhenBlank(t *testing.T) {
	s := newTestStore(t)
	c, _ := s.Create("Original")
	c.Name = "  "
	saved, err := s.Save(c.ID, c)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Name != "Original" {
		t.Errorf("name = %q, want %q", saved.Name, "Original")
	}
}

func TestSaveLeavesNoTempFiles(t *testing.T) {
	s := newTestStore(t)
	c, _ := s.Create("Campaign")
	for i := 0; i < 3; i++ {
		if _, err := s.Save(c.ID, c); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("save directory holds %d files, want 1: %v", len(entries), entries)
	}
}

func TestListSortsByUpdatedAt(t *testing.T) {
	s := newTestStore(t)
	base := time.Now().UTC()
	s.now = func() time.Time { return base }
	older, _ := s.Create("Older")
	s.now = func() time.Time { return base.Add(time.Minute) }
	newer, _ := s.Create("Newer")

	s.now = func() time.Time { return base.Add(2 * time.Minute) }
	older.Game = &Game{StartedAt: base, Plays: []Play{{TileID: "L001", Kind: "landscape"}}}
	if _, err := s.Save(older.ID, older); err != nil {
		t.Fatal(err)
	}

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("list = %d campaigns, want 2", len(list))
	}
	if list[0].ID != older.ID {
		t.Errorf("most recently updated campaign is %q, want %q", list[0].ID, older.ID)
	}
	if !list[0].InGame || list[0].Plays != 1 {
		t.Errorf("summary = %+v, want inGame with 1 play", list[0])
	}
	if list[1].ID != newer.ID {
		t.Errorf("second campaign = %q, want %q", list[1].ID, newer.ID)
	}
}

func TestListSkipsCorruptSaves(t *testing.T) {
	s := newTestStore(t)
	good, _ := s.Create("Good")
	if err := os.WriteFile(filepath.Join(s.dir, "broken.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].ID != good.ID {
		t.Errorf("list = %+v, want just the good campaign", list)
	}
}

func TestMissingCampaign(t *testing.T) {
	s := newTestStore(t)
	if _, err := s.Get("deadbeef"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get = %v, want ErrNotFound", err)
	}
	if err := s.Delete("deadbeef"); !errors.Is(err, ErrNotFound) {
		t.Errorf("Delete = %v, want ErrNotFound", err)
	}
}

func TestPathTraversalIsRejected(t *testing.T) {
	s := newTestStore(t)
	for _, id := range []string{"../secret", "a/b", `a\b`, "", "..", "x.json"} {
		if _, err := s.Get(id); !errors.Is(err, ErrNotFound) {
			t.Errorf("Get(%q) = %v, want ErrNotFound", id, err)
		}
	}
}

func TestDelete(t *testing.T) {
	s := newTestStore(t)
	c, _ := s.Create("Doomed")
	if err := s.Delete(c.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Get(c.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after Delete = %v, want ErrNotFound", err)
	}
}
