// Package store persists campaigns as JSON files on disk.
//
// A campaign is the long-lived save: which tiles you have unlocked. Inside it
// sits at most one in-progress game, plus the games already finished.
package store

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// ErrNotFound is returned when no campaign has the requested id.
var ErrNotFound = errors.New("campaign not found")

// Play records one tile drawn during a game.
type Play struct {
	TileID string `json:"tileId"`
	Kind   string `json:"kind"`
	// TaskNumber is the number token on a task tile, or nil for other kinds.
	TaskNumber *int `json:"taskNumber"`
	// Slot is the temple board slot the tile came off, or nil if it was drawn
	// from the bag. Undo uses it to put the tile back on the board.
	Slot *int      `json:"slot"`
	At   time.Time `json:"at"`
}

// TempleSlot is one of the six places on the temple board.
type TempleSlot struct {
	// Source is "temple" for the three fixed special tiles and "landscape" for
	// the three tiles held out of the landscape deck at game start.
	Source string `json:"source"`
	// TileID is empty while a landscape slot is still face down.
	TileID string `json:"tileId"`
	// Played is true once the tile has been taken off the board and played.
	Played bool `json:"played"`
}

// Game is a single play session.
type Game struct {
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	Plays     []Play     `json:"plays"`
	// Temple is the six-slot side board. Empty for games started before the
	// temple board was tracked.
	Temple []TempleSlot `json:"temple"`
}

// Campaign is one save file.
type Campaign struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// UnlockedAchievements lists achievement ids the player has earned.
	UnlockedAchievements []string `json:"unlockedAchievements"`
	// UnlockedTiles lists tile ids unlocked directly, for decks without
	// achievement data.
	UnlockedTiles []string `json:"unlockedTiles"`
	// Game is the session in progress, or nil between games.
	Game    *Game  `json:"game"`
	History []Game `json:"history"`
}

// Summary is the lightweight view used by the campaign list.
type Summary struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// InGame reports whether a session is currently in progress.
	InGame bool `json:"inGame"`
	// Plays is the number of tiles drawn in the current session.
	Plays int `json:"plays"`
}

// Store is a directory of campaign files. It is safe for concurrent use.
type Store struct {
	dir string
	mu  sync.Mutex
	// now is swappable in tests.
	now func() time.Time
}

// New opens (creating if needed) a campaign directory.
func New(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create save directory: %w", err)
	}
	return &Store{dir: dir, now: time.Now}, nil
}

// List returns a summary of every saved campaign, newest update first.
func (s *Store) List() ([]Summary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	out := []Summary{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		c, err := s.readFile(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			// A single unreadable save should not hide the rest.
			continue
		}
		sum := Summary{ID: c.ID, Name: c.Name, CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt}
		if c.Game != nil {
			sum.InGame = true
			sum.Plays = len(c.Game.Plays)
		}
		out = append(out, sum)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out, nil
}

// Create makes a new empty campaign.
func (s *Store) Create(name string) (*Campaign, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "Untitled campaign"
	}
	id, err := newID()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	now := s.now().UTC()
	c := &Campaign{
		ID:                   id,
		Name:                 name,
		CreatedAt:            now,
		UpdatedAt:            now,
		UnlockedAchievements: []string{},
		UnlockedTiles:        []string{},
		History:              []Game{},
	}
	if err := s.writeFile(c); err != nil {
		return nil, err
	}
	return c, nil
}

// Get loads one campaign.
func (s *Store) Get(id string) (*Campaign, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readFile(id)
}

// Save overwrites a campaign, stamping UpdatedAt. The id in the path wins over
// any id in the body, and the original CreatedAt is preserved.
func (s *Store) Save(id string, c *Campaign) (*Campaign, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	existing, err := s.readFile(id)
	if err != nil {
		return nil, err
	}
	c.ID = id
	c.CreatedAt = existing.CreatedAt
	c.UpdatedAt = s.now().UTC()
	if strings.TrimSpace(c.Name) == "" {
		c.Name = existing.Name
	}
	if c.UnlockedAchievements == nil {
		c.UnlockedAchievements = []string{}
	}
	if c.UnlockedTiles == nil {
		c.UnlockedTiles = []string{}
	}
	if c.History == nil {
		c.History = []Game{}
	}
	if err := s.writeFile(c); err != nil {
		return nil, err
	}
	return c, nil
}

// Delete removes a campaign file.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	path, err := s.path(id)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

// path guards against ids that would escape the save directory.
func (s *Store) path(id string) (string, error) {
	if id == "" || strings.ContainsAny(id, `/\.`) {
		return "", ErrNotFound
	}
	return filepath.Join(s.dir, id+".json"), nil
}

func (s *Store) readFile(id string) (*Campaign, error) {
	path, err := s.path(id)
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var c Campaign
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("save %s is corrupt: %w", id, err)
	}
	return &c, nil
}

// writeFile writes to a temp file and renames it into place, so a crash or a
// full disk cannot leave a half-written save behind.
func (s *Store) writeFile(c *Campaign) error {
	path, err := s.path(c.ID)
	if err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.dir, "."+c.ID+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

func newID() (string, error) {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
