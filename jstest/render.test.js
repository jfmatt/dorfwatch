import { installDOM, byClass } from './dom-stub.js';

const { app, fire } = installDOM({ hash: '' });

import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderHex, renderHexBack, connections } = await import('../web/js/hex.js');
const { allFeatures } = await import('../web/js/encoding.js');

const colorOf = (key) => allFeatures().find((f) => f.key === key).color;
const bandsOf = (svg) => byClass(svg, 'hex-band');

test('renderHex draws one band per edge, in encoding order', () => {
  const svg = renderHex({ edges: 'irpvgm', blossom: '', kind: 'landscape' });
  const bands = bandsOf(svg);
  assert.equal(bands.length, 6);
  assert.deepEqual(
    bands.map((b) => b.getAttribute('fill')),
    [...'irpvgm'].map(colorOf),
  );
});

test('renderHex labels each band for screen readers', () => {
  const svg = renderHex({ edges: 'immmmm', blossom: '', kind: 'landscape' });
  const bandTitles = bandsOf(svg).map((b) => b.children[0].textContent);
  assert.equal(bandTitles[0], 'River edge');
  assert.equal(bandTitles[1], 'Meadow edge');
  assert.equal(svg.getAttribute('aria-label'), 'Tile immmmm');
});

/** Where a translated group sits, as a distance from the middle of the tile. */
function distanceFromCentre(group) {
  const [x, y] = group
    .getAttribute('transform')
    .match(/-?\d+(\.\d+)?/g)
    .map(Number);
  return Math.hypot(x, y);
}

test('renderHex marks the blossom once, on its feature', () => {
  const plain = renderHex({ edges: 'ggppmm', blossom: '', kind: 'landscape' });
  assert.equal(byClass(plain, 'hex-blossom').length, 0);

  const withBlossom = renderHex({ edges: 'ggppmm', blossom: 'p', kind: 'landscape' });
  assert.equal(byClass(withBlossom, 'hex-blossom').length, 1, 'one blossom, not one per edge');
  assert.equal(withBlossom.getAttribute('aria-label'), 'Tile ggp*pmm');

  // A blossom on a three-edge area is still drawn once.
  const wide = renderHex({ edges: 'pppmgm', blossom: 'p', kind: 'landscape' });
  assert.equal(byClass(wide, 'hex-blossom').length, 1);
});

test('the blossom sits inside a coloured band, not in the bare middle', () => {
  // The bands run from the inner hex (radius 23) out to the rim (radius 46);
  // measured at an edge midpoint that is 19.9 to 39.8 from the centre.
  const [mark] = byClass(renderHex({ edges: 'ggppmm', blossom: 'p' }), 'hex-blossom');
  const at = distanceFromCentre(mark);
  assert.ok(at > 19.9 && at < 39.8, `blossom should be within a band, sits at ${at}`);
});

test('the blossom lands on a band of its own colour', () => {
  // Rice is on edges 0 and 1, sakura on 2 and 3; a sakura blossom must not be
  // drawn over the rice.
  const svg = renderHex({ edges: 'ggppmm', blossom: 'p' });
  const [mark] = byClass(svg, 'hex-blossom');
  const [x, y] = mark
    .getAttribute('transform')
    .match(/-?\d+(\.\d+)?/g)
    .map(Number);

  // Work out which band the mark falls in by comparing against each band's
  // midpoint, and check that band is a sakura one.
  const bands = bandsOf(svg);
  const nearest = bands
    .map((band, k) => {
      const pts = band
        .getAttribute('points')
        .split(' ')
        .map((p) => p.split(',').map(Number));
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return { k, d: Math.hypot(cx - x, cy - y) };
    })
    .sort((a, b) => a.d - b.d)[0];
  assert.equal('ggppmm'[nearest.k], 'p', `blossom landed on edge ${nearest.k}`);
});

