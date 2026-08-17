import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canonical, parse } from '../web/js/encoding.js';
import {
  DEFAULT_FILTERS,
  SHAPES,
  filterableFeatures,
  findByEncoding,
  parseQuery,
  searchTiles,
  searchWords,
} from '../web/js/search.js';

/**
 * Build a tile the way the server hands it over: edges in the rotation they
 * were recorded in, plus the canonical form that findByEncoding matches on.
 */
function tile(id, edges, extra = {}) {
  const base = { id, kind: 'landscape', blossom: '', copies: 1, ...extra };
  return { ...base, edges, canonical: canonical(edges, base.blossom).edges };
}

const DECK = [
  tile('meadow', 'mmmmmm'),
  tile('river-through', 'immimm'),
  tile('river-curve', 'imimmm'),
  tile('river-end', 'immmmm'),
  tile('road-end', 'rmmmmm'),
  tile('road-through', 'rmmrmm'),
  tile('crossing', 'rimrim'),
  tile('road-river-end', 'rimmmm'),
  tile('rice-sakura', 'ggppmm', { blossom: 'p' }),
  tile('hot-springs', 'hmhmmm'),
  tile('cloudy', 'cmmmmm'),
  tile('flagged', '1mmmmm'),
  tile('pink-flag-village', '1mmvvm'),
  tile('green-flag-sakura', '3mppmm'),
  tile('rainbow-flag', '4mmmmm'),
  tile('daimyo', 'vvmrmm', { kind: 'task', task: 'village', name: 'Daimyo' }),
  tile('river-task', 'immmmm', { kind: 'task', task: 'river' }),
];

const NAMED = [
  tile('daimyo-special', 'immmmm', {
    name: 'Daimyo',
    special: true,
    unlock: 'daimyo',
    tags: ['finish-task'],
  }),
  tile('sumo', 'vvvvvv', {
    name: 'Sumo Wrestler',
    special: true,
    unlock: 'sumo-wrestler',
    tags: ['match-bonus'],
  }),
  tile('moss', 'pppppp', {
    name: 'Moss Collector',
    special: true,
    unlock: 'moss-collector',
    tags: ['match-bonus'],
  }),
  tile('temple-tile', 'vmgmgm', { kind: 'temple', unlock: 'temples' }),
  tile('river-task-a', 'immimm', { kind: 'task', task: 'river' }),
  tile('river-task-b', 'imimmm', { kind: 'task', task: 'river' }),
  tile('road-task-a', 'rmmrmm', { kind: 'task', task: 'road' }),
  tile('rice-task-a', 'gggggg', { kind: 'task', task: 'rice' }),
  // A special-7 task naming two terrains: it counts as either of them.
  tile('seven-rice-sakura', 'hmpmgm', {
    kind: 'task',
    task: 'special-7',
    alsoTasks: ['rice', 'sakura'],
  }),
];

const TASK_TYPES = [
  { key: 'road', name: 'Road', color: '#6b4a2f' },
  { key: 'river', name: 'River', color: '#4c9be8' },
  { key: 'rice', name: 'Rice', color: '#5c9e57' },
  { key: 'sakura', name: 'Sakura', color: '#ef8fb8' },
  { key: 'special-7', name: 'Special 7', fixed: 7, color: '#d8a13a' },
];

const ACHIEVEMENTS = [
  { id: 'daimyo', name: 'Daimyo' },
  { id: 'sumo-wrestler', name: 'Sumo Wrestler' },
  { id: 'moss-collector', name: 'Moss Collector' },
  { id: 'temples', name: 'Temples' },
];

const filters = (over = {}) => ({ ...DEFAULT_FILTERS, ...over });
const allRemaining = () => 1;
const ids = (r) => r.results.map((t) => t.id).sort();
const CATALOG = { achievements: ACHIEVEMENTS, taskTypes: TASK_TYPES };
const named = (q, over = {}) =>
  searchTiles(NAMED, filters({ query: q, ...over }), allRemaining, CATALOG)
    .results.map((t) => t.id)
    .sort();

test('an empty query returns the whole deck', () => {
  const { results } = searchTiles(DECK, filters(), allRemaining);
  assert.equal(results.length, DECK.length);
});

test('a query is read as an edge pattern', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ query: 'i.i' }), allRemaining)), ['river-curve']);
});

test('a query that is not an encoding is read as a tile name', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ query: 'daimyo' }), allRemaining)), ['daimyo']);
});

