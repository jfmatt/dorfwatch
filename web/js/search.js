// Searching the remaining tiles.
//
// A query is read as an edge pattern when every character is a feature or the
// '.' wildcard, and as a tile-name substring otherwise. When it reads as both,
// results are the union — so "daimyo" finds the named tile and "i.i" finds
// gentle river curves.

import {
  allFeatures,
  canonical,
  definitelyHas,
  hasCloud,
  hasFeature,
  isCloud,
  isFeature,
  isFlag,
  match,
  parse,
} from './encoding.js';

export const DEFAULT_FILTERS = Object.freeze({
  query: '',
  include: [], // feature keys that must all appear
  exclude: [], // feature keys that must not appear
  kinds: [], // empty means every kind
  taskTypes: [], // empty means every task type
  shapes: [], // keys from SHAPES, all of which must hold
  hasBlossom: false,
  hasClouds: false,
  hasFlag: false,
  specialOnly: false,
  singleTerrain: false,
  unplayedOnly: true,
});

/**
 * The words a tile can be found by: its own name, its tags, the name of the
 * achievement that unlocks it, and — for a task tile — its task type. So the
 * Daimyo answers to "daim", the Sumo Wrestler to both "sumo" and "match-bonus",
 * and "river" brings up every river task at once.
 */
