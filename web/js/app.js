// View layer and wiring.

import { api } from './api.js';
import { format, setFeatures } from './encoding.js';
import { renderHex, renderHexBack } from './hex.js';
import {
	DEFAULT_FILTERS,
	EXCLUDE_HINT,
	INCLUDE_HINT,
	SHAPES,
	filterableFeatures,
	searchTiles,
	tasksOf,
} from './search.js';
import {
	availableTiles,
	closeCampaign,
	deckStats,
	endGame,
	hideSlot,
	isUnlocked,
	loadCatalog,
	mutate,
	openCampaign,
	playCounts,
	playSlot,
	recordPlay,
	remainingCopies,
	renameCampaign,
	revealSlot,
	startGame,
	state,
	subscribe,
	taskDeckSummary,
	taskTypeFor,
	setUnlocks,
	taskValueSlots,
	taskValuesLeft,
	templeSlots,
	tileById,
	undoLastPlay,
} from './state.js';

const KINDS = [
	{ key: 'landscape', label: 'Landscape' },
	{ key: 'task', label: 'Task' },
	{ key: 'temple', label: 'Temple' },
];

/**
 * Kinds you can draw from the bag. Temple tiles are never drawn — they sit on
 * the temple board and are played from there.
 */
const DRAWN_KINDS = KINDS.filter((k) => k.key !== 'temple');

/** Client-only view state; never persisted to the server. */
const ui = {
	drawKind: 'landscape',
	drawInput: '',
	drawMessage: null,
	drawMessageKind: 'info',
	pendingTask: null,
	pendingTaskSource: 'draw',
	revealSlot: null,
	revealInput: '',
	revealMessage: null,
	revealMessageKind: 'info',
	filters: { ...DEFAULT_FILTERS },
	filtersOpen: true,
	campaigns: [],
	loadError: null,
	// Unlock edits are held here until Save. Ticking a box then neither writes
	// to the server nor redraws the page under your cursor.
	pendingAchievements: null,
	pendingTiles: null,
};

// --- pending unlock edits --------------------------------------------------

/** The working copy of the unlock lists, seeded from the campaign on first use. */
function pendingUnlocks() {
	if (ui.pendingAchievements === null) {
		ui.pendingAchievements = new Set(state.campaign?.unlockedAchievements ?? []);
		ui.pendingTiles = new Set(state.campaign?.unlockedTiles ?? []);
	}
	return { achievements: ui.pendingAchievements, tiles: ui.pendingTiles };
}

function clearPendingUnlocks() {
	ui.pendingAchievements = null;
	ui.pendingTiles = null;
}

/** How many unlocks differ from what is saved. */
function unsavedUnlockCount() {
	const campaign = state.campaign;
	if (!campaign || ui.pendingAchievements === null) return 0;
	const differences = (now, saved) => {
		const before = new Set(saved);
		let n = 0;
		for (const id of now) if (!before.has(id)) n += 1;
		for (const id of before) if (!now.has(id)) n += 1;
		return n;
	};
	return (
		differences(ui.pendingAchievements, campaign.unlockedAchievements) +
		differences(ui.pendingTiles, campaign.unlockedTiles)
	);
}

/**
 * Update the save controls in place. Redrawing the page on every tick is what
 * made the list jump, so this touches only the elements that actually change.
 */
function refreshUnlockControls() {
	const n = unsavedUnlockCount();
	const status = document.getElementById('unlock-status');
	if (status) {
		status.textContent = n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'All changes saved';
		status.className = n ? 'note warn-text' : 'muted small';
	}
	for (const id of ['unlock-save', 'unlock-discard']) {
		const button = document.getElementById(id);
		if (button) button.disabled = n === 0;
	}
}

/**
 * Write pending unlock edits to the campaign. Only the Save button calls this —
 * navigating away drops the edits instead.
 */
async function commitUnlocks() {
	if (unsavedUnlockCount() === 0) {
		clearPendingUnlocks();
		return;
	}
	const { achievements, tiles } = pendingUnlocks();
	clearPendingUnlocks();
	await setUnlocks({ achievements, tiles });
}

// --- tiny DOM helper -------------------------------------------------------

function h(tag, props, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (value === null || value === undefined || value === false) continue;
		if (key === 'class') node.className = value;
		else if (key === 'html') node.innerHTML = value;
		else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
		else if (value === true) node.setAttribute(key, '');
		else node.setAttribute(key, value);
	}
	add(node, children);
	return node;
}

function add(node, children) {
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		if (Array.isArray(child)) add(node, child);
		else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
}

// --- routing ---------------------------------------------------------------

function route() {
	const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
	if (parts[0] === 'c' && parts[1]) {
		return { view: parts[2] === 'game' ? 'game' : 'campaign', id: parts[1] };
	}
	return { view: 'home', id: null };
}

function go(hash) {
	location.hash = hash;
}

// --- render ----------------------------------------------------------------

const root = document.getElementById('app');