test('parseQuery separates the two readings', () => {
  assert.deepEqual(parseQuery('i.i'), { pattern: 'i.i', name: 'i.i', error: null });
  assert.equal(parseQuery('daimyo').pattern, null, 'd, a and y are not features');
  assert.deepEqual(parseQuery(''), { pattern: null, name: null, error: null });
});

test('must-include and must-exclude filters', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['r', 'i'] }), allRemaining)), [
    'cloudy',
    'crossing',
    'road-river-end',
  ]);
  const noRivers = searchTiles(DECK, filters({ exclude: ['i'] }), allRemaining);
  assert.equal(
    noRivers.results.some((t) => t.edges.includes('i')),
    false,
  );
});

test('shape filter: no roads or rivers', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ shapes: ['no-road-river'] }), allRemaining)), [
    'cloudy',
    'flagged',
    'green-flag-sakura',
    'hot-springs',
    'meadow',
    'pink-flag-village',
    'rainbow-flag',
    'rice-sakura',
  ]);
});

test('searching a colour also finds flags of that colour', () => {
  // Sakura: the plain sakura tile, the pink flag tiles, and the rainbow flag.
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['p'] }), allRemaining)), [
    'cloudy',
    'flagged',
    'green-flag-sakura',
    'pink-flag-village',
    'rainbow-flag',
    'rice-sakura',
  ]);
  // Rice: only the green flag and the rainbow, since no plain rice tile is here.
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['g'] }), allRemaining)), [
    'cloudy',
    'green-flag-sakura',
    'rainbow-flag',
    'rice-sakura',
  ]);
});

test('searching a flag does not find plain terrain of that colour', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['1'] }), allRemaining)), [
    'cloudy',
    'flagged',
    'pink-flag-village',
    'rainbow-flag',
  ]);
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['4'] }), allRemaining)), [
    'cloudy',
    'rainbow-flag',
  ]);
});

test('excluding a colour rules out flags of that colour, which really are it', () => {
  const noSakura = searchTiles(DECK, filters({ exclude: ['p'] }), allRemaining);
  assert.equal(noSakura.results.some((t) => t.id === 'pink-flag-village'), false);
  assert.equal(noSakura.results.some((t) => t.id === 'green-flag-sakura'), false);
  assert.equal(noSakura.results.some((t) => t.id === 'meadow'), true);
});

test('the flag-tiles-only filter shows every flag and nothing else', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ hasFlag: true }), allRemaining)), [
    'flagged',
    'green-flag-sakura',
    'pink-flag-village',
    'rainbow-flag',
  ]);
});

test('a cloud tile turns up in every search, because it can be played as anything', () => {
  for (const key of ['i', 'r', 'p', 'v', 'g']) {
    const found = ids(searchTiles(DECK, filters({ include: [key] }), allRemaining));
    assert.ok(found.includes('cloudy'), `including ${key} should still show the cloud tile`);
  }
  // ...except the two terrains a cloud is never hiding.
  for (const key of ['h', 'j']) {
    const found = ids(searchTiles(DECK, filters({ include: [key] }), allRemaining));
    assert.equal(found.includes('cloudy'), false, `including ${key} should not show it`);
  }
  for (const shape of SHAPES) {
    const found = ids(searchTiles(DECK, filters({ shapes: [shape.key] }), allRemaining));
    assert.ok(found.includes('cloudy'), `${shape.key} should still show the cloud tile`);
  }
});

test('excluding a feature keeps cloud tiles, which never commit to it', () => {
  // "No rivers" means "nothing that must join a river". A cloud can be played
  // as something else, so it is not ruled out.
  const noRivers = searchTiles(DECK, filters({ exclude: ['i'] }), allRemaining);
  assert.equal(noRivers.results.some((t) => t.id === 'cloudy'), true);
  assert.equal(noRivers.results.some((t) => t.id === 'river-through'), false);

  // The rainbow flag is the same: it need not be played as sakura.
  const noSakura = searchTiles(DECK, filters({ exclude: ['p'] }), allRemaining);
  assert.equal(noSakura.results.some((t) => t.id === 'rainbow-flag'), true);

  // Excluding clouds themselves still works.
  const noClouds = searchTiles(DECK, filters({ exclude: ['c'] }), allRemaining);
  assert.equal(noClouds.results.some((t) => t.id === 'cloudy'), false);
});

test('searching for clouds finds only real clouds', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['c'] }), allRemaining)), ['cloudy']);
  assert.deepEqual(ids(searchTiles(DECK, filters({ hasClouds: true }), allRemaining)), ['cloudy']);
});