export function searchWords(tile, { achievements = new Map(), taskTypes = new Map() } = {}) {
  return [
    tile.name ?? '',
    ...(tile.tags ?? []),
    achievements.get(tile.unlock) ?? '',
    ...tasksOf(tile).map((key) => taskTypes.get(key) ?? ''),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Every task type a tile counts as. The special-7 tasks name two terrains and
 * may be scored as either, so they belong to all of them.
 */
export function tasksOf(tile) {
  if (!tile.task) return [];
  return [tile.task, ...(tile.alsoTasks ?? [])];
}

const count = (edges, key) => [...edges].filter((ch) => ch === key).length;

/**
 * Named shapes of the edge sequence. These are the questions that come up at
 * the table often enough to deserve a button rather than a search string.
 */
export const SHAPES = [
  {
    key: 'no-road-river',
    label: 'No roads or rivers',
    hint: 'No road and no river edge at all',
    test: (t) => !t.edges.includes('r') && !t.edges.includes('i'),
  },
  {
    key: 'dead-end',
    label: 'Dead end',
    hint: 'A road or a river that stops on this tile — exactly one edge of either',
    test: (t) => count(t.edges, 'r') === 1 || count(t.edges, 'i') === 1,
  },
  {
    key: 'road-end',
    label: 'Road end',
    hint: 'Exactly one road edge, so the road stops here',
    test: (t) => count(t.edges, 'r') === 1,
  },
  {
    key: 'river-end',
    label: 'River end',
    hint: 'Exactly one river edge, so the river stops here',
    test: (t) => count(t.edges, 'i') === 1,
  },
  {
    key: 'road-river-crossing',
    label: 'Road–river crossing',
    hint: 'At least two road and two river edges, so both run through the tile',
    test: (t) => count(t.edges, 'r') >= 2 && count(t.edges, 'i') >= 2,
  },
];

const shapeByKey = new Map(SHAPES.map((s) => [s.key, s]));

/**
 * Split the query box into whitespace-separated terms. Each is read on its own
 * and they are ANDed, so "surr i" means surround tasks that have a river.
 */
export function parseTokens(raw) {
  return String(raw ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(parseQuery);
}

/** Interpret one search term. */
export function parseQuery(raw) {
  const text = raw.trim();
  if (!text) return { pattern: null, name: null, error: null };

  const name = text.toLowerCase();
  let pattern = null;
  let error = null;

  // '*' is allowed so an encoding copied from a result still reads as one; the
  // blossom it marks is ignored, since blossoms are not searchable.
  const looksLikePattern = [...text].every(
    (ch) => ch === '.' || ch === ' ' || ch === '*' || isFeature(ch.toLowerCase()),
  );
  if (looksLikePattern) {
    try {
      pattern = parse(text, { allowWildcard: true }).edges;
    } catch (err) {
      error = err.message;
    }
  }
  return { pattern, name, error };
}

function hasFlagEdge(tile) {
  return [...tile.edges].some(isFlag);
}

/**
 * How many different terrains the tile definitely shows. Clouds are not
 * counted, since they could be any of the others.
 */
function distinctFeatures(tile) {
  return new Set([...tile.edges].filter((ch) => !isCloud(ch))).size;
}

/**
 * Filter and rank tiles.
 *
 * @param tiles catalog tiles already restricted to the campaign's deck
 * @param filters see DEFAULT_FILTERS
 * @param remaining (tile) => copies left this game
 */
export function searchTiles(tiles, filters, remaining, catalog = {}) {
  const terms = parseTokens(filters.query);
  const error = terms.find((t) => t.error)?.error ?? null;
  const names = {
    achievements: new Map((catalog.achievements ?? []).map((a) => [a.id, a.name])),
    taskTypes: new Map((catalog.taskTypes ?? []).map((t) => [t.key, t.name])),
  };
  const kinds = new Set(filters.kinds);
  const include = filters.include ?? [];
  const exclude = filters.exclude ?? [];

  const taskTypes = new Set(filters.taskTypes);
  const shapes = (filters.shapes ?? []).map((key) => shapeByKey.get(key)).filter(Boolean);

  const eligible = tiles.filter((tile) => {
    if (filters.unplayedOnly && remaining(tile) <= 0) return false;
    if (kinds.size && !kinds.has(tile.kind)) return false;
    if (taskTypes.size && !tasksOf(tile).some((key) => taskTypes.has(key))) return false;

    // Include asks what a tile could be, so a cloud or a flag's colour counts.
    // Exclude asks what it is committed to — "no rivers" means "nothing that
    // must join a river", which a cloud never does.
    if (include.some((key) => !hasFeature(tile.edges, key))) return false;
    if (exclude.some((key) => definitelyHas(tile.edges, key))) return false;

    if (filters.hasBlossom && !tile.blossom) return false;
    if (filters.hasClouds && !hasCloud(tile.edges)) return false;
    if (filters.hasFlag && !hasFlagEdge(tile)) return false;
    if (filters.specialOnly && !tile.special) return false;
    if (filters.singleTerrain && distinctFeatures(tile) > 1) return false;

    // A cloud edge can be played as anything, so a tile carrying one could take
    // any of these shapes. Rather than guess, keep it in the results.
    if (!hasCloud(tile.edges) && shapes.some((shape) => !shape.test(tile))) return false;
    return true;
  });

  // Every term has to hold, so narrow by each in turn.
  const results = terms.reduce((left, term) => applyTerm(left, term, names), eligible);

  // Group task tiles by their type, in catalog order, so a mixed result set
  // reads as road tasks, then river tasks, and so on.
  const taskOrder = new Map((catalog.taskTypes ?? []).map((t, i) => [t.key, i]));
  const rank = (tile) => taskOrder.get(tile.task) ?? Number.MAX_SAFE_INTEGER;
  results.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      rank(a) - rank(b) ||
      a.edges.localeCompare(b.edges) ||
      a.id.localeCompare(b.id),
  );
  return { results, error };
}

/**
 * Tiles in the deck matching an exact six-edge encoding, ignoring rotation.
 * A blossom in the input narrows the match; leaving it out matches every
 * blossom variant.
 */
export function findByEncoding(tiles, { edges, blossom }, kind) {
  // Catalog tiles arrive already canonicalized by the server, so putting the
  // input in the same rotation reduces the comparison to equality.
  const wanted = canonical(edges, blossom);
  return tiles.filter((tile) => {
    if (kind && tile.kind !== kind) return false;
    // Tiles are drawn in the rotation they were recorded in, so compare against
    // the canonical form the server derives alongside it.
    const key = tile.canonical || canonical(tile.edges, tile.blossom).edges;
    if (key !== wanted.edges) return false;
    // Naming no blossom matches every variant; naming one narrows to it.
    if (!wanted.blossom) return true;
    return tile.blossom === wanted.blossom;
  });
}

/**
 * Narrow by one search term.
 *
 * An encoding wins over a name: a term made only of edge characters is read as
 * a pattern and matched against edges alone, so "rr" means two road edges and
 * not every tile whose name happens to contain those letters — "Surround" does.
 * The text search gets its turn only when the pattern finds nothing, which is
 * what lets a name made of edge letters still be reachable.
 */
function applyTerm(tiles, { pattern, name }, names) {
  if (pattern === null && name === null) return tiles;
  const byText = () => tiles.filter((tile) => searchWords(tile, names).includes(name));
  if (pattern === null) return byText();

  const byPattern = tiles.filter((tile) => match(pattern, tile.edges));
  return byPattern.length ? byPattern : byText();
}

/** What else a search for this feature will turn up, for the chip tooltips. */
const ALSO_MATCHES = {
  p: 'also finds the pink flag and the rainbow flag',
  v: 'also finds the red flag and the rainbow flag',
  g: 'also finds the green flag and the rainbow flag',
  1: 'also found by searching sakura; the rainbow flag counts as one',
  2: 'also found by searching village; the rainbow flag counts as one',
  3: 'also found by searching rice; the rainbow flag counts as one',
  4: 'counts as any flag, and as sakura, village or rice',
  c: 'a cloud edge can be played as anything, so cloud tiles answer every search',
};

/** Row-level explanations for the two feature rows, which differ subtly. */
export const INCLUDE_HINT =
  'Tiles that could show this — a cloud counts, and so does a flag of that colour';
export const EXCLUDE_HINT =
  'Tiles committed to this. Clouds and the rainbow flag are kept, since they need not be played as it';

/** Feature keys in display order, for building the filter checkboxes. */
export function filterableFeatures() {
  return allFeatures().map((f) => ({ ...f, hint: ALSO_MATCHES[f.key] ?? null }));
}