test('a blossom on a flagged area still finds a band', () => {
  // The only pink edge is a pink flag, which is a sakura region.
  const svg = renderHex({ edges: '1mmmmm', blossom: 'p' });
  assert.equal(byClass(svg, 'hex-blossom').length, 1, 'the flag band carries it');
});

test('renderHex marks flag edges so they read differently from plain terrain', () => {
  const svg = renderHex({ edges: '12mmmm', blossom: '', kind: 'landscape' });
  assert.equal(byClass(svg, 'hex-flag').length, 2);
});

test('connections: a river running through joins its edges at the centre', () => {
  assert.deepEqual(connections('immimm'), [
    { feature: 'i', edges: [0, 3], kind: 'line', stub: false },
  ]);
});

test('connections: a lone river or road edge is a dead end', () => {
  assert.deepEqual(connections('immmmm'), [
    { feature: 'i', edges: [0], kind: 'line', stub: true },
  ]);
  assert.deepEqual(connections('rmmmmm'), [
    { feature: 'r', edges: [0], kind: 'line', stub: true },
  ]);
});

test('connections: a road and a river both running through cross', () => {
  assert.deepEqual(connections('rimrim'), [
    { feature: 'i', edges: [1, 4], kind: 'line', stub: false },
    { feature: 'r', edges: [0, 3], kind: 'line', stub: false },
  ]);
});

test('connections: terrain split across the tile is joined through the centre', () => {
  // The temple tile the rule exists for: the two rice edges are apart.
  assert.deepEqual(connections('vmgmgm'), [
    { feature: 'g', edges: [2, 4], kind: 'area', stub: false },
  ]);
  assert.deepEqual(connections('hmhmmm'), [
    { feature: 'h', edges: [0, 2], kind: 'area', stub: false },
  ]);
  assert.deepEqual(connections('jmjmjm'), [
    { feature: 'j', edges: [0, 2, 4], kind: 'area', stub: false },
  ]);
});

test('connections: side-by-side terrain needs no line through the middle', () => {
  // Neighbouring edges already share a border, so a band would be clutter.
  assert.deepEqual(connections('vvvggg'), []);
  assert.deepEqual(connections('1pmjjm'), [], 'pink flag beside sakura, Fuji beside Fuji');
  assert.deepEqual(connections('gggggg'), [], 'the whole tile is one area');
  // A run that wraps past edge 0 is still one run.
  assert.deepEqual(connections('vmmmmv'), []);
});

test('connections: one band per separated stretch, not per edge', () => {
  // Rice on edges 0,1 and 3: two stretches, so two spokes meet in the middle.
  const [link] = connections('ggmgmm');
  assert.equal(link.feature, 'g');
  assert.equal(link.edges.length, 2, 'one spoke per stretch, not one per edge');
  assert.deepEqual(link.edges, [1, 3]);
});

test('connections: meadow and clouds are never linked', () => {
  assert.deepEqual(connections('mmmmmm'), []);
  assert.deepEqual(connections('cmcmmm'), []);
  // A single terrain edge is an area, not a run, so it gets nothing either.
  assert.deepEqual(connections('gmmmmm'), []);
  assert.deepEqual(connections('1mmmmm'), []);
});

test('connections: a flag joins the coloured area it stands in', () => {
  // A pink flag beside sakura is one sakura area spanning the tile.
  assert.deepEqual(connections('1mpmmm'), [
    { feature: 'p', edges: [0, 2], kind: 'area', stub: false },
  ]);
  // Two pink flags are likewise one pink region.
  assert.deepEqual(connections('1m1mmm'), [
    { feature: 'p', edges: [0, 2], kind: 'area', stub: false },
  ]);
  // A flag of a different colour is a different area, so nothing links.
  assert.deepEqual(connections('1mgmmm'), []);
  // The rainbow flag has no one colour, so it joins nothing.
  assert.deepEqual(connections('4mpmmm'), []);
});