test('a special tile is found by its name, its encoding and its tag', () => {
  // The three ways to reach the Daimyo.
  assert.deepEqual(named('daim'), ['daimyo-special'], 'partial name');
  assert.deepEqual(named('Daimyo'), ['daimyo-special'], 'full name, any case');
  assert.deepEqual(named('finish-task'), ['daimyo-special'], 'its tag');
  assert.ok(named('imm').includes('daimyo-special'), 'its edge sequence');
});

test('a tag groups several special tiles', () => {
  assert.deepEqual(named('match-bonus'), ['moss', 'sumo']);
  assert.deepEqual(named('match'), ['moss', 'sumo'], 'partial tag');
});

test('tiles are found by the name of the achievement that unlocks them', () => {
  assert.deepEqual(named('temples'), ['temple-tile']);
  assert.deepEqual(named('temp'), ['temple-tile'], 'partial achievement name');
});

test('searchWords gathers a tile name, its tags and its achievement', () => {
  const lookup = {
    achievements: new Map(ACHIEVEMENTS.map((a) => [a.id, a.name])),
    taskTypes: new Map(TASK_TYPES.map((t) => [t.key, t.name])),
  };
  assert.equal(searchWords(NAMED[0], lookup), 'daimyo finish-task daimyo');
  assert.equal(searchWords(NAMED[3], lookup), 'temples', 'a tile with no name of its own');
  assert.equal(searchWords(NAMED[4], lookup), 'river', 'a task tile answers to its type');
  assert.equal(searchWords({ edges: 'mmmmmm' }, lookup), '', 'a plain tile has no words');
});

test('naming a task type brings up every tile of that type', () => {
  assert.deepEqual(named('river'), ['river-task-a', 'river-task-b']);
  assert.deepEqual(named('road'), ['road-task-a']);
  assert.deepEqual(named('Road'), ['road-task-a'], 'case does not matter');
});

test('several terms are ANDed, each read on its own', () => {
  const deck = [
    tile('surround-river-rice', 'imgggm', { kind: 'task', task: 'surround' }),
    tile('surround-river-sakura', 'impppm', { kind: 'task', task: 'surround' }),
    tile('surround-road-rice', 'rmgggm', { kind: 'task', task: 'surround' }),
    tile('river-task', 'immimm', { kind: 'task', task: 'river' }),
  ];
  const catalog = {
    taskTypes: [
      { key: 'river', name: 'River' },
      { key: 'surround', name: 'Surround' },
    ],
  };
  const find = (q) =>
    searchTiles(deck, filters({ query: q }), allRemaining, catalog)
      .results.map((t) => t.id)
      .sort();

  // A word and an encoding together: surround tasks that have a river.
  assert.deepEqual(find('surr i'), ['surround-river-rice', 'surround-river-sakura']);
  // Order does not matter.
  assert.deepEqual(find('i surr'), ['surround-river-rice', 'surround-river-sakura']);
  // Two encodings together.
  assert.deepEqual(find('i ggg'), ['surround-river-rice']);
  // Either term alone is broader.
  assert.equal(find('surr').length, 3);
  assert.equal(find('i').length, 3);
  // Terms that cannot both hold give nothing.
  assert.deepEqual(find('surr vvv'), []);
});

test('a multi-word name still works, term by term', () => {
  const deck = [
    tile('ox-cart', 'rmgrvv', { name: 'Ox Cart & Trading Post', special: true }),
    tile('cartographer', 'vmpmgm', { name: 'Cartographer', special: true }),
  ];
  const find = (q) =>
    searchTiles(deck, filters({ query: q }), allRemaining, {})
      .results.map((t) => t.id)
      .sort();
  assert.deepEqual(find('cart'), ['cartographer', 'ox-cart'], 'one term matches both');
  assert.deepEqual(find('ox cart'), ['ox-cart'], 'both terms must hold');
});

test('an encoding-shaped query is matched against edges, not names', () => {
  // "rr" is two road edges. It must not drag in every tile whose words happen
  // to contain those letters — "Surround" does.
  const deck = [
    tile('two-roads', 'rrmmmm'),
    tile('surround-task', 'imgggm', { kind: 'task', task: 'surround' }),
  ];
  const catalog = {
    achievements: [],
    taskTypes: [{ key: 'surround', name: 'Surround' }],
  };
  const found = searchTiles(deck, filters({ query: 'rr' }), allRemaining, catalog)
    .results.map((t) => t.id);
  assert.deepEqual(found, ['two-roads']);

  // The word itself still finds it.
  assert.deepEqual(
    searchTiles(deck, filters({ query: 'surround' }), allRemaining, catalog)
      .results.map((t) => t.id),
    ['surround-task'],
  );
});

