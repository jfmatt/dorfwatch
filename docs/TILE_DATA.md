# Tile data format

`data/tiles.json` is the deck, and `data/achievements.json` the list of achievements that unlock
parts of it. Both are filled in with the real Dorfromantik: Sakura contents — 110 tile designs
across 23 achievements. This document describes the format, for correcting a tile or adding one.

The server validates both files at startup and refuses to boot on a malformed entry, so a typo is
caught immediately rather than showing up as a wrong search result mid-game.

## tiles.json

```json
{
  "version": 1,
  "tiles": [
    {
      "id": "special-14",
      "kind": "landscape",
      "name": "Daimyo",
      "edges": "immmmm",
      "blossom": "",
      "copies": 1,
      "unlock": "daimyo",
      "special": true,
      "tags": ["finish-task"],
      "notes": "free-text, ignored by the app"
    }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Any unique string. Ids here read `land-007`, `task-river-3`, `special-14`. |
| `kind` | no | `landscape` (the default), `task`, or `temple`. |
| `edges` | yes | Exactly six feature characters, read **clockwise**. Drawn in the rotation you write. |
| `task` | task tiles | Which of the seven task types this tile carries. Required on task tiles, rejected on any other kind. |
| `alsoTasks` | no | Further task types the tile counts as. Task tiles only. |
| `name` | no | For named special tiles. Makes the tile findable by typing its name. |
| `blossom` | no | The feature character of the area carrying the cherry blossom, or `""`. |
| `copies` | no | How many identical tiles of this design are in the deck. Defaults to `1`. |
| `unlock` | no | Id of the achievement that adds this tile. Omit for tiles in the starting deck. |
| `special` | no | `true` for a named special tile. Landscape tiles only. |
| `tags` | no | Extra search terms, e.g. `["match-bonus"]`. Blank entries are dropped. |
| `notes` | no | Free text for your own reference. |

The API also returns a `canonical` field on every tile. That one is **computed at load time**, not
authored — see "Rotation" below.

### Feature characters

| Char | Feature |
| --- | --- |
| `i` | R**i**ver |
| `r` | **R**oad |
| `p` | **P**ink sakura |
| `v` | Red **v**illage |
| `g` | **G**reen rice |
| `h` | **H**ot spring |
| `j` | Mt. Fu**j**i |
| `m` | Blank / **m**eadow |
| `c` | **C**louds |
| `1` | Pink flag |
| `2` | Red flag |
| `3` | Green flag |
| `4` | Rainbow flag |

### Flags and clouds in search

Flags and clouds are recorded as ordinary edge characters, but they answer to more than
themselves when searching:

| Edge | Also found by searching |
| --- | --- |
| `1` pink flag | `p` sakura |
| `2` red flag | `v` village |
| `3` green flag | `g` rice |
| `4` rainbow flag | `1`, `2`, `3`, and `p`, `v`, `g` |
| `c` clouds | any ordinary terrain, including `i` and `r` — but never `h` or `j` |

The relation only runs one way: searching for `p` finds pink-flag tiles, but searching for `1`
does not turn up plain sakura, and only a real cloud answers to `c`.

"Must include" and "must exclude" ask different questions, so they treat this differently:

- **Must include** asks what a tile *could* show. A cloud counts for any ordinary terrain, and a
  flag counts for its colour, so both are kept. Hot springs and Mt. Fuji are the exception: they
  appear only on their own tiles, so a cloud is never hiding one.
- **Must exclude** asks what a tile is *committed to*. "No rivers" means "nothing that must join a
  river" — a cloud need not be played as one, so it stays. A coloured flag genuinely is a region of
  its colour, so excluding sakura does drop pink-flag tiles.

Shape filters follow the include rule: a tile with a cloud edge could take any shape, so it passes
all of them rather than being silently hidden.

### Rotation

**Tiles are drawn in the rotation you record them in**, so the order you write the edges controls
how the tile appears on screen. The temple tiles, for instance, are all entered with their single
region at the top so they line up with one another.

Matching does not care about rotation. On load the server derives a `canonical` field — the
lexicographically smallest rotation — and searching, duplicate detection and tile lookup all go
through that. So `immimm` and `mmimmi` are found by each other, and either spelling is accepted;
they simply draw the other way round.

**Only the cyclic order matters, but the direction does.** Read all tiles the same way round
(clockwise is the convention here), or mirror-image tiles will be conflated.

### Cherry blossoms

A blossom sits in the middle of a terrain area, not on one particular edge of it, so it is recorded
as the **feature** it is on rather than as an edge index. On `pppmgm` the blossom is on the sakura,
and it makes no difference which of the three sakura edges you mark. You can write it either way:

- inline in the encoding, with `*` after any edge of that feature: `"edges": "ppp*mgm"`
- as an explicit feature: `"edges": "pppmgm", "blossom": "p"`

If you give both they must agree, and the feature must actually appear on the tile, otherwise the
file is rejected.

A blossom is part of a tile's identity: `ippr*gg` and `ipp*rgg` are two different physical tiles
that share an edge sequence, one with the blossom on the road and one on the sakura. This matters
in the real deck — `gggmvm`, `gmpppm` and `mpmvvv` each exist twice, once as a task tile with no
blossom and once as a landscape tile with one.

Blossoms are shown in results but are never searchable, so they never change what a search matches.

### Task types

Every task tile carries one of seven task types, set with the `task` field:

`road`, `river`, `village`, `rice`, `sakura`, `surround`, `special-7`

The first six each draw a value token from their own deck of **4, 4, 5, 5, 6, 6** when that task
comes up. The app derives the state of all six decks from the tiles you record during a game, so
when you record a task tile it offers only the values still left for that type, and shows what each
type has left. Nothing extra to track by hand.

`special-7` draws no token — it always scores 7, so recording one asks no question. Its bag shows
one 7 per unlocked special-7 tile.

Each special-7 tile names two terrains and can be scored as either, which is what `alsoTasks`
records:

```json
{ "id": "task-7-01", "kind": "task", "task": "special-7",
  "edges": "hmpmgm", "alsoTasks": ["rice", "sakura"], "unlock": "rice-cherry-tree" }