test('renderHex draws the connections it derives', () => {
  const river = renderHex({ edges: 'immimm', blossom: '', kind: 'landscape' });
  const lines = byClass(river, 'hex-link-line');
  assert.equal(lines.length, 1, 'one group for the river');
  assert.equal(
    lines[0].children.filter((c) => c.nodeName === 'line').length,
    2,
    'a spoke from each river edge',
  );
  assert.equal(lines[0].getAttribute('stroke'), colorOf('i'));

  const temple = renderHex({ edges: 'vmgmgm', blossom: '', kind: 'temple' });
  const areas = byClass(temple, 'hex-link-area');
  assert.equal(areas.length, 1);
  assert.equal(areas[0].getAttribute('stroke'), colorOf('g'));

  const plain = renderHex({ edges: 'mmmmmm', blossom: '', kind: 'landscape' });
  assert.equal(byClass(plain, 'hex-link-line').length, 0);
  assert.equal(byClass(plain, 'hex-link-area').length, 0);
});

test('a dead-end run stops short of the centre', () => {
  const [group] = byClass(renderHex({ edges: 'immmmm', blossom: '' }), 'hex-link-line');
  const [line] = group.children;
  const reaches = Math.hypot(Number(line.getAttribute('x2')), Number(line.getAttribute('y2')));
  assert.ok(reaches > 1, `a stub should stop before the centre, reached ${reaches}`);

  const [through] = byClass(renderHex({ edges: 'immimm', blossom: '' }), 'hex-link-line');
  const [line2] = through.children;
  assert.equal(Number(line2.getAttribute('x2')), 0, 'a through run reaches the centre');
  assert.equal(Number(line2.getAttribute('y2')), 0);
});

test('renderHexBack draws a face-down tile', () => {
  const svg = renderHexBack({ label: 'Face-down tile' });
  assert.equal(byClass(svg, 'hex-back-face').length, 1);
  assert.equal(svg.getAttribute('aria-label'), 'Face-down tile');
});

test('renderHex puts edge 0 along the top', () => {
  const svg = renderHex({ edges: 'immmmm', blossom: '', kind: 'landscape' });
  const [top] = bandsOf(svg);
  const ys = top
    .getAttribute('points')
    .split(' ')
    .map((p) => Number(p.split(',')[1]));
  // The two outer corners of edge 0 share the lowest y — the top of the hex.
  assert.ok(Math.abs(ys[0] - ys[1]) < 0.01, `edge 0 should be horizontal, got ${ys}`);
  assert.ok(ys[0] < Math.min(ys[2], ys[3]), 'edge 0 should sit above the tile centre');
});

// A small catalog of its own, so edits to the real deck cannot break these.
const CATALOG_TILES = [
  { id: 'L1', kind: 'landscape', edges: 'mmmmmm', blossom: '', copies: 3 },
  { id: 'L2', kind: 'landscape', edges: 'immimm', blossom: '', copies: 1, unlock: 'box-2' },
  { id: 'L3', kind: 'landscape', edges: 'mmmmmi', blossom: '', copies: 1 },
  { id: 'L4', kind: 'landscape', edges: 'mmmmir', blossom: '', copies: 1 },
  { id: 'L5', kind: 'landscape', edges: 'mmmirr', blossom: '', copies: 1 },
  { id: 'L6', kind: 'landscape', edges: 'gmmmmm', blossom: '', copies: 1 },
  { id: 'L7', kind: 'landscape', edges: 'pmmmmm', blossom: '', copies: 1 },
  { id: 'L8', kind: 'landscape', edges: 'vmmmmm', blossom: '', copies: 1 },
  { id: 'L9', kind: 'landscape', edges: 'hmmmmm', blossom: '', copies: 1 },
  // A special tile: in the landscape bag, but never held out on the board.
  {
    id: 'S1',
    kind: 'landscape',
    edges: 'pppppp',
    blossom: '',
    copies: 1,
    name: 'Moss Collector',
    special: true,
  },
  { id: 'T1', kind: 'task', task: 'village', edges: 'mmvvmr', blossom: '', copies: 1, name: 'Daimyo' },
  { id: 'TP1', kind: 'temple', edges: 'gmgmvm', blossom: '', copies: 1, unlock: 'temples' },
];