test('a name made only of edge letters is still reachable', () => {
  // "prig" parses as a pattern, but no tile has those edges, so the text
  // search gets its turn rather than the query coming back empty.
  const deck = [tile('named', 'mmmmmm', { name: 'Prig', special: true })];
  assert.deepEqual(
    searchTiles(deck, filters({ query: 'prig' }), allRemaining, {}).results.map((t) => t.id),
    ['named'],
  );
});

test('a special-7 task counts as both the types it names', () => {
  // Searching either terrain turns it up alongside that terrain's own tasks.
  assert.deepEqual(named('rice'), ['rice-task-a', 'seven-rice-sakura']);
  assert.deepEqual(named('sakura'), ['seven-rice-sakura']);
  assert.deepEqual(named('special'), ['seven-rice-sakura'], 'and still by its own type');

  // The task-type filter does the same.
  const byFilter = (key) =>
    searchTiles(NAMED, filters({ taskTypes: [key] }), allRemaining, CATALOG)
      .results.map((t) => t.id)
      .sort();
  assert.deepEqual(byFilter('rice'), ['rice-task-a', 'seven-rice-sakura']);
  assert.deepEqual(byFilter('sakura'), ['seven-rice-sakura']);
  assert.deepEqual(byFilter('river'), ['river-task-a', 'river-task-b'], 'unrelated types unaffected');
});

test('task results are grouped by task type, in catalog order', () => {
  const tasks = searchTiles(
    NAMED,
    filters({ kinds: ['task'] }),
    allRemaining,
    CATALOG,
  ).results.map((t) => t.task);
  const order = TASK_TYPES.map((t) => t.key);
  const ranks = tasks.map((k) => order.indexOf(k));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `grouped wrongly: ${tasks}`);
  assert.equal(tasks[0], 'road', 'road comes first, as in the catalog');
});

test('the special-only filter picks out the named tiles', () => {
  const all = searchTiles(NAMED, filters(), allRemaining, CATALOG).results;
  assert.equal(all.length, 9);
  const special = searchTiles(NAMED, filters({ specialOnly: true }), allRemaining, CATALOG);
  assert.deepEqual(
    special.results.map((t) => t.id).sort(),
    ['daimyo-special', 'moss', 'sumo'],
  );
});

test('searching by name works without any achievements loaded', () => {
  const found = searchTiles(NAMED, filters({ query: 'sumo' }), allRemaining);
  assert.deepEqual(
    found.results.map((t) => t.id),
    ['sumo'],
  );
});

test('every feature chip that behaves unusually explains itself', () => {
  const hints = Object.fromEntries(filterableFeatures().map((f) => [f.key, f.hint]));
  for (const key of ['p', 'v', 'g', '1', '2', '3', '4', 'c']) {
    assert.ok(hints[key], `${key} should carry a hint about flag matching`);
  }
  assert.equal(hints.m, null, 'ordinary features need no hint');
});

test('hot springs are a searchable feature', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ include: ['h'] }), allRemaining)), [
    'hot-springs',
  ]);
  assert.deepEqual(ids(searchTiles(DECK, filters({ query: 'h.h' }), allRemaining)), ['hot-springs']);
});

test('shape filter: dead end covers a road or a river stopping here', () => {
  const found = ids(searchTiles(DECK, filters({ shapes: ['dead-end'] }), allRemaining));
  // Everything the two single-feature filters find, in one option.
  const roadEnds = ids(searchTiles(DECK, filters({ shapes: ['road-end'] }), allRemaining));
  const riverEnds = ids(searchTiles(DECK, filters({ shapes: ['river-end'] }), allRemaining));
  assert.deepEqual(found, [...new Set([...roadEnds, ...riverEnds])].sort());
  for (const id of ['road-end', 'river-end', 'river-task', 'road-river-end', 'daimyo']) {
    assert.ok(found.includes(id), `${id} should count as a dead end`);
  }
  // A cloud edge can be played as a dead end, so cloud tiles are kept.
  assert.ok(found.includes('cloudy'), 'a cloud can serve as a dead end');
  for (const id of ['river-through', 'road-through', 'crossing', 'meadow']) {
    assert.equal(found.includes(id), false, `${id} runs through, so it is not a dead end`);
  }
});