function render() {
	// A full redraw throws away focus and scroll position, which is jarring when
	// you are working down a list of checkboxes. Note both and put them back.
	const active = document.activeElement;
	const focusId = active?.id || null;
	const start = active?.selectionStart;
	const end = active?.selectionEnd;
	const { scrollX, scrollY } = window;

	const { view } = route();
	const frag = document.createDocumentFragment();
	add(frag, [
		header(),
		ui.loadError ? banner(ui.loadError, 'error') : null,
		state.error ? banner(state.error, 'error') : null,
		catalogNotice(),
		view === 'home' ? homeView() : null,
		view === 'campaign' ? campaignView() : null,
		view === 'game' ? gameView() : null,
	]);
	root.replaceChildren(frag);

	if (focusId) {
		const next = document.getElementById(focusId);
		if (next) {
			next.focus({ preventScroll: true });
			if (start !== null && start !== undefined && next.setSelectionRange) {
				try {
					next.setSelectionRange(start, end);
				} catch {
					// Not a text input; focus alone is enough.
				}
			}
		}
	}
	if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
		window.scrollTo(scrollX, scrollY);
	}
}

function header() {
	const campaign = state.campaign;
	const { view } = route();
	return h(
		'header',
		{ class: 'topbar' },
		h('a', { class: 'brand', href: '#/', onclick: () => closeCampaign() }, 'Dorfwatch'),
		campaign
			? h(
				'nav',
				{ class: 'crumbs' },
				h('a', { href: `#/c/${campaign.id}` }, campaign.name),
				view === 'game' ? h('span', { class: 'crumb-sep' }, '›') : null,
				view === 'game' ? h('span', {}, 'Game in progress') : null,
			)
			: null,
		h('span', { class: 'spacer' }),
		h('span', { class: `save-state ${state.saving ? 'busy' : ''}` }, state.saving ? 'Saving…' : ''),
	);
}

function banner(text, kind = 'info') {
	return h('div', { class: `banner ${kind}` }, text);
}

function catalogNotice() {
	const catalog = state.catalog;
	if (!catalog) return null;
	return [
		catalog.tiles.length === 0
			? banner(
				'No tiles loaded yet. Fill in data/tiles.json — see docs/TILE_DATA.md for the format.',
				'warn',
			)
			: null,
		...(catalog.warnings ?? []).map((w) => banner(w, 'warn')),
	];
}

// --- home ------------------------------------------------------------------

function homeView() {
	return h(
		'main',
		{ class: 'stack' },
		h(
			'section',
			{ class: 'card' },
			h('h2', {}, 'Campaigns'),
			ui.campaigns.length === 0
				? h('p', { class: 'muted' }, 'No campaigns yet. Start one below.')
				: h(
					'ul',
					{ class: 'campaign-list' },
					...ui.campaigns.map((c) =>
						h(
							'li',
							{},
							h(
								'a',
								{ class: 'campaign-link', href: `#/c/${c.id}` },
								h('span', { class: 'campaign-name' }, c.name),
								h(
									'span',
									{ class: 'muted small' },
									c.inGame ? `game in progress — ${c.plays} tiles drawn` : 'no game in progress',
								),
								h('span', { class: 'muted small' }, `updated ${formatDate(c.updatedAt)}`),
							),
							h(
								'button',
								{
									class: 'ghost danger',
									onclick: () => deleteCampaign(c),
								},
								'Delete',
							),
						),
					),
				),
		),
		h(
			'section',
			{ class: 'card' },
			h('h2', {}, 'Start a new campaign'),
			h(
				'form',
				{ class: 'row', onsubmit: createCampaign },
				h('input', {
					id: 'new-campaign-name',
					type: 'text',
					placeholder: 'Campaign name',
					'aria-label': 'Campaign name',
				}),
				h('button', { class: 'primary', type: 'submit' }, 'Start a new campaign'),
			),
			h(
				'p',
				{ class: 'muted small' },
				'A campaign is your save file: the set of tiles you have unlocked so far.',
			),
		),
	);
}

async function createCampaign(event) {
	event.preventDefault();
	const input = document.getElementById('new-campaign-name');
	try {
		const campaign = await api.createCampaign(input.value);
		ui.campaigns = await api.listCampaigns();
		go(`#/c/${campaign.id}`);
	} catch (err) {
		ui.loadError = err.message;
		render();
	}
}

async function deleteCampaign(summary) {
	if (!window.confirm(`Delete the campaign "${summary.name}"? This cannot be undone.`)) return;
	try {
		await api.deleteCampaign(summary.id);
		ui.campaigns = await api.listCampaigns();
	} catch (err) {
		ui.loadError = err.message;
	}
	render();
}

// --- campaign --------------------------------------------------------------

