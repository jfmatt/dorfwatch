// Tile encoding: parsing, canonical rotation and cyclic matching.
//
// This mirrors internal/tiles/tiles.go. The feature table is replaced with the
// server's copy at startup via setFeatures(), so the two never drift.

export const EDGES = 6;

let features = [
  { key: 'i', name: 'River', color: '#4c9be8', flag: false },
  { key: 'r', name: 'Road', color: '#6b4a2f', flag: false },
  { key: 'p', name: 'Sakura', color: '#ef8fb8', flag: false },
  { key: 'v', name: 'Village', color: '#d1495b', flag: false },
  { key: 'g', name: 'Rice', color: '#5c9e57', flag: false },
  { key: 'h', name: 'Hot spring', color: '#4fc3c0', flag: false },
  { key: 'j', name: 'Mt. Fuji', color: '#8a6a9c', flag: false },
  { key: 'm', name: 'Meadow', color: '#b7c98f', flag: false },
  { key: 'c', name: 'Clouds', color: '#ffffff', flag: false },
  { key: '1', name: 'Pink flag', color: '#ef8fb8', flag: true },
  { key: '2', name: 'Red flag', color: '#d1495b', flag: true },
  { key: '3', name: 'Green flag', color: '#5c9e57', flag: true },
  { key: '4', name: 'Rainbow flag', color: '#b07cd6', flag: true },
];

let byKey = index(features);

function index(list) {
  return new Map(list.map((f) => [f.key, f]));
}

/** Replace the feature table with the server's, keeping the two in step. */
export function setFeatures(list) {
  if (Array.isArray(list) && list.length) {
    features = list;
    byKey = index(features);
  }
}

export function allFeatures() {
  return features;
}

export function featureFor(ch) {
  return byKey.get(ch);
}

export function isFeature(ch) {
  return byKey.has(ch);
}

// --- flags and clouds ------------------------------------------------------

/**
 * A flag sits in a coloured region, so its edge is that terrain as well as the
 * flag. The rainbow flag counts as any of the three during play.
 */
const FLAG_TERRAIN = { 1: 'p', 2: 'v', 3: 'g' };
const RAINBOW = '4';

/** Clouds hide what is underneath, so the edge can be played as anything. */
const CLOUD = 'c';

/**
 * ...anything ordinary, at least. Hot springs and Mt. Fuji appear only on their
 * own handful of tiles, so a cloud is never hiding one.
 */
const NEVER_UNDER_CLOUD = new Set(['h', 'j']);

/** Everything a search may ask for that this edge should answer to. */
const ANSWERS = new Map([
  ['1', new Set(['1', 'p'])],
  ['2', new Set(['2', 'v'])],
  ['3', new Set(['3', 'g'])],
  ['4', new Set(['4', '1', '2', '3', 'p', 'v', 'g'])],
]);

/**
 * Does an edge answer to a search for `want`? Plain terrain matches only
 * itself; a flag also matches its colour; the rainbow flag matches all three
 * colours and all three flags; and a cloud matches any ordinary terrain, since
 * it can be played as whatever you need — but not hot springs or Mt. Fuji,
 * which only ever appear on their own tiles.
 *
 * The relation is one-way — searching for a pink flag does not turn up plain
 * sakura, and searching for clouds turns up only real clouds.
 */
export function edgeSatisfies(want, edge) {
  if (want === edge) return true;
  if (edge === CLOUD) return !NEVER_UNDER_CLOUD.has(want);
  return ANSWERS.get(edge)?.has(want) ?? false;
}

/** Is this edge a cloud, and so playable as anything? */
export function isCloud(ch) {
  return ch === CLOUD;
}

/** Can this tile be played as anything at all on at least one edge? */
export function hasCloud(edges) {
  return edges.includes(CLOUD);
}

/** Does any edge of this tile answer to a search for `want`? */
export function hasFeature(edges, want) {
  return [...edges].some((ch) => edgeSatisfies(want, ch));
}

/**
 * Edges that definitely are a given feature, with no choice left to the player.
 * A coloured flag really is a region of its colour, but a cloud and the rainbow
 * flag are only ever decided when the tile is placed.
 */
const DEFINITE = new Map([
  ['1', new Set(['1', 'p'])],
  ['2', new Set(['2', 'v'])],
  ['3', new Set(['3', 'g'])],
]);

