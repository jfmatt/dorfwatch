// Package tiles models the Dorfromantik: Sakura tile catalog.
//
// A tile is described by the features on its six edges, read clockwise. Because
// a hex can be picked up in any rotation, every tile is stored in a canonical
// rotation and all matching is done cyclically.
package tiles

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Kind separates the three decks the game tracks independently.
type Kind string

const (
	KindLandscape Kind = "landscape"
	KindTask      Kind = "task"
	KindTemple    Kind = "temple"
)

// Edges is the number of edges on a tile.
const Edges = 6

// Feature is a single edge feature, encoded as one character.
type Feature struct {
	Key   string `json:"key"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Flag  bool   `json:"flag"`
}

// Features lists every legal edge character, in display order. The keys match
// the encoding documented in the README.
var Features = []Feature{
	{Key: "i", Name: "River", Color: "#4c9be8"},
	{Key: "r", Name: "Road", Color: "#6b4a2f"},
	{Key: "p", Name: "Sakura", Color: "#ef8fb8"},
	{Key: "v", Name: "Village", Color: "#d1495b"},
	{Key: "g", Name: "Rice", Color: "#5c9e57"},
	{Key: "h", Name: "Hot spring", Color: "#4fc3c0"},
	{Key: "j", Name: "Mt. Fuji", Color: "#8a6a9c"},
	{Key: "m", Name: "Meadow", Color: "#b7c98f"},
	{Key: "c", Name: "Clouds", Color: "#ffffff"},
	{Key: "1", Name: "Pink flag", Color: "#ef8fb8", Flag: true},
	{Key: "2", Name: "Red flag", Color: "#d1495b", Flag: true},
	{Key: "3", Name: "Green flag", Color: "#5c9e57", Flag: true},
	{Key: "4", Name: "Rainbow flag", Color: "#b07cd6", Flag: true},
}

var featureByKey = func() map[byte]Feature {
	m := make(map[byte]Feature, len(Features))
	for _, f := range Features {
		m[f.Key[0]] = f
	}
	return m
}()

// ValidFeature reports whether c is a legal edge character.
func ValidFeature(c byte) bool {
	_, ok := featureByKey[c]
	return ok
}

// answers lists every search character an edge should answer to. A flag sits in
// a coloured region, so its edge is that terrain as well as the flag, and the
// rainbow flag counts as any of the three during play. The relation is one-way:
// searching for a pink flag does not turn up plain sakura.
var answers = map[byte]string{
	'1': "1p",
	'2': "2v",
	'3': "3g",
	'4': "4123pvg",
}

// neverUnderCloud lists features a cloud is never hiding. Hot springs and
// Mt. Fuji appear only on their own handful of tiles.
const neverUnderCloud = "hj"

// Satisfies reports whether an edge answers to a search for want. Clouds hide
// what is underneath, so a cloud edge can be played as any ordinary terrain and
// answers to a search for it.
func Satisfies(want, edge byte) bool {
	if want == edge {
		return true
	}
	if edge == 'c' {
		return strings.IndexByte(neverUnderCloud, want) < 0
	}
	return strings.IndexByte(answers[edge], want) >= 0
}

// definite lists what an edge necessarily is, with no choice left to the
// player. A coloured flag really is a region of its colour, but a cloud and the
// rainbow flag are only decided when the tile is placed.
var definite = map[byte]string{
	'1': "1p",
	'2': "2v",
	'3': "3g",
}

// DefinitelyIs reports whether an edge is necessarily want, rather than merely
// able to be played as it. Used by "must exclude", which asks what a tile is
// committed to: a cloud never forces a river connection.
func DefinitelyIs(want, edge byte) bool {
	if want == edge {
		return true
	}
	return strings.IndexByte(definite[edge], want) >= 0
}

// AreaOf returns the area an edge belongs to, for working out what connects
// through the middle of a tile. A pink flag is part of the sakura area it
// stands in. The rainbow flag has no one colour and a cloud hides what is
// underneath, so neither can be said to join anything.
func AreaOf(c byte) byte {
	switch c {
	case '1':
		return 'p'
	case '2':
		return 'v'
	case '3':
		return 'g'
	}
	return c
}

// TaskType is one of the seven kinds of task a task tile can carry.
type TaskType struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	// Values is the deck of task-value tokens drawn when a task of this type
	// comes up. Types that always score the same have no deck.
	Values []int `json:"values"`
	// Fixed is the value every task of this type scores, for types that draw no
	// token. Zero when the type draws from Values instead.
	Fixed int `json:"fixed,omitempty"`
	// Color tints the task type in results, so a river task reads as a river
	// task at a glance. Matches the terrain where there is one.
	Color string `json:"color"`
}

// TaskValueDeck is the token deck each of the six scoring task types draws from.
var TaskValueDeck = []int{4, 4, 5, 5, 6, 6}

// TaskTypes lists every task type, in display order.
var TaskTypes = []TaskType{
	{Key: "road", Name: "Road", Values: TaskValueDeck, Color: "#6b4a2f"},
	{Key: "river", Name: "River", Values: TaskValueDeck, Color: "#4c9be8"},
	{Key: "village", Name: "Village", Values: TaskValueDeck, Color: "#d1495b"},
	{Key: "rice", Name: "Rice", Values: TaskValueDeck, Color: "#5c9e57"},
	{Key: "sakura", Name: "Sakura", Values: TaskValueDeck, Color: "#ef8fb8"},
	{Key: "surround", Name: "Surround", Values: TaskValueDeck, Color: "#ffffff"},
	{Key: "special-7", Name: "Special 7", Values: nil, Fixed: 7, Color: "#d8a13a"},
}

var taskTypeByKey = func() map[string]TaskType {
	m := make(map[string]TaskType, len(TaskTypes))
	for _, t := range TaskTypes {
		m[t.Key] = t
	}
	return m
}()

// Tile is one physical tile design.
type Tile struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
	Kind Kind   `json:"kind"`
	// Edges holds exactly six feature characters, in the rotation they were
	// recorded in — that is how the tile gets drawn.
	Edges string `json:"edges"`
	// Canonical is Edges rewritten into its canonical rotation. Matching goes
	// through this, so a tile is found whichever way round it is entered.
	Canonical string `json:"canonical"`
	// Blossom is the feature key of the area carrying the cherry blossom, or
	// "" for none. The blossom sits in the middle of that area rather than on
	// a particular edge, so it is recorded per feature, not per edge.
	Blossom string `json:"blossom"`
	// Task is the task type key, required on (and only on) task tiles.
	Task string `json:"task,omitempty"`
	// AlsoTasks lists further task types this tile counts as. The special-7
	// tasks each name two terrains and may be scored as either, so they answer
	// to both when filtering and searching.
	AlsoTasks []string `json:"alsoTasks,omitempty"`
	// Copies is how many identical tiles of this design are in the deck.
	Copies int `json:"copies"`
	// Unlock names the achievement that adds this tile; empty means it is part
	// of the starting deck.
	Unlock string `json:"unlock,omitempty"`
	// Special marks a tile that sits in the landscape deck but is treated
	// differently by some game rules, so it is worth calling out in results.
	Special bool `json:"special,omitempty"`
	// Tags are extra search terms, e.g. "match-bonus" or "distance".
	Tags  []string `json:"tags,omitempty"`
	Notes string   `json:"notes,omitempty"`
}

// Achievement groups tiles that are unlocked together.
type Achievement struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Catalog is the full tile database plus its achievement list.
type Catalog struct {
	Version      int           `json:"version"`
	Tiles        []Tile        `json:"tiles"`
	Achievements []Achievement `json:"achievements"`
	Features     []Feature     `json:"features"`
	TaskTypes    []TaskType    `json:"taskTypes"`
	// Warnings collects non-fatal data problems found while loading.
	Warnings []string `json:"warnings,omitempty"`
}

type tilesFile struct {
	Version int    `json:"version"`
	Tiles   []Tile `json:"tiles"`
}

type achievementsFile struct {
	Version      int           `json:"version"`
	Achievements []Achievement `json:"achievements"`
}

// Load reads tiles.json and achievements.json from dir, validating and
// canonicalizing every tile. achievements.json may be absent.
func Load(dir string) (*Catalog, error) {
	var tf tilesFile
	if err := readJSON(filepath.Join(dir, "tiles.json"), &tf); err != nil {
		return nil, err
	}

	var af achievementsFile
	achPath := filepath.Join(dir, "achievements.json")
	if err := readJSON(achPath, &af); err != nil {
		if !os.IsNotExist(err) {
			return nil, err
		}
	}

	cat := &Catalog{
		Version:      tf.Version,
		Tiles:        tf.Tiles,
		Achievements: af.Achievements,
		Features:     Features,
		TaskTypes:    TaskTypes,
	}
	if cat.Achievements == nil {
		cat.Achievements = []Achievement{}
	}
	if cat.Tiles == nil {
		cat.Tiles = []Tile{}
	}
	if err := cat.normalize(); err != nil {
		return nil, err
	}
	return cat, nil
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

// normalize validates every tile and rewrites it in canonical rotation.
func (c *Catalog) normalize() error {
	achIDs := make(map[string]bool, len(c.Achievements))
	for _, a := range c.Achievements {
		if a.ID == "" {
			return fmt.Errorf("achievements.json: achievement with empty id")
		}
		if achIDs[a.ID] {
			return fmt.Errorf("achievements.json: duplicate achievement id %q", a.ID)
		}
		achIDs[a.ID] = true
	}

	seenID := make(map[string]bool, len(c.Tiles))
	seenDesign := make(map[string]string, len(c.Tiles))

	for i := range c.Tiles {
		t := &c.Tiles[i]
		if t.ID == "" {
			return fmt.Errorf("tiles.json: tile %d has an empty id", i)
		}
		if seenID[t.ID] {
			return fmt.Errorf("tiles.json: duplicate tile id %q", t.ID)
		}
		seenID[t.ID] = true

		switch t.Kind {
		case KindLandscape, KindTask, KindTemple:
		case "":
			t.Kind = KindLandscape
		default:
			return fmt.Errorf("tiles.json: tile %s has unknown kind %q", t.ID, t.Kind)
		}

		if t.Kind == KindTask {
			if t.Task == "" {
				return fmt.Errorf("tiles.json: task tile %s needs a %q field (%s)", t.ID, "task", taskTypeKeys())
			}
			if _, ok := taskTypeByKey[t.Task]; !ok {
				return fmt.Errorf("tiles.json: tile %s has unknown task type %q, want one of %s", t.ID, t.Task, taskTypeKeys())
			}
		} else if t.Task != "" {
			return fmt.Errorf("tiles.json: tile %s is a %s tile, so it cannot have a task type", t.ID, t.Kind)
		}

		if len(t.AlsoTasks) > 0 && t.Kind != KindTask {
			return fmt.Errorf("tiles.json: tile %s is a %s tile, so it cannot have extra task types", t.ID, t.Kind)
		}
		for _, also := range t.AlsoTasks {
			if _, ok := taskTypeByKey[also]; !ok {
				return fmt.Errorf("tiles.json: tile %s counts as unknown task type %q, want one of %s", t.ID, also, taskTypeKeys())
			}
			if also == t.Task {
				return fmt.Errorf("tiles.json: tile %s lists %q both as its task type and as an extra", t.ID, also)
			}
		}

		// Keep the recorded rotation for drawing, and derive the canonical one
		// for matching and duplicate detection.
		entered, _, err := Parse(t.Edges, false)
		if err != nil {
			return fmt.Errorf("tiles.json: tile %s: %w", t.ID, err)
		}
		canonical, blossom, err := Canonical(t.Edges, t.Blossom)
		if err != nil {
			return fmt.Errorf("tiles.json: tile %s: %w", t.ID, err)
		}
		t.Edges, t.Canonical, t.Blossom = entered, canonical, blossom

		if t.Copies == 0 {
			t.Copies = 1
		}
		if t.Copies < 1 {
			return fmt.Errorf("tiles.json: tile %s has copies %d, want at least 1", t.ID, t.Copies)
		}
		if t.Unlock != "" && !achIDs[t.Unlock] {
			return fmt.Errorf("tiles.json: tile %s unlocks from unknown achievement %q", t.ID, t.Unlock)
		}
		if t.Special && t.Kind != KindLandscape {
			return fmt.Errorf("tiles.json: tile %s is a %s tile, so it cannot be special — special tiles sit in the landscape deck", t.ID, t.Kind)
		}
		// Not every special tile has a grouping beyond its own name, so blank
		// tags are simply dropped rather than treated as an error.
		tags := t.Tags[:0]
		for _, tag := range t.Tags {
			if tag = strings.TrimSpace(tag); tag != "" {
				tags = append(tags, tag)
			}
		}
		t.Tags = tags
		if len(t.Tags) == 0 {
			t.Tags = nil
		}

		design := fmt.Sprintf("%s:%s:%s:%s:%t", t.Kind, t.Task, t.Canonical, t.Blossom, t.Special)
		if prev, ok := seenDesign[design]; ok {
			c.Warnings = append(c.Warnings, fmt.Sprintf(
				"tiles %s and %s are identical (%s %s) — use \"copies\" instead of separate entries if that is intentional",
				prev, t.ID, t.Kind, Format(t.Edges, t.Blossom)))
		} else {
			seenDesign[design] = t.ID
		}
	}
	return nil
}

func taskTypeKeys() string {
	keys := make([]string, 0, len(TaskTypes))
	for _, t := range TaskTypes {
		keys = append(keys, t.Key)
	}
	return strings.Join(keys, ", ")
}

// Parse reads a tile encoding such as "rpp*rgg" into its edge string and the
// feature carrying the cherry blossom. A '*' marks the preceding edge, and the
// blossom is recorded as that edge's feature. Input is lowercased and
// whitespace is ignored. It does not enforce a length, so it can also parse
// search patterns; pass allowWildcard to permit '.'.
func Parse(s string, allowWildcard bool) (edges string, blossom string, err error) {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := lower(s[i])
		switch {
		case ch == ' ' || ch == '\t' || ch == '-' || ch == '_':
			continue
		case ch == '*':
			if b.Len() == 0 {
				return "", "", fmt.Errorf("%q: '*' must follow an edge", s)
			}
			feature := b.String()[b.Len()-1:]
			if feature == "." {
				return "", "", fmt.Errorf("%q: '*' cannot follow a wildcard", s)
			}
			if blossom != "" && blossom != feature {
				return "", "", fmt.Errorf("%q: a tile has at most one cherry blossom", s)
			}
			blossom = feature
		case allowWildcard && ch == '.':
			b.WriteByte('.')
		case ValidFeature(ch):
			b.WriteByte(ch)
		default:
			return "", "", fmt.Errorf("%q: %q is not a tile feature", s, string(s[i]))
		}
	}
	return b.String(), blossom, nil
}

func lower(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + ('a' - 'A')
	}
	return c
}

// Format renders an edge string and blossom feature back into the '*' notation,
// marking the first edge of the feature the blossom sits on.
func Format(edges string, blossom string) string {
	if blossom == "" {
		return edges
	}
	i := strings.Index(edges, blossom)
	if i < 0 {
		return edges
	}
	return edges[:i+1] + "*" + edges[i+1:]
}

// Canonical rewrites a full six-edge tile into its canonical rotation: the
// lexicographically smallest rotation. The blossom is a feature rather than an
// edge, so rotation leaves it alone.
func Canonical(edges string, blossom string) (string, string, error) {
	parsed, parsedBlossom, err := Parse(edges, false)
	if err != nil {
		return "", "", err
	}
	if len(parsed) != Edges {
		return "", "", fmt.Errorf("%q: want %d edges, got %d", edges, Edges, len(parsed))
	}
	// A '*' in the string and an explicit blossom feature may both be present;
	// they must not disagree.
	if parsedBlossom != "" {
		if blossom != "" && blossom != parsedBlossom {
			return "", "", fmt.Errorf("%q: blossom %q contradicts the '*' on %q", edges, blossom, parsedBlossom)
		}
		blossom = parsedBlossom
	}
	if blossom != "" {
		if len(blossom) != 1 || !ValidFeature(blossom[0]) {
			return "", "", fmt.Errorf("blossom %q is not a tile feature", blossom)
		}
		if !strings.Contains(parsed, blossom) {
			return "", "", fmt.Errorf("blossom is on %q, which is not an edge of %q", blossom, parsed)
		}
	}

	best := parsed
	for shift := 1; shift < Edges; shift++ {
		if rotated := parsed[shift:] + parsed[:shift]; rotated < best {
			best = rotated
		}
	}
	return best, blossom, nil
}

// Rotations returns all six rotations of an edge string.
func Rotations(edges string) []string {
	out := make([]string, 0, Edges)
	for shift := 0; shift < len(edges); shift++ {
		out = append(out, edges[shift:]+edges[:shift])
	}
	return out
}

// Match reports whether pattern occurs anywhere in the cyclic edge string.
// A '.' in the pattern matches any single feature, and flags answer to their
// colour as well as themselves — see Satisfies. An empty pattern matches
// everything; a pattern longer than the tile never matches.
func Match(pattern, edges string) bool {
	if pattern == "" {
		return true
	}
	if len(pattern) > len(edges) {
		return false
	}
	doubled := edges + edges
	for start := 0; start < len(edges); start++ {
		if matchAt(pattern, doubled[start:start+len(pattern)]) {
			return true
		}
	}
	return false
}

func matchAt(pattern, window string) bool {
	for i := 0; i < len(pattern); i++ {
		if pattern[i] != '.' && !Satisfies(pattern[i], window[i]) {
			return false
		}
	}
	return true
}