function campaignView() {
	const campaign = state.campaign;
	if (!campaign) return h('main', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading…'));

	const stats = deckStats();
	const achievements = state.catalog?.achievements ?? [];
	const lockable = (state.catalog?.tiles ?? []).filter((t) => t.unlock);

	return h(
		'main',
		{ class: 'stack' },
		h(
			'section',
			{ class: 'card' },
			h('h2', {}, 'Campaign'),
			h(
				'label',
				{ class: 'field' },
				'Name',
				h('input', {
					id: 'campaign-name',
					type: 'text',
					value: campaign.name,
					oninput: (e) => renameCampaign(e.target.value),
				}),
			),
			h(
				'p',
				{ class: 'stats' },
				`${stats.designs} tile designs · ${stats.copies} tiles in the deck`,
				...KINDS.filter((k) => stats.byKind[k.key]).map((k) =>
					h('span', { class: 'pill' }, `${stats.byKind[k.key]} ${k.label.toLowerCase()}`),
				),
			),
			h(
				'div',
				{ class: 'row' },
				campaign.game
					? h('a', { class: 'button primary', href: `#/c/${campaign.id}/game` }, 'Resume game')
					: h(
						'button',
						{
							class: 'primary',
							onclick: () => {
								startGame();
								go(`#/c/${campaign.id}/game`);
							},
						},
						'Start game',
					),
				campaign.game
					? h(
						'button',
						{
							class: 'ghost',
							onclick: () => {
								if (window.confirm('Finish this game and file it under past games?')) endGame();
							},
						},
						'Finish game',
					)
					: null,
			),
			campaign.history.length
				? h('p', { class: 'muted small' }, `${campaign.history.length} past games`)
				: null,
		),
		h(
			'section',
			{ class: 'card' },
			h('h2', {}, 'Unlocked Achievements'),
			achievements.length || lockable.length ? unlockControls() : null,
			achievements.length
				? achievementChecklist(achievements)
				: lockable.length
					? tileChecklist(lockable)
					: h(
						'p',
						{ class: 'muted' },
						'No tiles in the catalog are locked behind an achievement, so the whole catalog is in your deck.',
					),
		),
	);
}

/**
 * Save and discard for the unlock list. Unlike the rest of the app, these edits
 * are not written as you make them — ticking twenty boxes should be twenty
 * clicks, not twenty saves.
 */
function unlockControls() {
	const n = unsavedUnlockCount();
	return h(
		'div',
		{ class: 'row unlock-controls' },
		h(
			'button',
			{
				id: 'unlock-save',
				class: 'primary',
				disabled: n === 0,
				onclick: async () => {
					await commitUnlocks();
					render();
				},
			},
			'Save unlocks',
		),
		h(
			'button',
			{
				id: 'unlock-discard',
				class: 'ghost',
				disabled: n === 0,
				onclick: () => {
					clearPendingUnlocks();
					render();
				},
			},
			'Discard',
		),
		h(
			'span',
			{ id: 'unlock-status', class: n ? 'note warn-text' : 'muted small' },
			n ? `${n} unsaved change${n === 1 ? '' : 's'}` : 'All changes saved',
		),
	);
}

function achievementChecklist(achievements) {
	const tiles = state.catalog.tiles;
	const { achievements: checked } = pendingUnlocks();
	// Alphabetical, so an achievement is easy to find when ticking it off.
	const ordered = [...achievements].sort((a, b) =>
		(a.name || a.id).localeCompare(b.name || b.id),
	);
	return h(
		'ul',
		{ class: 'checklist' },
		...ordered.map((a) => {
			const count = tiles.filter((t) => t.unlock === a.id).length;
			return h(
				'li',
				{},
				h(
					'label',
					{},
					h('input', {
						id: `unlock-${a.id}`,
						type: 'checkbox',
						checked: checked.has(a.id),
						// No render() here: the box is already ticked, and redrawing
						// mid-edit is what used to throw the list back to the top.
						onchange: (e) => {
							if (e.target.checked) checked.add(a.id);
							else checked.delete(a.id);
							refreshUnlockControls();
						},
					}),
					h('span', { class: 'check-name' }, a.name || a.id),
					h('span', { class: 'muted small' }, `${count} tile${count === 1 ? '' : 's'}`),
				),
				a.description ? h('p', { class: 'muted small indent' }, a.description) : null,
			);
		}),
	);
}

function tileChecklist(tiles) {
	const { tiles: checked } = pendingUnlocks();
	return [
		h(
			'p',
			{ class: 'muted small' },
			'No achievement list is loaded, so unlockable tiles are listed individually.',
		),
		h(
			'ul',
			{ class: 'checklist' },
			...tiles.map((t) =>
				h(
					'li',
					{},
					h(
						'label',
						{},
						h('input', {
							id: `unlock-tile-${t.id}`,
							type: 'checkbox',
							checked: checked.has(t.id),
							onchange: (e) => {
								if (e.target.checked) checked.add(t.id);
								else checked.delete(t.id);
								refreshUnlockControls();
							},
						}),
						h('span', { class: 'check-name mono' }, format(t.edges, t.blossom)),
						t.name ? h('span', { class: 'muted small' }, t.name) : null,
					),
				),
			),
		),
	];
}

// --- game ------------------------------------------------------------------

function gameView() {
	const campaign = state.campaign;
	if (!campaign) return h('main', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading…'));
	if (!campaign.game) {
		return h(
			'main',
			{ class: 'stack' },
			h(
				'section',
				{ class: 'card' },
				h('h2', {}, 'No game in progress'),
				h(
					'button',
					{ class: 'primary', onclick: () => startGame() },
					'Start game',
				),
			),
		);
	}
	// The side panels live in their own column so they size to their content
	// instead of stretching to match the search results.
	return h(
		'main',
		{ class: 'game' },
		h('div', { class: 'game-side' }, drawPanel(), templePanel(), taskDeckPanel(), logPanel()),
		searchPanel(),
	);
}

// --- temple board ----------------------------------------------------------

function templePanel() {
	const slots = templeSlots();
	if (!slots.length) return null;
	return h(
		'section',
		{ class: 'card temple' },
		h('h2', {}, 'Temple board'),
		h(
			'div',
			{ class: 'temple-grid' },
			...slots.map((slot, index) => templeSlotCard(slot, index)),
		),
		ui.revealSlot !== null ? revealForm(ui.revealSlot) : null,
		h(
			'p',
			{ class: 'muted small' },
			'Three fixed temple tiles plus three landscape tiles held out face down. Reveal one when you turn it over, and play any face-up tile as if you had drawn it.',
		),
	);
}

function templeSlotCard(slot, index) {
	const tile = slot.tileId ? tileById(slot.tileId) : null;
	if (!tile) {
		return h(
			'div',
			{ class: 'temple-slot face-down' },
			renderHexBack({ size: 80 }),
			h('span', { class: 'muted small' }, 'face down'),
			h(
				'button',
				{
					class: 'small',
					onclick: () => {
						ui.revealSlot = index;
						ui.revealInput = '';
						ui.revealMessage = null;
						render();
					},
				},
				'Reveal',
			),
		);
	}
	return h(
		'div',
		{ class: `temple-slot ${slot.played ? 'spent' : ''}` },
		renderHex(tile, { size: 80 }),
		h('span', { class: 'mono small' }, format(tile.edges, tile.blossom)),
		tile.name ? h('span', { class: 'tile-name' }, tile.name) : null,
		slot.played
			? h('span', { class: 'muted small' }, 'played')
			: h('button', { class: 'small primary', onclick: () => playSlot(index) }, 'Play'),
		!slot.played && slot.source === 'landscape'
			? h('button', { class: 'ghost small', onclick: () => hideSlot(index) }, 'Undo reveal')
			: null,
	);
}

function revealForm(index) {
	const query = ui.revealInput.trim();
	return h(
		'div',
		{ class: 'picker' },
		h('h3', {}, 'Which tile was face down?'),
		h(
			'form',
			{ class: 'row', onsubmit: (e) => (e.preventDefault(), submitReveal(index)) },
			h('input', {
				id: 'reveal-input',
				class: 'mono wide',
				type: 'text',
				autocomplete: 'off',
				spellcheck: 'false',
				placeholder: 'part of the tile, or a name',
				'aria-label': 'Find the tile you turned over',
				value: ui.revealInput,
				oninput: (e) => {
					ui.revealInput = e.target.value;
					ui.revealMessage = null;
					render();
				},
			}),
			h(
				'button',
				{
					class: 'ghost',
					type: 'button',
					onclick: () => {
						ui.revealSlot = null;
						render();
					},
				},
				'Cancel',
			),
		),
		ui.revealMessage ? h('p', { class: `note ${ui.revealMessageKind}` }, ui.revealMessage) : null,
		revealResults(index, query),
	);
}

/** Same narrowing as the draw box: only the landscape tiles still in the bag. */
/**
 * Landscape tiles that could be sitting face down on the temple board. Special
 * tiles are never held out, so they are not candidates.
 */
function heldOutMatches(query) {
	const { results, error } = bagMatches(query, 'landscape');
	return { results: results.filter((tile) => !tile.special), error, all: results };
}

function revealResults(index, query) {
	if (!query) return null;

	const { results, error, all } = heldOutMatches(query);
	if (error) return h('p', { class: 'note error' }, error);
	if (results.length === 0) {
		return h(
			'p',
			{ class: 'note error' },
			all.length
				? 'Only special tiles match, and those are never held out on the temple board.'
				: 'No landscape tile left in the bag matches that.',
		);
	}
	if (results.length > DRAW_RESULT_LIMIT) {
		return h(
			'p',
			{ class: 'note info' },
			`${results.length} tiles match — keep typing to narrow it down.`,
		);
	}

	const counts = playCounts();
	return h(
		'div',
		{ class: 'tile-grid' },
		...results.map((tile) =>
			tileCard(tile, remainingCopies(tile, counts), { onclick: () => finishReveal(index, tile) }),
		),
	);
}

function submitReveal(index) {
	const query = ui.revealInput.trim();
	if (!query) return;
	const { results } = heldOutMatches(query);
	if (results.length === 1) return finishReveal(index, results[0]);
	render();
}

function finishReveal(index, tile) {
	revealSlot(index, tile);
	ui.revealSlot = null;
	ui.revealInput = '';
	ui.revealMessage = null;
	render();
}

function revealMessage(text, kind) {
	ui.revealMessage = text;
	ui.revealMessageKind = kind;
	render();
}

function taskDeckPanel() {
	const decks = taskDeckSummary();
	if (!decks.length) return null;
	return h(
		'section',
		{ class: 'card tasks' },
		h('h2', {}, 'Task values left'),
		h(
			'ul',
			{ class: 'task-decks' },
			...decks.map(({ type, slots }) =>
				h(
					'li',
					{
						class: slots && slots.every((s) => s.taken) ? 'spent' : '',
						// Same tint as the search results, as a stripe down the side.
						style: `border-left-color:${type.color}`,
					},
					h('span', { class: 'task-type' }, type.name),
					h('span', { class: 'mono values' }, valuesLeftText(type.key)),
				),
			),
		),
	);
}

/**
 * Show the tiles once the query has narrowed to this many or fewer.
 *
 * Eight, so that naming a task type lists that type's whole set at once: six
 * tiles of the type itself, plus the up-to-two special-7 tasks that also count
 * as it.
 */
const DRAW_RESULT_LIMIT = 8;

/**
 * Tiles in the bag matching a free-text query, read exactly as the search box
 * reads it — a partial encoding, a name, or a tag.
 */
function bagMatches(query, kind) {
	const counts = playCounts();
	return searchTiles(
		availableTiles(),
		{ ...DEFAULT_FILTERS, query, kinds: kind ? [kind] : [], unplayedOnly: true },
		(t) => remainingCopies(t, counts),
		state.catalog ?? {},
	);
}

function drawPanel() {
	const query = ui.drawInput.trim();
	return h(
		'section',
		{ class: 'card draw' },
		h('h2', {}, 'Draw a tile'),
		h(
			'div',
			{ class: 'kind-row', role: 'group', 'aria-label': 'Tile kind' },
			// Only the kinds this campaign can actually draw.
			...DRAWN_KINDS.filter((k) => deckContents().kinds.has(k.key)).map((k) =>
				h(
					'button',
					{
						class: `chip ${ui.drawKind === k.key ? 'on' : ''}`,
						onclick: () => {
							ui.drawKind = k.key;
							ui.pendingTask = null;
							ui.drawMessage = null;
							render();
						},
					},
					k.label,
				),
			),
		),
		h(
			'form',
			{ class: 'row', onsubmit: (e) => (e.preventDefault(), submitDraw()) },
			h('input', {
				id: 'draw-input',
				class: 'mono wide',
				type: 'text',
				autocomplete: 'off',
				spellcheck: 'false',
				placeholder: 'part of the tile, or a name',
				'aria-label': 'Find the tile you drew',
				value: ui.drawInput,
				oninput: (e) => {
					ui.drawInput = e.target.value;
					ui.pendingTask = null;
					ui.drawMessage = null;
					render();
				},
			}),
		),
		ui.drawMessage ? h('p', { class: `note ${ui.drawMessageKind}` }, ui.drawMessage) : null,
		ui.pendingTask && ui.pendingTaskSource === 'draw'
			? taskNumberPicker(ui.pendingTask)
			: drawResults(query),
		h(
			'p',
			{ class: 'muted small' },
			'Type any part of the tile — rotation does not matter — or a special tile’s name. Press Enter when one tile is left.',
		),
	);
}

/**
 * Nothing until you type, a count while the query is still broad, and the tiles
 * themselves once it has narrowed enough to pick from.
 */
function drawResults(query) {
	if (!query) return null;

	const { results, error } = bagMatches(query, ui.drawKind);
	if (error) return h('p', { class: 'note error' }, error);

	if (results.length === 0) {
		return h('p', { class: 'note error' }, explainNothingInBag(query));
	}
	if (results.length > DRAW_RESULT_LIMIT) {
		return h(
			'p',
			{ class: 'note info' },
			`${results.length} tiles match — keep typing to narrow it down.`,
		);
	}

	const counts = playCounts();
	return h(
		'div',
		{ class: 'picker' },
		h(
			'div',
			{ class: 'tile-grid' },
			...results.map((tile) =>
				tileCard(tile, remainingCopies(tile, counts), { onclick: () => chooseTile(tile) }),
			),
		),
	);
}

/** Why a query that looks reasonable turned up nothing drawable. */
function explainNothingInBag(query) {
	const everywhere = searchTiles(
		state.catalog?.tiles ?? [],
		{ ...DEFAULT_FILTERS, query, unplayedOnly: false },
		() => 1,
		state.catalog ?? {},
	).results;
	if (!everywhere.length) return 'Nothing in the catalog matches that.';

	const thisKind = everywhere.filter((t) => t.kind === ui.drawKind);
	if (!thisKind.length) {
		const kinds = [...new Set(everywhere.map((t) => t.kind))];
		if (kinds.length === 1 && kinds[0] === 'temple') {
			return 'That is a temple tile — play it from the temple board.';
		}
		return `That matches a ${kinds.join(' or ')} tile — switch the kind above.`;
	}
	if (!thisKind.some((t) => isUnlocked(t))) {
		return 'Those tiles are not unlocked in this campaign yet.';
	}
	return 'Every match has already been drawn, or is on the temple board.';
}

/** Enter records the tile when the query has narrowed to exactly one. */
function submitDraw() {
	const query = ui.drawInput.trim();
	if (!query) return;
	const { results } = bagMatches(query, ui.drawKind);
	if (results.length === 1) return chooseTile(results[0]);
	render();
}

function taskNumberPicker(tile) {
	const type = taskTypeFor(tile.task);
	const left = taskValuesLeft(tile.task);
	// Offer each distinct value once, labelled with how many tokens remain.
	const distinct = [...new Set(left ?? [])];

	return h(
		'div',
		{ class: 'picker' },
		h(
			'h3',
			{},
			`Value drawn for this ${type?.name ?? tile.task} task`,
		),
		distinct.length
			? h(
				'div',
				{ class: 'number-row' },
				...distinct.map((value) => {
					const copies = left.filter((v) => v === value).length;
					return h(
						'button',
						{ class: 'chip', type: 'button', onclick: () => completeTask(tile, value) },
						String(value),
						copies > 1 ? h('span', { class: 'muted small' }, `×${copies}`) : null,
					);
				}),
			)
			: h(
				'p',
				{ class: 'note info' },
				left === null
					? 'This task type has no value deck.'
					: 'Every value in this task deck has already been drawn.',
			),
		h(
			'form',
			{ class: 'row', onsubmit: (e) => (e.preventDefault(), completeTaskFromInput(tile)) },
			h('input', {
				id: 'task-number',
				type: 'number',
				min: '1',
				placeholder: 'Other',
				'aria-label': 'Task value',
			}),
			h('button', { type: 'submit' }, 'Record'),
			h(
				'button',
				{ class: 'ghost', type: 'button', onclick: () => completeTask(tile, null) },
				'No value',
			),
		),
	);
}

/**
 * "4 4 5   6 6" — the whole deck with drawn tokens blanked out rather than
 * closed up, so the columns line up between one task type and the next.
 */
function valuesLeftText(taskKey) {
	const slots = taskValueSlots(taskKey);
	if (slots === null) return 'no value deck';
	return slots.map((slot) => (slot.taken ? ' ' : String(slot.value))).join(' ');
}

function chooseTile(tile, source = 'draw') {
	ui.pendingTaskSource = source;
	if (tile.kind === 'task') {
		const type = taskTypeFor(tile.task);
		// A type that always scores the same needs no prompt.
		if (type?.fixed) {
			recordPlay(tile, type.fixed);
			return resetDraw(`Recorded ${format(tile.edges, tile.blossom)} as ${type.fixed}.`);
		}
		if (taskValuesLeft(tile.task) !== null) {
			ui.pendingTask = tile;
			return message('Which value did you draw for this task?', 'info');
		}
	}
	recordPlay(tile);
	return resetDraw(`Recorded ${format(tile.edges, tile.blossom)}.`);
}

function completeTask(tile, number) {
	recordPlay(tile, number);
	resetDraw(
		number === null
			? `Recorded ${format(tile.edges, tile.blossom)}.`
			: `Recorded ${format(tile.edges, tile.blossom)} as task ${number}.`,
	);
}

function completeTaskFromInput(tile) {
	const input = document.getElementById('task-number');
	const value = Number.parseInt(input.value, 10);
	completeTask(tile, Number.isFinite(value) ? value : null);
}

function resetDraw(text) {
	ui.drawInput = '';
	ui.pendingTask = null;
	message(text, 'ok');
}

function message(text, kind) {
	ui.drawMessage = text;
	ui.drawMessageKind = kind;
	render();
}

// --- search ----------------------------------------------------------------

function searchPanel() {
	const counts = playCounts();
	const deck = availableTiles();
	const { results, error } = searchTiles(
		deck,
		ui.filters,
		(t) => remainingCopies(t, counts),
		state.catalog ?? {},
	);

	return h(
		'section',
		{ class: 'card search' },
		h('h2', {}, 'Tiles left'),
		h('input', {
			id: 'search-input',
			class: 'mono wide',
			type: 'search',
			autocomplete: 'off',
			spellcheck: 'false',
			placeholder: 'i.i, a name like daimyo, or several terms',
			'aria-label': 'Search tiles',
			value: ui.filters.query,
			oninput: (e) => {
				ui.filters.query = e.target.value;
				render();
			},
		}),
		error ? h('p', { class: 'note error' }, error) : null,
		filterControls(),
		// A task checked off here asks for its value here, rather than sending
		// you off to the draw panel.
		ui.pendingTask && ui.pendingTaskSource === 'search'
			? taskNumberPicker(ui.pendingTask)
			: null,
		h(
			'p',
			{ class: 'muted small' },
			`${results.length} of ${deck.length} tile designs${ui.filters.unplayedOnly ? ' still in the bag' : ''}`,
		),
		// Landscape and task tiles come up under different circumstances, so they
		// are listed separately rather than mixed together.
		...KINDS.map((kind) => {
			const group = results.filter((t) => t.kind === kind.key);
			if (!group.length) return null;
			return h(
				'div',
				{ class: 'result-group' },
				h('h3', {}, `${kind.label} (${group.length})`),
				h(
					'div',
					{ class: 'tile-grid' },
					...group.map((tile) =>
						tileCard(tile, remainingCopies(tile, counts), {
							onRecord: canRecord(tile, remainingCopies(tile, counts))
								? () => chooseTile(tile, 'search')
								: null,
						}),
					),
				),
			);
		}),
		results.length === 0 ? h('p', { class: 'muted' }, 'Nothing matches.') : null,
	);
}

/**
 * What the campaign's deck can actually contain, so filters for mechanics you
 * have not unlocked yet stay out of the way.
 */
function deckContents() {
	const tiles = availableTiles();
	const edges = new Set();
	const taskTypes = new Set();
	const kinds = new Set();
	let blossom = false;
	let special = false;
	for (const tile of tiles) {
		for (const ch of tile.edges) edges.add(ch);
		for (const key of tasksOf(tile)) taskTypes.add(key);
		kinds.add(tile.kind);
		if (tile.blossom) blossom = true;
		if (tile.special) special = true;
	}
	return { edges, taskTypes, kinds, blossom, special };
}

function filterControls() {
	const deck = deckContents();
	const features = filterableFeatures().filter((f) => deck.edges.has(f.key));
	// Temple tiles live on the board rather than in the bag, so filtering the
	// results down to them tells you nothing you cannot see there.
	const kinds = DRAWN_KINDS.filter((k) => deck.kinds.has(k.key));
	const taskTypes = (state.catalog?.taskTypes ?? []).filter((t) => deck.taskTypes.has(t.key));
	const hasFlags = [...deck.edges].some((ch) => '1234'.includes(ch));
	return h(
		'details',
		{
			class: 'filters',
			open: ui.filtersOpen,
			ontoggle: (e) => {
				ui.filtersOpen = e.target.open;
			},
		},
		h('summary', {}, 'Filters'),
		featureRow('Must include', 'include', features, INCLUDE_HINT),
		featureRow('Must exclude', 'exclude', features, EXCLUDE_HINT),
		h(
			'div',
			{ class: 'chip-row' },
			h('span', { class: 'chip-label' }, 'Shape'),
			...SHAPES.map((shape) =>
				toggleChip(
					shape.label,
					ui.filters.shapes.includes(shape.key),
					() => toggleList('shapes', shape.key),
					null,
					shape.hint,
				),
			),
		),
		kinds.length > 1
			? h(
				'div',
				{ class: 'chip-row' },
				h('span', { class: 'chip-label' }, 'Kind'),
				...kinds.map((k) =>
					toggleChip(k.label, ui.filters.kinds.includes(k.key), () => toggleList('kinds', k.key)),
				),
			)
			: null,
		taskTypes.length
			? h(
				'div',
				{ class: 'chip-row' },
				h('span', { class: 'chip-label' }, 'Task type'),
				...taskTypes.map((type) =>
					toggleChip(type.name, ui.filters.taskTypes.includes(type.key), () =>
						toggleList('taskTypes', type.key),
					),
				),
			)
			: null,
		h(
			'div',
			{ class: 'chip-row' },
			deck.blossom
				? toggleChip('Cherry blossom', ui.filters.hasBlossom, () => toggleFlag('hasBlossom'))
				: null,
			deck.edges.has('c')
				? toggleChip('Clouds', ui.filters.hasClouds, () => toggleFlag('hasClouds'))
				: null,
			hasFlags
				? toggleChip('Flag tiles only', ui.filters.hasFlag, () => toggleFlag('hasFlag'), null,
					'Show only tiles carrying a flag of any colour')
				: null,
			deck.special
				? toggleChip('Special only', ui.filters.specialOnly, () => toggleFlag('specialOnly'), null,
					'Show only the named special tiles, which some rules treat differently')
				: null,
			toggleChip('Single terrain', ui.filters.singleTerrain, () => toggleFlag('singleTerrain')),
			toggleChip('Unplayed only', ui.filters.unplayedOnly, () => toggleFlag('unplayedOnly')),
			h(
				'button',
				{
					class: 'ghost small',
					onclick: () => {
						ui.filters = { ...DEFAULT_FILTERS, query: ui.filters.query };
						render();
					},
				},
				'Reset',
			),
		),
	);
}

function featureRow(label, listName, features, hint) {
	return h(
		'div',
		{ class: 'chip-row' },
		h('span', { class: 'chip-label', title: hint }, label),
		...features.map((f) =>
			toggleChip(
				f.name,
				ui.filters[listName].includes(f.key),
				() => toggleList(listName, f.key),
				f.color,
				f.hint ? `${f.name} — ${f.hint}` : null,
			),
		),
	);
}

function toggleChip(label, on, onclick, color, hint) {
	return h(
		'button',
		{ class: `chip ${on ? 'on' : ''}`, onclick, type: 'button', title: hint },
		color ? h('span', { class: 'swatch', style: `background:${color}` }) : null,
		label,
	);
}

function toggleList(name, key) {
	const list = ui.filters[name];
	ui.filters[name] = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
	render();
}

function toggleFlag(name) {
	ui.filters[name] = !ui.filters[name];
	render();
}

/** Can this tile be checked off from the search results? */
function canRecord(tile, remaining) {
	// Temple tiles are played from the board, not drawn from the bag.
	return state.campaign?.game && tile.kind !== 'temple' && remaining > 0;
}

function tileCard(tile, remaining, { onclick, onRecord } = {}) {
	// A whole-card button cannot hold another button, so the two are exclusive.
	const tag = onclick ? 'button' : 'div';
	const taskType = tile.kind === 'task' ? taskTypeFor(tile.task) : null;
	return h(
		tag,
		{
			class: `tile-card ${remaining === 0 ? 'spent' : ''}`,
			onclick,
			type: onclick ? 'button' : null,
		},
		renderHex(tile, { size: 88 }),
		h('span', { class: 'mono tile-code' }, format(tile.edges, tile.blossom)),
		// A named tile is a special one, so the name alone carries that.
		tile.name
			? h(
				'span',
				{ class: 'tile-name', title: 'A special tile — some rules treat it differently' },
				tile.name,
			)
			: null,
		tile.tags?.length ? h('span', { class: 'muted small' }, tile.tags.join(' · ')) : null,
		countLabel(tile, remaining)
			? h('span', { class: 'muted small' }, countLabel(tile, remaining))
			: null,
		!onclick && onRecord
			? h(
				'button',
				{
					class: 'record-draw',
					title: `Record ${format(tile.edges, tile.blossom)} as drawn`,
					onclick: onRecord,
				},
				'Drew it',
			)
			: null,
		taskType
			? h(
				'span',
				{
					class: 'task-values',
					// Tinted by task type, so a river task reads as one at a glance.
					style: taskChipStyle(tile),
					title: taskChipTitle(tile, taskType),
				},
				h('span', { class: 'task-type' }, taskChipLabel(tile, taskType)),
				h('span', { class: 'mono values' }, valuesLeftText(tile.task)),
			)
			: null,
	);
}

/**
 * The tint for a task tile's footer. A tile that counts as two task types gets
 * half of each colour rather than one colour of its own.
 */
function taskChipStyle(tile) {
	const colors = chipColors(tile);
	if (!colors.length) return null;
	const ink = inkOn(averageColor(colors));
	if (colors.length === 1) return `background:${colors[0]};color:${ink}`;
	const stops = colors
		.map((c, i) => `${c} ${(i * 100) / colors.length}% ${((i + 1) * 100) / colors.length}%`)
		.join(', ');
	return `background:linear-gradient(90deg, ${stops});color:${ink}`;
}

/** The colours of the task types a tile counts as, in order. */
function chipColors(tile) {
	const types = tile.alsoTasks?.length ? tile.alsoTasks : [tile.task];
	return types.map((key) => taskTypeFor(key)?.color).filter(Boolean);
}

function taskChipLabel(tile, taskType) {
	if (!tile.alsoTasks?.length) return taskType.name;
	return tile.alsoTasks.map((key) => taskTypeFor(key)?.name ?? key).join(' / ');
}

function taskChipTitle(tile, taskType) {
	if (!tile.alsoTasks?.length) return `Values left in the ${taskType.name} task deck`;
	const names = tile.alsoTasks.map((key) => taskTypeFor(key)?.name ?? key);
	return `${taskType.name}: scores ${taskType.fixed}, and counts as ${names.join(' or ')}`;
}

/**
 * How many copies are left, said only when it is worth saying. A single-copy
 * tile still in the bag needs no label — being listed is the whole message.
 */
function countLabel(tile, remaining) {
	const kind = tile.kind === 'landscape' ? '' : `${tile.kind} · `;
	if (tile.copies > 1) return `${kind}${remaining} of ${tile.copies} left`;
	if (remaining === 0) return `${kind}drawn`;
	return kind.trim().replace(/ ·$/, '');
}

function rgbOf(color) {
	if (!/^#[0-9a-f]{6}$/i.test(color ?? '')) return null;
	return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

/** Black or white, whichever stands out on the given "#rrggbb" background. */
function inkOn(color) {
	const rgb = rgbOf(color);
	if (!rgb) return '#ffffff';
	const [r, g, b] = rgb;
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#1d2129' : '#ffffff';
}

/** Blend colours, so text over a split background is legible on both halves. */
function averageColor(colors) {
	const parts = colors.map(rgbOf).filter(Boolean);
	if (!parts.length) return null;
	const mean = [0, 1, 2].map((i) =>
		Math.round(parts.reduce((sum, p) => sum + p[i], 0) / parts.length),
	);
	return `#${mean.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// --- played log ------------------------------------------------------------

function logPanel() {
	const plays = state.campaign.game.plays;
	const last = plays.length - 1;
	return h(
		'section',
		{ class: 'card log' },
		h('h2', {}, `Drawn this game (${plays.length})`),
		plays.length === 0
			? h('p', { class: 'muted' }, 'Nothing drawn yet.')
			: h(
				'ol',
				{ class: 'play-list' },
				...plays
					.map((play, i) => ({ play, i }))
					.reverse()
					.map(({ play, i }) => {
						const tile = tileById(play.tileId);
						return h(
							'li',
							{},
							h('span', { class: 'play-index' }, String(i + 1)),
							tile ? renderHex(tile, { size: 34 }) : null,
							h(
								'span',
								{ class: 'mono' },
								tile ? format(tile.edges, tile.blossom) : play.tileId,
							),
							tile?.task
								? h(
									'span',
									{ class: 'pill' },
									taskTypeFor(tile.task)?.name ?? tile.task,
									play.taskNumber !== null && play.taskNumber !== undefined
										? ` ${play.taskNumber}`
										: '',
								)
								: null,
							i === last
								? h('button', { class: 'ghost small', onclick: () => undoLastPlay() }, 'Undo')
								: null,
						);
					}),
			),
		h(
			'div',
			{ class: 'row' },
			h(
				'button',
				{
					class: 'ghost',
					onclick: () => {
						if (!window.confirm('Finish this game and file it under past games?')) return;
						endGame();
						go(`#/c/${state.campaign.id}`);
					},
				},
				'Finish game',
			),
			h(
				'button',
				{
					class: 'ghost danger',
					onclick: () => {
						if (!window.confirm('Clear every tile drawn this game?')) return;
						mutate((c) => {
							c.game.plays = [];
						});
					},
				},
				'Clear',
			),
		),
	);
}

// --- helpers ---------------------------------------------------------------

function formatDate(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return 'unknown';
	return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// --- boot ------------------------------------------------------------------

async function syncRoute() {
	const { view, id } = route();
	// Unlock edits are only ever written by the Save button, so leaving the page
	// drops whatever was outstanding.
	clearPendingUnlocks();
	if (view === 'home') {
		closeCampaign();
		try {
			ui.campaigns = await api.listCampaigns();
			ui.loadError = null;
		} catch (err) {
			ui.loadError = err.message;
		}
		render();
		return;
	}
	if (!state.campaign || state.campaign.id !== id) {
		try {
			await openCampaign(id);
			ui.loadError = null;
		} catch (err) {
			ui.loadError = `Could not open that campaign: ${err.message}`;
			state.campaign = null;
		}
	}
	render();
}

async function boot() {
	try {
		const catalog = await loadCatalog();
		setFeatures(catalog.features);
	} catch (err) {
		ui.loadError = `Could not load the tile catalog: ${err.message}`;
	}
	subscribe(render);
	window.addEventListener('hashchange', syncRoute);
	await syncRoute();
}

boot();
