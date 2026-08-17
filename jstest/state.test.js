// state.js registers browser listeners when it loads, so stub the two globals
// it touches before importing it.
globalThis.window = { addEventListener() {} };
globalThis.document = { visibilityState: 'visible' };

import { test } from 'node:test';
import assert from 'node:assert/strict';

const {
  HELD_OUT_SLOTS,
  availableTiles,
  boardHoldings,
  deckStats,
  hideSlot,
  isUnlocked,
  playCounts,
  playSlot,
  remainingCopies,
  revealSlot,
  startGame,
  state,
  taskDeckSummary,
  taskValueSlots,
  taskValuesLeft,
  templeSlots,
  tileById,
  undoLastPlay,
  unplayedCopies,
} = await import('../web/js/state.js');

// Saving is debounced and fires after the assertions; echo the campaign back so
// the queued write is a no-op rather than an error.
globalThis.fetch = async (_path, options) => ({
  ok: true,
  status: 200,
  json: async () => JSON.parse(options.body),
});

const VALUES = [4, 4, 5, 5, 6, 6];

function setUp(plays = [], { unlockedAchievements = [], unlockedTiles = [] } = {}) {
  state.catalog = {
    taskTypes: [
      { key: 'road', name: 'Road', values: VALUES },
      { key: 'river', name: 'River', values: VALUES },
      { key: 'special-7', name: 'Special 7', values: null },
    ],
    tiles: [
      { id: 'base', kind: 'landscape', edges: 'mmmmmm', blossom: null, copies: 3 },
      { id: 'locked', kind: 'landscape', edges: 'iiiiii', blossom: null, copies: 1, unlock: 'a01' },
      { id: 'road-task', kind: 'task', task: 'road', edges: 'rmmmmm', blossom: null, copies: 1 },
      { id: 'road-task-2', kind: 'task', task: 'road', edges: 'rmmrmm', blossom: null, copies: 1 },
      { id: 'river-task', kind: 'task', task: 'river', edges: 'immmmm', blossom: null, copies: 1 },
      { id: 'seven', kind: 'task', task: 'special-7', edges: 'vvvvvv', blossom: null, copies: 1 },
      { id: 'temple-a', kind: 'temple', edges: 'vmgmgm', blossom: null, copies: 1 },
      { id: 'temple-b', kind: 'temple', edges: 'hmhmmm', blossom: null, copies: 1 },
    ],
  };
  state.campaign = {
    id: 'test',
    name: 'Test',
    unlockedAchievements,
    unlockedTiles,
    game: { startedAt: '2026-01-01T00:00:00Z', plays, temple: [] },
    history: [],
  };
}

const play = (tileId, taskNumber = null) => ({
  tileId,
  taskNumber,
  kind: 'task',
  slot: null,
  at: '',
});

test('locked tiles stay out of the deck until unlocked', () => {
  setUp();
  assert.equal(availableTiles().some((t) => t.id === 'locked'), false);

  setUp([], { unlockedAchievements: ['a01'] });
  assert.equal(availableTiles().some((t) => t.id === 'locked'), true);

  setUp([], { unlockedTiles: ['locked'] });
  assert.equal(isUnlocked(state.catalog.tiles[1]), true, 'unlocked directly, without the achievement');
});

test('deck stats count copies, not designs', () => {
  setUp();
  const stats = deckStats();
  assert.equal(stats.designs, 7, 'the locked tile is excluded');
  assert.equal(stats.copies, 3 + 1 + 1 + 1 + 1 + 1 + 1);
  assert.equal(stats.byKind.landscape, 3);
  assert.equal(stats.byKind.task, 4);
  assert.equal(stats.byKind.temple, 2);
});

test('remaining copies count down as a design is drawn', () => {
  setUp([play('base'), play('base')]);
  const base = state.catalog.tiles[0];
  assert.equal(playCounts().get('base'), 2);
  assert.equal(remainingCopies(base), 1);

  setUp([play('base'), play('base'), play('base')]);
  assert.equal(remainingCopies(state.catalog.tiles[0]), 0);
});

test('a fresh task deck holds 4 4 5 5 6 6', () => {
  setUp();
  assert.deepEqual(taskValuesLeft('road'), VALUES);
});