/**
 * Is this edge necessarily `want`, rather than merely able to be played as it?
 * Used by "must exclude", which asks what a tile is committed to — a cloud does
 * not force a river connection, so excluding rivers should not rule it out.
 */
export function edgeDefinitelyIs(want, edge) {
  if (want === edge) return true;
  return DEFINITE.get(edge)?.has(want) ?? false;
}

/** Does this tile definitely carry `want` on some edge? */
export function definitelyHas(edges, want) {
  return [...edges].some((ch) => edgeDefinitelyIs(want, ch));
}

/**
 * The area an edge belongs to, for working out what connects through the
 * middle of a tile. A pink flag is part of the sakura area it stands in. The
 * rainbow flag has no one colour and a cloud hides what is underneath, so
 * neither can be said to join anything; both stay their own area.
 */
export function areaOf(ch) {
  return ch === RAINBOW || ch === CLOUD ? ch : (FLAG_TERRAIN[ch] ?? ch);
}

/** Is this edge a flag of any colour? */
export function isFlag(ch) {
  return ANSWERS.has(ch);
}

/**
 * Parse a tile encoding such as "rpp*rgg". A '*' marks the preceding edge, and
 * the blossom is recorded as that edge's feature — a blossom sits in the middle
 * of an area, not on one edge of it. Whitespace and separators are ignored,
 * input is lowercased. Throws on an illegal character.
 *
 * @returns {{edges: string, blossom: string}} blossom is '' when there is none
 */
export function parse(text, { allowWildcard = false } = {}) {
  let edges = '';
  let blossom = '';
  for (const raw of String(text)) {
    const ch = raw.toLowerCase();
    if (ch === ' ' || ch === '\t' || ch === '-' || ch === '_') continue;
    if (ch === '*') {
      if (!edges.length) throw new Error("'*' must follow an edge");
      const feature = edges[edges.length - 1];
      if (feature === '.') throw new Error("'*' cannot follow a wildcard");
      if (blossom && blossom !== feature) {
        throw new Error('a tile has at most one cherry blossom');
      }
      blossom = feature;
      continue;
    }
    if (allowWildcard && ch === '.') {
      edges += '.';
      continue;
    }
    if (!isFeature(ch)) throw new Error(`"${raw}" is not a tile feature`);
    edges += ch;
  }
  return { edges, blossom };
}

/**
 * Render an edge string and blossom feature back into the '*' notation, marking
 * the first edge of the feature the blossom sits on.
 */
export function format(edges, blossom) {
  if (!blossom) return edges;
  const i = edges.indexOf(blossom);
  if (i < 0) return edges;
  return `${edges.slice(0, i + 1)}*${edges.slice(i + 1)}`;
}

/** All six rotations of an edge string. */
export function rotations(edges) {
  const out = [];
  for (let shift = 0; shift < edges.length; shift += 1) {
    out.push(edges.slice(shift) + edges.slice(0, shift));
  }
  return out;
}

/**
 * Canonical rotation: the lexicographically smallest rotation. The blossom is a
 * feature rather than an edge, so rotation leaves it alone.
 *
 * @returns {{edges: string, blossom: string}}
 */
export function canonical(edges, blossom = '') {
  if (edges.length !== EDGES) {
    throw new Error(`want ${EDGES} edges, got ${edges.length}`);
  }
  if (blossom && !edges.includes(blossom)) {
    throw new Error(`blossom is on "${blossom}", which is not an edge of "${edges}"`);
  }
  let best = edges;
  for (let shift = 1; shift < EDGES; shift += 1) {
    const rotated = edges.slice(shift) + edges.slice(0, shift);
    if (rotated < best) best = rotated;
  }
  return { edges: best, blossom };
}

/**
 * Does `pattern` occur anywhere in the cyclic edge string? '.' matches any one
 * feature, and flags answer to their colour as well as themselves — see
 * edgeSatisfies. An empty pattern matches everything; one longer than a tile
 * never matches.
 */
export function match(pattern, edges) {
  if (!pattern) return true;
  if (pattern.length > edges.length) return false;
  const doubled = edges + edges;
  for (let start = 0; start < edges.length; start += 1) {
    let ok = true;
    for (let i = 0; i < pattern.length; i += 1) {
      const p = pattern[i];
      if (p !== '.' && !edgeSatisfies(p, doubled[start + i])) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

/** Two tiles are the same design if their canonical edges and blossom match. */
export function sameDesign(a, b) {
  return a.edges === b.edges && (a.blossom ?? null) === (b.blossom ?? null);
}
