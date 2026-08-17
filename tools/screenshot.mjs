// Regenerate docs/screenshot.png.
//
// Drives headless Chrome over the DevTools protocol, which -- unlike Chrome's
// own --screenshot flag -- can type into the page, so the shot can show a real
// search rather than an empty box. Node's built-in WebSocket does the talking,
// so there is nothing to install.
//
//   go run .                     # in another terminal
//   npm run screenshot
//
// Options, all with sensible defaults:
//   --server   http://localhost:8080
//   --query    the search to type into the "Tiles left" box
//   --out      where to write the PNG
//   --width / --height   viewport in CSS pixels; captured at 2x
//
// Set DORFWATCH_CHROME if your Chrome is somewhere unusual.

import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const opts = {
  server: 'http://localhost:8080',
  query: 'i..i',
  out: 'docs/screenshot.png',
  width: '1500',
  height: '1320',
  port: '9222',
};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, '');
  if (!(key in opts)) throw new Error(`unknown option --${key}`);
  opts[key] = process.argv[i + 1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- chrome ----------------------------------------------------------------

const CHROME_CANDIDATES = [
  process.env.DORFWATCH_CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // WSL can drive the Windows install directly.
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!found) {
    throw new Error(
      'No Chrome found. Set DORFWATCH_CHROME to the binary you want to use.',
    );
  }
  return found;
}

/**
 * A scratch profile directory Chrome can actually write to. A Windows Chrome
 * driven from WSL needs a Windows path, so ask Windows for its temp directory.
 */
function profileDir(chrome) {
  if (!chrome.startsWith('/mnt/')) return '/tmp/dorfwatch-chrome-profile';
  // Run cmd.exe from a drive it can see: launching it from a \\wsl.localhost
  // path makes it grumble about UNC paths on stderr.
  const temp = execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], {
    encoding: 'utf8',
    cwd: '/mnt/c',
  }).trim();
  return `${temp}\\dorfwatch-chrome-profile`;
}

async function launchChrome() {
  const chrome = findChrome();
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--remote-debugging-port=${opts.port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${profileDir(chrome)}`,
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  for (let i = 0; i < 40; i += 1) {
    try {
      await fetch(`http://localhost:${opts.port}/json/version`);
      return child;
    } catch {
      await sleep(250);
    }
  }
  child.kill();
  throw new Error(`Chrome never opened its debugging port (${chrome})`);
}

// --- devtools --------------------------------------------------------------

async function connect() {
  const targets = await (await fetch(`http://localhost:${opts.port}/json`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    const waiting = pending.get(msg.id);
    if (!waiting) return;
    pending.delete(msg.id);
    msg.error ? waiting.reject(new Error(JSON.stringify(msg.error))) : waiting.resolve(msg.result);
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    return result.value;
  };

  return { ws, send, evaluate };
}

// --- a campaign worth photographing ----------------------------------------

/**
 * Build a throwaway campaign that looks like a game in progress, so the shot
 * shows the app doing something. Returns its id; the caller deletes it.
 */
async function seedCampaign() {
  const api = (path, init) => fetch(`${opts.server}${path}`, init).then((r) => r.json());
  const post = (path, body) =>
    api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  const catalog = await api('/api/catalog');
  const campaign = await post('/api/campaigns', { name: 'Sakura valley' });

  // A campaign a dozen achievements in, mid-game.
  campaign.unlockedAchievements = [
    'box-2', 'temples', 'wraparound-tasks', 'daimyo', 'sumo-wrestler', 'moss-collector',
    'rice-farmer', 'hot-springs', 'lake', 'crossroads', 'ship-pier', 'cartographer',
  ].filter((id) => catalog.achievements.some((a) => a.id === id));

  const unlocked = catalog.tiles.filter(
    (t) => !t.unlock || campaign.unlockedAchievements.includes(t.unlock),
  );
  const find = (edges, kind) =>
    unlocked.find((t) => t.kind === kind && t.canonical === canonicalOf(edges));

  const temple = unlocked.filter((t) => t.kind === 'temple');
  campaign.game = {
    startedAt: new Date().toISOString(),
    plays: [],
    temple: [
      ...temple.map((t) => ({ source: 'temple', tileId: t.id, played: false })),
      ...Array.from({ length: 3 }, () => ({ source: 'landscape', tileId: '', played: false })),
    ],
  };

  const play = (edges, kind, taskNumber = null) => {
    const tile = find(edges, kind);
    if (!tile) return;
    campaign.game.plays.push({
      tileId: tile.id, kind, taskNumber, slot: null, at: new Date().toISOString(),
    });
  };
  for (const e of ['immimm', 'gggggm', 'vvvvvm', 'ggppvv', 'imippp', 'rmprgg', 'mppmrr']) {
    play(e, 'landscape');
  }
  for (const [e, v] of [['iimvvm', 5], ['rrmppm', 4], ['imgggm', 6]]) play(e, 'task', v);

  // One of the held-out tiles turned face up.
  const held = find('ggmvvm', 'landscape');
  const slot = campaign.game.temple.find((s) => s.source === 'landscape');
  if (held && slot) slot.tileId = held.id;

  await fetch(`${opts.server}/api/campaigns/${campaign.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(campaign),
  });
  return campaign.id;
}

/** The same canonical rotation the server derives, so tiles can be looked up. */
function canonicalOf(edges) {
  let best = edges;
  for (let shift = 1; shift < edges.length; shift += 1) {
    const rotated = edges.slice(shift) + edges.slice(0, shift);
    if (rotated < best) best = rotated;
  }
  return best;
}

// --- go --------------------------------------------------------------------

try {
  await fetch(`${opts.server}/api/catalog`);
} catch {
  console.error(`No server at ${opts.server} — start one with "go run ." first.`);
  process.exit(1);
}

const campaignId = await seedCampaign();
const chrome = await launchChrome();
let failure = null;

try {
  const { ws, send, evaluate } = await connect();
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: Number(opts.width),
    height: Number(opts.height),
    deviceScaleFactor: 2,
    mobile: false,
  });

  await send('Page.navigate', { url: `${opts.server}/#/c/${campaignId}/game` });
  for (let i = 0; i < 60; i += 1) {
    if (await evaluate(`!!document.getElementById('search-input')`)) break;
    await sleep(250);
  }

  // Type it the way a keystroke would, so the app's own handler runs.
  await evaluate(`
    (() => {
      const box = document.getElementById('search-input');
      box.value = ${JSON.stringify(opts.query)};
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.blur();
      return true;
    })()
  `);
  await sleep(400);

  const shown = await evaluate(`document.querySelectorAll('.tile-card').length`);
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  await writeFile(opts.out, Buffer.from(data, 'base64'));
  console.log(`${opts.out}: "${opts.query}" showing ${shown} tiles`);
  ws.close();
} catch (err) {
  failure = err;
} finally {
  chrome.kill();
  // Leave no demo campaign behind in the real save directory.
  await fetch(`${opts.server}/api/campaigns/${campaignId}`, { method: 'DELETE' }).catch(() => {});
}

if (failure) {
  console.error(failure.message);
  process.exit(1);
}
