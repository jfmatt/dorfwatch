// SVG rendering of a hex tile.
//
// Flat-top hex. Edge 0 is the top edge and edges run clockwise, matching the
// order features are written in an encoding.
//
// Each edge gets a coloured band around the rim — that part is a direct readout
// of the encoding. The core then shows how those edges join up inside the tile:
// see connections() for the rules.

import { allFeatures, areaOf, featureFor, format } from './encoding.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 46; // outer radius
const INNER = 0.5; // inner hex as a fraction of R; the gap between is the band
const STUB = 0.32; // how far a dead-end run reaches towards the centre

/** Features that are drawn as a line running into the middle of the tile. */
const LINEAR = new Set(['i', 'r']);

/**
 * Terrain that reads as one area when it appears on more than one edge. It is
 * only worth drawing a band across the core when those edges are apart — where
 * they sit side by side the shared border already shows they are one area, and
 * a line through the middle is just clutter. Meadow is the blank filler and
 * clouds cover the tile, so neither is linked.
 */
const LINKING = new Set(['p', 'v', 'g', 'h', 'j']);

/** Vertex k of a flat-top hex, placed so edge 0 is the horizontal top edge. */
function vertex(k, radius = R) {
  const angle = ((240 + 60 * k) * Math.PI) / 180;
  return [radius * Math.cos(angle), radius * Math.sin(angle)];
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function points(list) {
  return list.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
}

/**
 * How the edges of a tile join up through its centre.
 *
 * Rivers and roads always run to the middle of the tile: two or more such edges
 * meet there, and a lone one is a dead end. Sakura, village, rice and hot
 * springs are areas — where the same one appears on several edges it is a
 * single area spanning the tile, so those edges are joined too. Meadow, clouds
 * and flags are left alone.
 *
 * The encoding does not record this directly, but no two tiles share an edge
 * sequence while differing in how it connects, so it can be derived.
 *
 * @returns {Array<{feature: string, edges: number[], kind: 'line'|'area', stub: boolean}>}
 */
export function connections(edges) {
  // Group by area rather than by edge character, so a flag joins the coloured
  // region it stands in.
  const byArea = new Map();
  [...edges].forEach((ch, i) => {
    const key = areaOf(ch);
    if (!byArea.has(key)) byArea.set(key, []);
    byArea.get(key).push(i);
  });

  const out = [];
  for (const feature of allFeatures()) {
    const idx = byArea.get(feature.key);
    if (!idx) continue;
    if (LINEAR.has(feature.key)) {
      out.push({ feature: feature.key, edges: idx, kind: 'line', stub: idx.length === 1 });
    } else if (LINKING.has(feature.key)) {
      // Adjacent edges already touch, so only separated stretches need joining.
      const runs = adjacentRuns(idx);
      if (runs.length > 1) {
        const edges = runs.map((run) => run[Math.floor(run.length / 2)]);
        out.push({ feature: feature.key, edges, kind: 'area', stub: false });
      }
    }
  }
  return out;
}

/**
 * Split edge indices into maximal stretches of neighbouring edges, walking the
 * hex cyclically — so 5 and 0 count as neighbours. More than one stretch means
 * the area is split and needs a band through the middle to show it joins up.
 */
function adjacentRuns(indices) {
  if (indices.length === 0) return [];
  const set = new Set(indices);
  if (set.size === 6) return [indices];

  // Start where the previous edge is not part of the area, so no run is cut in
  // half by wrapping past edge 0.
  const start = indices.find((i) => !set.has((i + 5) % 6));
  const runs = [];
  let run = [];
  for (let step = 0; step < 6; step += 1) {
    const i = (start + step) % 6;
    if (set.has(i)) {
      run.push(i);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

/**
 * Render a tile as an <svg> element.
 *
 * @param tile {{edges: string, blossom: number|null, kind: string}}
 * @param options.size pixel size of the rendered hex
 * @param options.title accessible label; defaults to the encoding
 */
export function renderHex(tile, { size = 96, title } = {}) {
  const svg = el('svg', {
    viewBox: '-50 -50 100 100',
    width: size,
    height: size,
    class: 'hex',
    role: 'img',
    'aria-label': title ?? `Tile ${format(tile.edges, tile.blossom)}`,
  });

  const outer = [];
  const inner = [];
  for (let k = 0; k < 6; k += 1) {
    outer.push(vertex(k));
    inner.push(vertex(k, R * INNER));
  }
  const innerMid = inner.map((_, k) => midpoint(inner[k], inner[(k + 1) % 6]));

  // The core is the backdrop the connections are drawn on.
  svg.append(el('polygon', { points: points(inner), class: 'hex-core' }));

  const links = connections(tile.edges);
  // Areas go underneath, so a river crossing one reads as passing over it.
  for (const link of links.filter((l) => l.kind === 'area')) {
    svg.append(linkGroup(link, innerMid, 'hex-link-area'));
  }
  for (const link of links.filter((l) => l.kind === 'line')) {
    svg.append(linkGroup(link, innerMid, 'hex-link-line'));
  }

  for (let k = 0; k < 6; k += 1) {
    const next = (k + 1) % 6;
    const feature = featureFor(tile.edges[k]);
    const band = el('polygon', {
      points: points([outer[k], outer[next], inner[next], inner[k]]),
      fill: feature?.color ?? '#3a3f46',
      class: 'hex-band',
    });
    const label = el('title');
    label.textContent = feature ? `${feature.name} edge` : 'unknown edge';
    band.append(label);
    svg.append(band);

    const mid = midpoint4(outer[k], outer[next], inner[k], inner[next]);
    if (feature?.flag) svg.append(flagMark(mid));
  }

  // The blossom belongs to an area rather than to one edge, so it is drawn
  // inside one of that area's coloured bands — the middle of the tile is bare
  // unless something actually connects across it.
  if (tile.blossom) {
    const k = blossomEdge(tile.edges, tile.blossom);
    if (k >= 0) {
      const next = (k + 1) % 6;
      const onFlag = !!featureFor(tile.edges[k])?.flag;
      svg.append(blossomMark(midpoint4(outer[k], outer[next], inner[k], inner[next]), onFlag));
    }
  }

  svg.append(el('polygon', { points: points(outer), class: 'hex-outline' }));
  return svg;
}

/**
 * Which band to draw the blossom in: the first edge showing that feature
 * outright, or failing that one whose area it belongs to — a pink flag is part
 * of the sakura area, so it can carry the sakura blossom.
 */
function blossomEdge(edges, blossom) {
  const exact = edges.indexOf(blossom);
  if (exact >= 0) return exact;
  return [...edges].findIndex((ch) => areaOf(ch) === blossom);
}

/** One spoke per edge, meeting at the centre — or stopping short if it is a dead end. */
function linkGroup(link, innerMid, className) {
  const feature = featureFor(link.feature);
  const g = el('g', { class: className, stroke: feature?.color ?? '#888' });
  for (const k of link.edges) {
    const [x, y] = innerMid[k];
    const scale = link.stub ? STUB : 0;
    g.append(
      el('line', {
        x1: x.toFixed(2),
        y1: y.toFixed(2),
        x2: (x * scale).toFixed(2),
        y2: (y * scale).toFixed(2),
      }),
    );
  }
  const label = el('title');
  label.textContent = link.stub
    ? `${feature?.name} ends here`
    : `${feature?.name} connects ${link.edges.length} edges`;
  g.append(label);
  return g;
}

function midpoint(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function midpoint4(a, b, c, d) {
  return [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4];
}

/** A small pennant, so a flag edge reads differently from plain terrain. */
function flagMark([x, y]) {
  const g = el('g', { class: 'hex-flag', transform: `translate(${x.toFixed(2)} ${y.toFixed(2)})` });
  g.append(el('line', { x1: -1, y1: -5, x2: -1, y2: 5 }));
  g.append(el('polygon', { points: '-1,-5 6,-2.5 -1,0' }));
  return g;
}

/** A five-petal cherry blossom, nudged aside if it shares a band with a flag. */
function blossomMark([x, y], besideFlag = false) {
  const g = el('g', {
    class: 'hex-blossom',
    transform: `translate(${(x * (besideFlag ? 0.78 : 1)).toFixed(2)} ${(y * (besideFlag ? 0.78 : 1)).toFixed(2)})`,
  });
  for (let i = 0; i < 5; i += 1) {
    const angle = (i * 72 * Math.PI) / 180;
    g.append(
      el('circle', {
        cx: (Math.cos(angle) * 2.6).toFixed(2),
        cy: (Math.sin(angle) * 2.6).toFixed(2),
        r: 2.4,
      }),
    );
  }
  g.append(el('circle', { cx: 0, cy: 0, r: 1.4, class: 'hex-blossom-centre' }));
  return g;
}

/** A face-down tile, for the unrevealed slots on the temple board. */
export function renderHexBack({ size = 96, label = 'Face-down tile' } = {}) {
  const svg = el('svg', {
    viewBox: '-50 -50 100 100',
    width: size,
    height: size,
    class: 'hex hex-back',
    role: 'img',
    'aria-label': label,
  });
  const outer = [];
  for (let k = 0; k < 6; k += 1) outer.push(vertex(k));
  svg.append(el('polygon', { points: points(outer), class: 'hex-back-face' }));
  const mark = el('text', { x: 0, y: 0, class: 'hex-back-mark' });
  mark.textContent = '?';
  svg.append(mark);
  svg.append(el('polygon', { points: points(outer), class: 'hex-outline' }));
  return svg;
}