test('drawing a task value takes one token out of that type deck', () => {
  setUp([play('road-task', 5)]);
  assert.deepEqual(taskValuesLeft('road'), [4, 4, 5, 6, 6]);
  assert.deepEqual(taskValuesLeft('river'), VALUES, 'other decks are untouched');
});

test('the value deck is shared across every tile of the same task type', () => {
  setUp([play('road-task', 4), play('road-task-2', 4)]);
  assert.deepEqual(taskValuesLeft('road'), [5, 5, 6, 6]);
});

test('drawn task values leave a gap so the columns stay aligned', () => {
  const show = (key) =>
    taskValueSlots(key)
      .map((s) => (s.taken ? ' ' : String(s.value)))
      .join(' ');

  setUp();
  assert.equal(show('road'), '4 4 5 5 6 6');

  setUp([play('road-task', 5)]);
  assert.equal(show('road'), '4 4 5   6 6', 'the gap sits where the drawn 5 was');

  setUp([play('road-task', 5), play('road-task-2', 5)]);
  assert.equal(show('road'), '4 4     6 6', 'both 5s gone');

  setUp([play('road-task', 4)]);
  assert.equal(show('road'), '4   5 5 6 6', 'a gap at the left keeps the rest in place');
});

test('taskValueSlots has no deck for special-7', () => {
  setUp();
  assert.equal(taskValueSlots('special-7'), null);
});

test('a task type with no value deck reports null', () => {
  setUp([play('seven')]);
  assert.equal(taskValuesLeft('special-7'), null);
});

test('a play with no recorded value leaves the deck alone', () => {
  setUp([play('road-task', null)]);
  assert.deepEqual(taskValuesLeft('road'), VALUES);
});

test('a value that is not in the deck is ignored rather than corrupting it', () => {
  setUp([play('road-task', 9)]);
  assert.deepEqual(taskValuesLeft('road'), VALUES);
});

// --- temple board ----------------------------------------------------------

/** A campaign with no game yet, so startGame can lay the board out. */
function setUpBeforeGame() {
  setUp();
  state.campaign.game = null;
}

test('starting a game lays out the fixed temple tiles and the held-out slots', () => {
  setUpBeforeGame();
  startGame();

  const slots = templeSlots();
  assert.equal(slots.length, 2 + HELD_OUT_SLOTS, 'two fixed temple tiles plus three held out');
  assert.deepEqual(
    slots.filter((s) => s.source === 'temple').map((s) => s.tileId),
    ['temple-a', 'temple-b'],
  );
  const hidden = slots.filter((s) => s.source === 'landscape');
  assert.equal(hidden.length, HELD_OUT_SLOTS);
  assert.ok(
    hidden.every((s) => s.tileId === '' && !s.played),
    'held-out slots start face down',
  );
});

test('there is no temple board until its tiles are unlocked', () => {
  setUp();
  state.campaign.game = null;
  // Lock the temple tiles behind an achievement the campaign has not earned.
  for (const t of state.catalog.tiles) if (t.kind === 'temple') t.unlock = 'temples';
  startGame();
  assert.deepEqual(templeSlots(), [], 'no board, not even the face-down slots');

  // Earn it and the board appears for the next game.
  state.campaign.game = null;
  state.campaign.unlockedAchievements = ['temples'];
  startGame();
  assert.equal(templeSlots().length, 2 + HELD_OUT_SLOTS);
});

test('a fixed temple tile is on the board, so it is not in the bag', () => {
  setUpBeforeGame();
  startGame();
  assert.equal(remainingCopies(tileById('temple-a')), 0, 'not drawable from the bag');
  assert.equal(unplayedCopies(tileById('temple-a')), 1, 'but still available to play');
  assert.equal(boardHoldings().get('temple-a'), 1);
});

test('revealing a held-out tile takes it out of the bag', () => {
  setUpBeforeGame();
  startGame();
  const base = tileById('base');
  assert.equal(remainingCopies(base), 3);

  const hiddenIndex = templeSlots().findIndex((s) => s.source === 'landscape');
  revealSlot(hiddenIndex, base);

  assert.equal(templeSlots()[hiddenIndex].tileId, 'base');
  assert.equal(remainingCopies(base), 2, 'the revealed copy has left the bag');
  assert.equal(unplayedCopies(base), 3, 'but none of them have been played');
});