// Deliberately not in alphabetical order, so the checklist has to sort them.
const ACHIEVEMENTS = [
  { id: 'wraparound-tasks', name: 'Wraparound Tasks' },
  { id: 'temples', name: 'Temples' },
  { id: 'box-2', name: 'Box 2' },
  { id: 'sumo-wrestler', name: 'Sumo Wrestler' },
  { id: 'cartographer', name: 'Cartographer' },
];

const CAMPAIGN = {
  id: 'abc',
  name: 'Sakura valley',
  createdAt: '',
  updatedAt: '',
  unlockedAchievements: [],
  unlockedTiles: [],
  game: {
    startedAt: '',
    plays: [],
    temple: [
      { source: 'temple', tileId: 'TP1', played: false },
      { source: 'landscape', tileId: '', played: false },
    ],
  },
  history: [],
};

/** Every request the app makes, so tests can assert on when it saves. */
const requests = [];

test('the app boots, wires its imports together and renders the home view', async () => {
  globalThis.fetch = async (path, options = {}) => {
    requests.push({ path, method: options.method ?? 'GET' });
    // A save echoes the campaign back, the way the server does.
    if (options.method === 'PUT') {
      const saved = JSON.parse(options.body);
      Object.assign(CAMPAIGN, saved);
      return { ok: true, status: 200, json: async () => saved };
    }
    const body = {
      '/api/catalog': {
        version: 1,
        tiles: CATALOG_TILES,
        achievements: ACHIEVEMENTS,
        features: allFeatures(),
        taskTypes: [
          { key: 'village', name: 'Village', values: [4, 4, 5, 5, 6, 6], color: '#d1495b' },
        ],
      },
      '/api/campaigns': [
        { id: 'abc', name: 'Sakura valley', createdAt: '', updatedAt: '', inGame: false, plays: 0 },
      ],
      '/api/campaigns/abc': CAMPAIGN,
    }[path];
    assert.ok(body !== undefined, `unexpected fetch for ${path}`);
    return { ok: true, status: 200, json: async () => body };
  };

  await import('../web/js/app.js');
  // boot() is async; give its two awaits a chance to settle.
  for (let i = 0; i < 20 && !app.text.includes('Dorfwatch'); i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }

  assert.match(app.text, /Dorfwatch/, 'the header should render');
  assert.match(app.text, /Start a new campaign/, 'the home view should render');
  assert.match(app.text, /Sakura valley/, 'the campaign list should render');
});

test('the campaign view lists achievements alphabetically', async () => {
  globalThis.location.hash = '#/c/abc';
  await fire('hashchange');

  const text = app.text;
  const positions = ['Box 2', 'Sumo Wrestler', 'Temples', 'Wraparound Tasks'].map((name) => {
    const at = text.indexOf(name);
    assert.ok(at >= 0, `${name} should appear in the checklist`);
    return at;
  });
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
    'achievements should read in alphabetical order, not catalog order',
  );
});

/** Tick or untick a checkbox the way a click would. */
function toggle(id, checked) {
  const box = document.getElementById(id);
  assert.ok(box, `no checkbox ${id}`);
  box.checked = checked;
  for (const fn of box.listeners.change ?? []) fn({ target: box });
}

const statusText = () => document.getElementById('unlock-status')?.textContent;
const saveDisabled = () => document.getElementById('unlock-save')?.disabled;

