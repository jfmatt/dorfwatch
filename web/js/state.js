// Application state: the loaded catalog, the open campaign, and the derived
// deck maths that everything else asks questions of.

import { api } from './api.js';

const listeners = new Set();

export const state = {
  catalog: null,
  /** @type {object|null} the open campaign, exactly as the server stores it */
  campaign: null,
  saving: false,
  error: null,
};

/** Subscribe to state changes; returns an unsubscribe function. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn();
}

export async function loadCatalog() {
  state.catalog = await api.catalog();
  return state.catalog;
}

export async function openCampaign(id) {
  state.campaign = await api.getCampaign(id);
  notify();
  return state.campaign;
}

export function closeCampaign() {
  flushSave();
  state.campaign = null;
}

// --- persistence -----------------------------------------------------------

let saveTimer = null;
let savePending = false;

/**
 * Mutate the open campaign and schedule a save. Changes are coalesced so that
 * a burst of clicks costs one write.
 */
export function mutate(fn) {
  if (!state.campaign) return;
  fn(state.campaign);
  savePending = true;
  notify();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

export async function flushSave() {
  clearTimeout(saveTimer);
  if (!savePending || !state.campaign) return;
  savePending = false;
  const campaign = state.campaign;
  state.saving = true;
  state.error = null;
  notify();
  try {
    const saved = await api.saveCampaign(campaign.id, campaign);
    // Only adopt the server's copy if the user hasn't moved on or edited since.
    if (state.campaign === campaign && !savePending) {
      state.campaign = saved;
    }
  } catch (err) {
    state.error = `Could not save: ${err.message}`;
    savePending = true; // keep the change queued for the next attempt
  } finally {
    state.saving = false;
    notify();
  }
}

// Don't lose the last click when the tab is closed or backgrounded.
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
window.addEventListener('pagehide', flushSave);

// --- derived deck maths ----------------------------------------------------

/** Is this tile part of the campaign's deck yet? */
export function isUnlocked(tile, campaign = state.campaign) {
  if (!tile.unlock) return true;
  if (!campaign) return false;
  return (
    campaign.unlockedAchievements.includes(tile.unlock) ||
    campaign.unlockedTiles.includes(tile.id)
  );
}

/** Every tile currently in the campaign's deck. */
export function availableTiles(campaign = state.campaign) {
  if (!state.catalog) return [];
  return state.catalog.tiles.filter((t) => isUnlocked(t, campaign));
}

/** How many copies of each tile have been drawn in the current game. */
export function playCounts(campaign = state.campaign) {
  const counts = new Map();
  const plays = campaign?.game?.plays ?? [];
  for (const play of plays) {
    counts.set(play.tileId, (counts.get(play.tileId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Copies of `tile` still in the bag this game — that is, still available to be
 * drawn. Copies sitting face up on the temple board have left the bag, so they
 * are excluded until they are played.
 */
export function remainingCopies(tile, counts = playCounts(), held = boardHoldings()) {
  return Math.max(0, tile.copies - (counts.get(tile.id) ?? 0) - (held.get(tile.id) ?? 0));
}

/** Copies of `tile` that have not been played, wherever they are. */
export function unplayedCopies(tile, counts = playCounts()) {
  return Math.max(0, tile.copies - (counts.get(tile.id) ?? 0));
}

/** Deck totals for the campaign screen. */
export function deckStats(campaign = state.campaign) {
  const tiles = availableTiles(campaign);
  const byKind = {};
  let copies = 0;
  for (const t of tiles) {
    byKind[t.kind] = (byKind[t.kind] ?? 0) + t.copies;
    copies += t.copies;
  }
  return { designs: tiles.length, copies, byKind };
}

export function tileById(id) {
  return state.catalog?.tiles.find((t) => t.id === id) ?? null;
}

// --- task value decks ------------------------------------------------------

export function taskTypeFor(key) {
  return state.catalog?.taskTypes.find((t) => t.key === key) ?? null;
}

/**
 * The value tokens still in a task type's deck this game, in ascending order
 * and with duplicates kept. Derived from the tiles recorded so far, so there is
 * no separate deck state to keep in step.
 *
 * Returns null for task types that have no value deck (special-7).
 */
export function taskValuesLeft(taskKey, campaign = state.campaign) {
  const type = taskTypeFor(taskKey);
  if (!type?.values?.length) return null;

  const left = [...type.values];
  for (const play of campaign?.game?.plays ?? []) {
    if (play.taskNumber === null || play.taskNumber === undefined) continue;
    const tile = tileById(play.tileId);
    if (tile?.task !== taskKey) continue;
    const at = left.indexOf(play.taskNumber);
    if (at !== -1) left.splice(at, 1);
  }
  return left.sort((a, b) => a - b);
}

/**
 * The whole value deck as fixed slots, so a drawn token leaves a gap rather
 * than closing up — that keeps the columns lined up between task types.
 *
 * Returns null for task types that have no value deck.
 */
export function taskValueSlots(taskKey, campaign = state.campaign) {
  const type = taskTypeFor(taskKey);
  if (!type) return null;

  // Types that always score the same draw no token, so their bag is simply one
  // marker per unlocked tile of that type.
  if (type.fixed) {
    const tiles = availableTiles(campaign).filter((t) => t.task === taskKey);
    const counts = playCounts(campaign);
    const total = tiles.reduce((sum, t) => sum + t.copies, 0);
    const played = tiles.reduce((sum, t) => sum + Math.min(t.copies, counts.get(t.id) ?? 0), 0);
    return Array.from({ length: total }, (_, i) => ({
      value: type.fixed,
      taken: i >= total - played,
    }));
  }
  if (!type.values?.length) return null;

  const remaining = new Map();
  for (const value of taskValuesLeft(taskKey, campaign)) {
    remaining.set(value, (remaining.get(value) ?? 0) + 1);
  }
  // Fill each value's slots from the left, so gaps fall at the right-hand end
  // of a run of equal values.
  return [...type.values]
    .sort((a, b) => a - b)
    .map((value) => {
      const left = remaining.get(value) ?? 0;
      if (left > 0) {
        remaining.set(value, left - 1);
        return { value, taken: false };
      }
      return { value, taken: true };
    });
}

/**
 * Every task type whose tiles are actually in the campaign's deck, with its
 * bag of values. Types locked behind an achievement you have not earned are
 * left out entirely.
 */
export function taskDeckSummary(campaign = state.campaign) {
  const inDeck = new Set(
    availableTiles(campaign)
      .filter((t) => t.kind === 'task' && t.task)
      .map((t) => t.task),
  );
  return (state.catalog?.taskTypes ?? [])
    .filter((type) => inDeck.has(type.key))
    .map((type) => ({ type, slots: taskValueSlots(type.key, campaign) }));
}

// --- temple board ----------------------------------------------------------

/** Landscape tiles held out of the deck and placed face down at game start. */
export const HELD_OUT_SLOTS = 3;

export function templeSlots(campaign = state.campaign) {
  return campaign?.game?.temple ?? [];
}

/**
 * How many copies of each tile are sitting face up on the board, unplayed.
 * These have left the bag but are still available to play from the board.
 */
export function boardHoldings(campaign = state.campaign) {
  const held = new Map();
  for (const slot of templeSlots(campaign)) {
    if (!slot.tileId || slot.played) continue;
    held.set(slot.tileId, (held.get(slot.tileId) ?? 0) + 1);
  }
  return held;
}

/**
 * The opening board: the fixed special temple tiles, then the landscape tiles
 * held out face down.
 */
function newTempleBoard(campaign) {
  const fixed = availableTiles(campaign)
    .filter((t) => t.kind === 'temple')
    .flatMap((t) => Array.from({ length: t.copies }, () => t.id))
    .map((tileId) => ({ source: 'temple', tileId, played: false }));
  // The temple board only comes into play once its achievement is earned, so
  // with no temple tiles unlocked there is no board at all.
  if (!fixed.length) return [];

  const hidden = Array.from({ length: HELD_OUT_SLOTS }, () => ({
    source: 'landscape',
    tileId: '',
    played: false,
  }));
  return [...fixed, ...hidden];
}

/** Turn a face-down slot face up, now that we know what it is. */
export function revealSlot(index, tile) {
  mutate((c) => {
    const slot = c.game?.temple?.[index];
    if (!slot || slot.tileId || slot.played) return;
    slot.tileId = tile.id;
  });
}

/** Put a face-down slot back, in case the wrong tile was entered. */
export function hideSlot(index) {
  mutate((c) => {
    const slot = c.game?.temple?.[index];
    if (!slot || slot.played || slot.source !== 'landscape') return;
    slot.tileId = '';
  });
}

/** Play the tile in a face-up slot, as if it had been drawn. */
export function playSlot(index) {
  const slot = templeSlots()[index];
  const tile = slot && tileById(slot.tileId);
  if (!tile || slot.played) return;
  mutate((c) => {
    c.game.temple[index].played = true;
    c.game.plays.push({
      tileId: tile.id,
      kind: tile.kind,
      taskNumber: null,
      slot: index,
      at: new Date().toISOString(),
    });
  });
}

// --- game actions ----------------------------------------------------------

export function startGame() {
  mutate((c) => {
    if (c.game) return;
    c.game = {
      startedAt: new Date().toISOString(),
      plays: [],
      temple: newTempleBoard(c),
    };
  });
}

export function endGame() {
  mutate((c) => {
    if (!c.game) return;
    c.history.push({ ...c.game, endedAt: new Date().toISOString() });
    c.game = null;
  });
}

export function recordPlay(tile, taskNumber = null) {
  mutate((c) => {
    if (!c.game) return;
    c.game.plays.push({
      tileId: tile.id,
      kind: tile.kind,
      taskNumber,
      slot: null,
      at: new Date().toISOString(),
    });
  });
}

export function undoLastPlay() {
  mutate((c) => {
    const play = c.game?.plays.pop();
    // A tile taken off the temple board goes back onto it face up.
    if (play && play.slot !== null && play.slot !== undefined && c.game.temple?.[play.slot]) {
      c.game.temple[play.slot].played = false;
    }
  });
}

/**
 * Replace the whole unlock list in one go. The campaign screen collects edits
 * locally and commits them on Save, rather than writing on every checkbox.
 */
export function setUnlocks({ achievements, tiles }) {
  mutate((c) => {
    if (achievements) c.unlockedAchievements = [...achievements].sort();
    if (tiles) c.unlockedTiles = [...tiles].sort();
  });
  return flushSave();
}

export function renameCampaign(name) {
  mutate((c) => {
    c.name = name;
  });
}