test('shape filter: road end is exactly one road edge', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ shapes: ['road-end'] }), allRemaining)), [
    'cloudy',
    'daimyo',
    'road-end',
    'road-river-end',
  ]);
});

test('shape filter: river end is exactly one river edge', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ shapes: ['river-end'] }), allRemaining)), [
    'cloudy',
    'river-end',
    'river-task',
    'road-river-end',
  ]);
});

test('shape filter: road-river crossing needs both to run through', () => {
  assert.deepEqual(
    ids(searchTiles(DECK, filters({ shapes: ['road-river-crossing'] }), allRemaining)),
    ['cloudy', 'crossing'],
  );
});

test('shape filters stack', () => {
  const both = searchTiles(DECK, filters({ shapes: ['road-end', 'river-end'] }), allRemaining);
  assert.deepEqual(ids(both), ['cloudy', 'road-river-end'], 'a crossing is not an end of either');
});

test('every shape has a label and a hint', () => {
  for (const shape of SHAPES) {
    assert.ok(shape.label && shape.hint, `${shape.key} needs a label and hint`);
  }
});

test('kind and task type filters', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ kinds: ['task'] }), allRemaining)), [
    'daimyo',
    'river-task',
  ]);
  assert.deepEqual(ids(searchTiles(DECK, filters({ taskTypes: ['river'] }), allRemaining)), [
    'river-task',
  ]);
});

test('toggle filters', () => {
  assert.deepEqual(ids(searchTiles(DECK, filters({ hasBlossom: true }), allRemaining)), [
    'rice-sakura',
  ]);
  assert.deepEqual(ids(searchTiles(DECK, filters({ hasClouds: true }), allRemaining)), ['cloudy']);
  // The cloud tile counts: its only definite terrain is meadow.
  assert.deepEqual(ids(searchTiles(DECK, filters({ singleTerrain: true }), allRemaining)), [
    'cloudy',
    'meadow',
  ]);
});

test('unplayedOnly hides tiles with no copies left', () => {
  const remaining = (t) => (t.id === 'meadow' ? 0 : 1);
  const shown = searchTiles(DECK, filters({ unplayedOnly: true }), remaining);
  assert.equal(shown.results.some((t) => t.id === 'meadow'), false);
  const all = searchTiles(DECK, filters({ unplayedOnly: false }), remaining);
  assert.equal(all.results.some((t) => t.id === 'meadow'), true);
});

test('findByEncoding ignores rotation', () => {
  for (const spelling of ['immimm', 'mmimmi', 'mimmim']) {
    const found = findByEncoding(DECK, parse(spelling), 'landscape');
    assert.deepEqual(
      found.map((t) => t.id),
      ['river-through'],
      spelling,
    );
  }
});

test('findByEncoding narrows on the kind', () => {
  assert.deepEqual(
    findByEncoding(DECK, parse('immmmm'), 'landscape').map((t) => t.id),
    ['river-end'],
  );
  assert.deepEqual(
    findByEncoding(DECK, parse('immmmm'), 'task').map((t) => t.id),
    ['river-task'],
  );
  assert.equal(findByEncoding(DECK, parse('immmmm'), null).length, 2, 'no kind matches both');
});

test('findByEncoding uses the blossom to pick between variants', () => {
  const variants = [
    tile('blossom-on-rice', 'ggppmm', { blossom: 'g' }),
    tile('blossom-on-sakura', 'ggppmm', { blossom: 'p' }),
    tile('no-blossom', 'ggppmm'),
  ];
  assert.equal(findByEncoding(variants, parse('ggppmm'), null).length, 3, 'no blossom given');
  assert.deepEqual(
    findByEncoding(variants, parse('g*gppmm'), null).map((t) => t.id),
    ['blossom-on-rice'],
  );
  assert.deepEqual(
    findByEncoding(variants, parse('ggp*pmm'), null).map((t) => t.id),
    ['blossom-on-sakura'],
  );
  // Which edge of the feature carries the '*' makes no difference.
  for (const spelling of ['gg*ppmm', 'g*gppmm', 'ppmmg*g', 'ppmmgg*']) {
    assert.deepEqual(
      findByEncoding(variants, parse(spelling), null).map((t) => t.id),
      ['blossom-on-rice'],
      spelling,
    );
  }
});