test('ticking unlock boxes does not save or redraw until you press Save', async () => {
  globalThis.location.hash = '#/c/abc';
  await fire('hashchange');

  assert.equal(statusText(), 'All changes saved');
  assert.equal(saveDisabled(), true, 'nothing to save yet');

  const before = requests.length;
  const firstBox = document.getElementById('unlock-box-2');
  toggle('unlock-box-2', true);
  toggle('unlock-temples', true);

  assert.equal(requests.length, before, 'ticking boxes must not hit the server');
  assert.equal(statusText(), '2 unsaved changes');
  assert.equal(saveDisabled(), false);
  assert.equal(
    document.getElementById('unlock-box-2'),
    firstBox,
    'the list must not be rebuilt mid-edit',
  );

  // Unticking one takes the count back down.
  toggle('unlock-temples', false);
  assert.equal(statusText(), '1 unsaved change');

  document.getElementById('unlock-save').listeners.click[0]();
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.ok(
    requests.some((r) => r.method === 'PUT' && r.path === '/api/campaigns/abc'),
    'Save should write once',
  );
  assert.deepEqual(CAMPAIGN.unlockedAchievements, ['box-2']);
  assert.equal(statusText(), 'All changes saved');
});

test('Discard drops pending unlock edits', async () => {
  globalThis.location.hash = '#/c/abc';
  await fire('hashchange');

  toggle('unlock-sumo-wrestler', true);
  assert.equal(statusText(), '1 unsaved change');

  const before = requests.length;
  document.getElementById('unlock-discard').listeners.click[0]();
  assert.equal(requests.length, before, 'discarding writes nothing');
  assert.equal(statusText(), 'All changes saved');
  assert.equal(document.getElementById('unlock-sumo-wrestler').getAttribute('checked'), null);
});

test('leaving the page drops unsaved unlock edits', async () => {
  globalThis.location.hash = '#/c/abc';
  await fire('hashchange');

  toggle('unlock-cartographer', true);
  assert.equal(statusText(), '1 unsaved change');

  // Navigate away without pressing Save.
  const before = requests.length;
  globalThis.location.hash = '#/';
  await fire('hashchange');
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(
    requests.filter((r) => r.method === 'PUT').length,
    requests.slice(0, before).filter((r) => r.method === 'PUT').length,
    'navigating away must not save',
  );
  assert.equal(
    CAMPAIGN.unlockedAchievements.includes('cartographer'),
    false,
    'only the Save button writes unlocks',
  );

  // Coming back shows the saved state, not the abandoned edit.
  globalThis.location.hash = '#/c/abc';
  await fire('hashchange');
  assert.equal(statusText(), 'All changes saved');
  assert.equal(document.getElementById('unlock-cartographer').checked, false);
});

/** Type into a text box the way a keystroke would. */
function type(id, text) {
  const box = document.getElementById(id);
  assert.ok(box, `no input ${id}`);
  box.value = text;
  for (const fn of box.listeners.input ?? []) fn({ target: box });
}

test('the draw box searches like the search bar and only lists a short result set', async () => {
  globalThis.location.hash = '#/c/abc/game';
  await fire('hashchange');

  const drawPanel = () => byClass(app, 'draw')[0];

  // Nothing at all until you type.
  assert.equal(byClass(drawPanel(), 'tile-grid').length, 0, 'empty box lists nothing');

  // A broad query is counted, not listed.
  type('draw-input', 'm');
  assert.match(drawPanel().text, /tiles match — keep typing/);
  assert.equal(byClass(drawPanel(), 'tile-grid').length, 0, 'too many to list');

  // A narrow one is listed.
  type('draw-input', 'immimm');
  assert.equal(byClass(drawPanel(), 'tile-grid').length, 1, 'few enough to pick from');
  assert.match(drawPanel().text, /immimm/);

  // A partial encoding is enough — no need to type the whole tile.
  type('draw-input', 'immi');
  assert.equal(byClass(drawPanel(), 'tile-grid').length, 1);
  assert.match(drawPanel().text, /immimm/, 'partial encoding finds the tile');

  // A name that belongs to another kind says so rather than just failing.
  type('draw-input', 'daimyo');
  assert.match(drawPanel().text, /switch the kind above/);

  type('draw-input', 'nonsense');
  assert.match(drawPanel().text, /Nothing in the catalog matches/);
});