test('un-revealing puts a held-out tile back', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.source === 'landscape');
  revealSlot(index, tileById('base'));
  hideSlot(index);
  assert.equal(templeSlots()[index].tileId, '');
  assert.equal(remainingCopies(tileById('base')), 3);
});

test('a fixed temple slot cannot be un-revealed', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.source === 'temple');
  hideSlot(index);
  assert.equal(templeSlots()[index].tileId, 'temple-a', 'fixed tiles stay face up');
});

test('playing from the board records the tile and marks the slot', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.tileId === 'temple-a');
  playSlot(index);

  assert.equal(templeSlots()[index].played, true);
  const plays = state.campaign.game.plays;
  assert.equal(plays.length, 1);
  assert.deepEqual(
    { tileId: plays[0].tileId, kind: plays[0].kind, slot: plays[0].slot },
    { tileId: 'temple-a', kind: 'temple', slot: index },
  );
  assert.equal(boardHoldings().get('temple-a'), undefined, 'no longer held on the board');
  assert.equal(unplayedCopies(tileById('temple-a')), 0);
});

test('playing the same slot twice does nothing', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.tileId === 'temple-a');
  playSlot(index);
  playSlot(index);
  assert.equal(state.campaign.game.plays.length, 1);
});

test('undoing a board play puts the tile back face up on the board', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.tileId === 'temple-b');
  playSlot(index);
  undoLastPlay();

  assert.equal(templeSlots()[index].played, false, 'back on the board');
  assert.equal(templeSlots()[index].tileId, 'temple-b', 'still face up');
  assert.equal(state.campaign.game.plays.length, 0);
});

test('undoing a bag draw leaves the board alone', () => {
  setUpBeforeGame();
  startGame();
  const index = templeSlots().findIndex((s) => s.tileId === 'temple-a');
  playSlot(index);
  state.campaign.game.plays.push(play('base'));

  undoLastPlay();
  assert.equal(templeSlots()[index].played, true, 'the board play is untouched');
});

test('a game saved before the temple board existed still works', () => {
  setUp();
  delete state.campaign.game.temple;
  assert.deepEqual(templeSlots(), []);
  assert.equal(remainingCopies(tileById('base')), 3);
});

test('a task type that always scores the same shows one marker per unlocked tile', () => {
  /** setUp, then add a second special-7 tile and give the type a fixed value. */
  const twoSevens = (plays = []) => {
    setUp(plays);
    state.catalog.taskTypes.find((t) => t.key === 'special-7').fixed = 7;
    state.catalog.tiles.push({
      id: 'seven-2',
      kind: 'task',
      task: 'special-7',
      edges: 'pppppp',
      blossom: null,
      copies: 1,
    });
  };

  twoSevens();
  assert.deepEqual(taskValueSlots('special-7'), [
    { value: 7, taken: false },
    { value: 7, taken: false },
  ]);

  twoSevens([play('seven', 7)]);
  assert.deepEqual(
    taskValueSlots('special-7'),
    [
      { value: 7, taken: false },
      { value: 7, taken: true },
    ],
    'playing one special-7 tile takes one marker',
  );

  twoSevens([play('seven', 7), play('seven-2', 7)]);
  assert.ok(
    taskValueSlots('special-7').every((s) => s.taken),
    'both played',
  );
});

test('a locked task type stays out of the deck summary entirely', () => {
  setUp();
  for (const t of state.catalog.tiles) {
    if (t.task === 'river') t.unlock = 'wraparound-tasks';
  }
  assert.equal(
    taskDeckSummary().some((s) => s.type.key === 'river'),
    false,
    'no bag shown for a task type you have not unlocked',
  );

  state.campaign.unlockedAchievements = ['wraparound-tasks'];
  assert.equal(
    taskDeckSummary().some((s) => s.type.key === 'river'),
    true,
  );
});

test('the deck summary covers only task types present in the deck', () => {
  setUp([play('river-task', 6)]);
  const summary = taskDeckSummary();
  assert.deepEqual(
    summary.map((s) => s.type.key),
    ['road', 'river', 'special-7'],
  );
  const river = summary.find((s) => s.type.key === 'river').slots;
  assert.deepEqual(
    river.map((s) => (s.taken ? ' ' : String(s.value))).join(' '),
    '4 4 5 5 6  ',
    'the drawn 6 leaves a gap at the end',
  );
});