```

Filtering or searching for `rice` therefore turns up the six rice tasks *and* the two special-7
tasks that count as rice.

Because task tiles have no repeats, the app works out which task you drew from the encoding alone.

### Special tiles

A tile with `"special": true` lives in the landscape deck and is drawn like any other, but some
rules treat it differently. Results show its name in pink to mark it, and there is a "Special only"
filter. Special tiles are never among the three landscape tiles held out on the temple board, so
they are excluded when revealing one.

Special tiles carry a `name` — usually the name of the achievement that unlocks them — and often a
tag grouping them with others. Name, tags and encoding are all searchable, so the Daimyo answers to
`daim`, `imm` and `finish-task`, and `match-bonus` brings up all five tiles sharing that tag.

Searching by achievement name works for every tile, not just special ones, so `temples` finds the
three temple tiles and `wraparound` the six surround tasks. Task tiles also answer to their task
type, so `river` lists every river task.

### Temple tiles

Tiles with `"kind": "temple"` are the fixed special tiles on the temple board. They are never in
the landscape bag — at the start of a game they are placed straight onto the board, face up,
alongside three landscape tiles drawn face down from the deck. The board only appears once its
achievement has been unlocked.

### How connections are drawn

The renderer shows how the edges of a tile join up inside it, which the encoding does not record
directly. It works this out from the edge features:

- **Rivers and roads** always run to the middle of the tile. Two or more such edges meet in the
  centre; a lone one is drawn as a stub, i.e. the run ends on this tile.
- **Sakura, village, rice, hot springs and Mt. Fuji** are areas. Where the same one appears on
  edges that are *apart*, a band is drawn across the centre joining them — this is what makes the
  two rice edges of `vmgmgm` read as linked. Neighbouring edges already share a border, so they get
  nothing; a line through the middle of `vvvggg` would be clutter.
- **A flag belongs to the coloured area it stands in**, so a pink flag joins the sakura around it.
- **Meadow, clouds and the rainbow flag** are never linked. Meadow is the blank filler; the other
  two have no one definite terrain.

This is a derivation, not data: it holds because no two tiles share an edge sequence while
differing in how that sequence connects. If you hit a real tile that contradicts it, say so and
we can add a per-tile override.

### Copies vs. separate entries

Two physical tiles with the same design should be **one entry with `"copies": 2`**, not two
entries. The tracker then lets you draw that design twice before it disappears from search
results. If two entries end up identical the server logs a warning at startup naming both ids.

Every tile in the real deck is a singleton, so nothing currently sets `copies`.

## achievements.json

Groups tiles that unlock together, so the campaign screen offers a checklist of achievements
rather than a flat list of tiles.

```json
{
  "version": 1,
  "achievements": [
    { "id": "daimyo", "name": "Daimyo", "description": "optional" }
  ]
}
```

Tiles point at an achievement via their `unlock` field. An `unlock` naming an achievement that
isn't listed here is an error. The checklist is shown alphabetically by name.

Leave the list empty and the campaign screen falls back to unlocking tiles individually.

## Checking your work

```sh
go run .
```

Startup prints the number of tile designs loaded and any warnings. Validation errors name the
offending tile id.