/** Click the "Drew it" button on the result card showing this encoding. */
function recordFromSearch(edges) {
  const card = byClass(app, 'tile-card').find((c) => c.text.includes(edges));
  assert.ok(card, `no result card for ${edges}`);
  const [button] = byClass(card, 'record-draw');
  assert.ok(button, `${edges} has no record button`);
  button.listeners.click[0]();
}

test('a tile can be checked off straight from the search results', async () => {
  globalThis.location.hash = '#/c/abc/game';
  await fire('hashchange');

  const plays = () => CAMPAIGN.game.plays.length;
  const before = plays();

  // A landscape tile records immediately.
  recordFromSearch('mmmmmm');
  assert.equal(plays(), before + 1, 'clicking Drew it records the tile');
  assert.equal(CAMPAIGN.game.plays.at(-1).tileId, 'L1');

  // A task tile asks for its value first, in the search panel rather than the
  // draw panel, so you stay where you were working.
  recordFromSearch('mmvvmr');
  assert.equal(plays(), before + 1, 'not recorded until the value is picked');
  // Re-query: recording redrew the page, so earlier nodes are stale.
  assert.equal(byClass(byClass(app, 'search')[0], 'picker').length, 1, 'value picker opens here');
  assert.equal(byClass(byClass(app, 'draw')[0], 'picker').length, 0, 'and not in the draw panel');
});

test('revealing a temple slot never offers a special tile', async () => {
  CAMPAIGN.unlockedAchievements = ['temples'];
  globalThis.location.hash = '#/c/abc/game';
  await fire('hashchange');

  // Open the reveal box on the face-down slot.
  const reveal = byClass(app, 'temple-slot')
    .flatMap((slot) => byClass(slot, 'small'))
    .find((b) => b.text === 'Reveal');
  assert.ok(reveal, 'the face-down slot should offer Reveal');
  reveal.listeners.click[0]();

  const templePanel = () => byClass(app, 'temple')[0];

  // A plain landscape tile is a candidate.
  type('reveal-input', 'mmmmmm');
  assert.equal(byClass(templePanel(), 'tile-grid').length, 1, 'plain tiles can be held out');

  // The special one is not, even though it is a landscape tile in the bag.
  type('reveal-input', 'moss');
  assert.equal(byClass(templePanel(), 'tile-grid').length, 0, 'no cards offered');
  assert.match(templePanel().text, /never held out/);
});

test('temple tiles get no record button, since they are played from the board', async () => {
  CAMPAIGN.unlockedAchievements = ['temples'];
  globalThis.location.hash = '#/c/abc/game';
  await fire('hashchange');

  // Show everything, so the board's temple tile appears in the results too.
  const unplayedOnly = byClass(app, 'chip').find((c) => c.text.includes('Unplayed only'));
  unplayedOnly.listeners.click[0]();

  const templeCard = byClass(app, 'tile-card').find((c) => c.text.includes('gmgmvm'));
  assert.ok(templeCard, 'the temple tile should be listed');
  assert.equal(byClass(templeCard, 'record-draw').length, 0);
});

test('the game view renders the temple board and groups results by kind', async () => {
  globalThis.location.hash = '#/c/abc/game';
  await fire('hashchange');

  assert.match(app.text, /Temple board/, 'the temple panel should render');
  assert.match(app.text, /face down/, 'the unrevealed slot should render');
  assert.equal(byClass(app, 'hex-back-face').length, 1, 'one face-down hex');
  assert.match(app.text, /Landscape \(/, 'landscape results get their own list');
  assert.match(app.text, /Task \(/, 'task results get their own list');
  assert.match(app.text, /Task values left/, 'the task deck panel should render');
  assert.match(app.text, /Draw a tile/, 'the draw panel should render');
});
