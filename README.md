# Dorfwatch

This web application is a helper for playing Dorfromantik: Sakura. It keeps track of the tiles that have been played, and allows querying the set left by various properties.

## Usage

### Tracking tiles

Click "Start a new campaign" to track the set of tiles you have available. This will persist as your "save file" throughout the campaign. You can always get back to the current state by checking the set of achievements you've unlocked, but persisting a save means that you don't have to do this every game.

Then, click "start game" to initialize the tracker for a specific play session.

Whenever you draw a tile, first click the button for what kind of tile it was (landscape or task). Then type enough of the tile to identify it — the box searches the same way as the main search bar, so a partial encoding, a special tile's name, or a tag all work, and you rarely need the full six characters. Nothing is listed until you type, and the matches appear once the list is short enough to pick from; click the one you drew, or press Enter when only one is left.

Temple tiles are not drawn, so they have no button here — play them from the temple board instead.

### Searching tiles

Tiles are taxonomized by their edge characteristics, which you can search in various ways:

* By edge sequence, by entering a partial-match in the search bar. This supports partial-matches with `.` as a wildcard - for instance, searching for "i.i" will return any tile that includes a river edge, then anything, then another river edge (i.e. a gentle-curve river).
* By overall characteristics, using the check boxes.
* By several terms at once, which are ANDed — "surr i" finds the surround tasks that have a river.
* Specific special tiles. For instance, searching for "daimyo" will show the Daimyo special tile.
  Special tiles are also found by their tag ("match-bonus", "distance") and by the name of the
  achievement that unlocks them; all of these match on partial text. Searching by achievement name
  works for ordinary tiles too, so "temples" finds the three temple tiles.

Search results will, by default, only return the tiles that haven't been played yet.

The named shape filters are:

| Filter | Matches |
| --- | --- |
| No roads or rivers | No road and no river edge at all |
| Dead end | A road or a river that stops here — exactly one edge of either |
| Road end | Exactly one road edge, so the road stops on this tile |
| River end | Exactly one river edge, so the river stops on this tile |
| Road–river crossing | At least two road and two river edges, so both run through |

You can also filter by kind (landscape / task) and by task type.

Flags and clouds match more than themselves, since that is how they play:

* A pink flag is a pink region, so searching sakura finds it. Likewise red flag / village and green
  flag / rice.
* The rainbow flag counts as any of the three flags, and as any of the three colours.
* A cloud can be played as any ordinary terrain, including a river or a road, so cloud tiles turn up
  in most searches and pass every shape filter. Hot springs and Mt. Fuji are the exception — they
  only ever appear on their own tiles, so a cloud is never one of them.

This only works one way: searching for a flag will not turn up plain terrain of that colour, and
only real clouds answer to a search for clouds.

"Must exclude" asks a different question from the rest — not "could this be a river?" but "must
this join one?". A cloud can be played as something else, so excluding rivers keeps cloud tiles;
a pink flag really is a pink region, so excluding sakura drops it.

### Task tiles

Every task tile carries one of seven task types: road, river, village, rice, sakura, surround, and
special-7. The first six each draw a value token from their own deck of **4, 4, 5, 5, 6, 6**.

The app tracks all six value decks for the current game. When you record a task tile it offers only
the values still left for that task type, and the search results show each task tile alongside what
its deck has left.

### Tile encoding

Every hex tile is represented by the features on its edges, plus some overlays. Every feature is represented by a single letter, which means that a tile can be represented by a six-character sequence. (The tracker can find tiles regardless of how you've rotated them; rmmrmm is the same tile as mmrmmr, so you can start entering however you pick up the tile).

The basic features are:
* R[i]ver
* [R]oad
* [P]ink sakura
* Red [v]illage
* [G]reen rice
* [H]ot springs
* Mt. Fu[j]i
* Blank / [M]eadow

Special features:
* [C]louds
* Flags: [1] for pink flag, [2] for red flag, [3] for green flag, [4] for the rainbow flag

In addition, a tile can have a cherry blossom, represented by a star after the feature that the star is on. This is only used in the search results, not searchable. For instance, `rppr*gg` is a straight-road piece with the cherry blossom on the road, whereas `rpp*rgg` is the same tile with the cherry blossom in the sakura forest.

Tiles are drawn showing how their edges join up inside the tile: rivers and roads run to the middle
(a lone one is drawn as a stub, meaning the run ends there), and where the same terrain appears on
several edges it is drawn as one area spanning the tile. See
[docs/TILE_DATA.md](docs/TILE_DATA.md#how-connections-are-drawn) for the exact rules.

### The temple board

The temple board is a side board holding six tiles: three fixed special temple tiles, plus three
tiles held out of the landscape deck face down at game start.

The app shows all six, once the Temples achievement is unlocked. The three held-out tiles start
face down; hit **Reveal** and search for the tile when you turn one over, and the app takes it out
of the landscape deck for the rest of the game — so it stops showing up in the search results. Any
face-up tile can be played straight from the board with **Play**, which records it exactly as if it
had been drawn.

Special tiles are never held out, so they are not offered when revealing.

Task tiles are tracked separately from the deck of landscape tiles. When a task tile is drawn, enter the tile as normal, then select the number that was drawn. (The app knows what kind of task it was based on the tile you entered, since there are no repeat tiles). Special-7 tasks always score 7, so those record without asking.

## Tech stack

Web-based UI; most of the work is done client-side. Server runs in Go and stores saves as files; run it locally.

The client is plain ES modules — no build step, no dependencies. The Go binary embeds them, so a
`go build` produces a single self-contained executable.

## Running it

```sh
go run .
```

It listens on port 8080 on every interface, so it is reachable both from the machine itself and
from anything else on the network — handy for pulling it up on a tablet at the table. Startup prints
the addresses it can be reached on:

```
dorfwatch listening on :8080
  http://localhost:8080
  http://192.168.86.86:8080
```

There is no login: anyone who can reach the port can read and change your campaigns. That is fine on
a home network, but on a shared or public one, restrict it with `-addr localhost:8080`.

Flags: `-addr` (default `:8080`), `-data` (tile catalog, default `./data`), `-saves` (campaign files,
default `./saves`), and `-dev` to serve `web/` from disk instead of the embedded copy while editing
the client.

The tile catalog in `data/` holds the full deck: 110 tile designs across 23 achievements. See
[docs/TILE_DATA.md](docs/TILE_DATA.md) for the format if you need to correct or add one. The server
validates it on startup and names the offending tile if anything is wrong.

## Tests

```sh
go test ./...     # server: encoding, catalog validation, save store
npm test          # client: encoding, search, deck maths, rendering (uses node --test, no deps)
```

The encoding rules are implemented on both sides — canonical rotation in `internal/tiles/tiles.go`
and `web/js/encoding.js` — and both test suites cover the same cases, since the server canonicalizes
the catalog that the client then matches against.
