// Mirrors internal/tiles/tiles_test.go — the two implementations must agree,
// because the server canonicalizes the catalog and the client matches against it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  areaOf,
  canonical,
  edgeSatisfies,
  format,
  hasFeature,
  match,
  parse,
  rotations,
} from '../web/js/encoding.js';

test('parse reads encodings and blossoms', () => {
  assert.deepEqual(parse('immimm'), { edges: 'immimm', blossom: '' });
  assert.deepEqual(parse('IMMIMM'), { edges: 'immimm', blossom: '' });
  assert.deepEqual(parse('rpp*rgg'), { edges: 'rpprgg', blossom: 'p' });
  assert.deepEqual(parse('rppr*gg'), { edges: 'rpprgg', blossom: 'r' });
  assert.deepEqual(parse('i m m i m m'), { edges: 'immimm', blossom: '' });
  assert.deepEqual(parse('c123 4m'), { edges: 'c1234m', blossom: '' });
  assert.deepEqual(parse('hhgirm'), { edges: 'hhgirm', blossom: '' });
  // The blossom is on the feature, so any of that feature's edges may carry it.
  for (const spelling of ['p*ppmgm', 'pp*pmgm', 'ppp*mgm']) {
    assert.deepEqual(parse(spelling), { edges: 'pppmgm', blossom: 'p' }, spelling);
  }
});

test('parse rejects bad input', () => {
  assert.throws(() => parse('rmmxmm'), /not a tile feature/);
  // 'o' was the road character before road moved to 'r' and river to 'i'.
  assert.throws(() => parse('ommmmm'), /not a tile feature/);
  assert.throws(() => parse('*rmmrmm'), /must follow an edge/);
  assert.throws(() => parse('rm*mr*mm'), /at most one cherry blossom/);
  assert.throws(() => parse('r.r'), /not a tile feature/);
  assert.throws(() => parse('r.*r', { allowWildcard: true }), /cannot follow a wildcard/);
  assert.deepEqual(parse('r.r', { allowWildcard: true }), { edges: 'r.r', blossom: '' });
  // Two stars on the same feature are the one blossom, so they are allowed.
  assert.deepEqual(parse('p*pp*mgm'), { edges: 'pppmgm', blossom: 'p' });
});

test('canonical is the same for every rotation of a tile', () => {
  const want = canonical('immimm').edges;
  for (const rot of rotations('immimm')) {
    assert.equal(canonical(rot).edges, want, `rotation ${rot}`);
  }
});

test('canonical leaves the blossom alone, since it names a feature', () => {
  const a = canonical('rpprgg', 'r');
  assert.equal(a.blossom, 'r');
  // The same physical tile picked up one edge later.
  assert.deepEqual(canonical('pprggr', 'r'), a);
});

test('canonical is identical however the blossom feature is spelled', () => {
  const want = canonical(...Object.values(parse('p*ppmgm')));
  for (const spelling of ['pp*pmgm', 'ppp*mgm', 'pmgmp*p', 'gmp*ppm']) {
    const { edges, blossom } = parse(spelling);
    assert.deepEqual(canonical(edges, blossom), want, spelling);
  }
});

test('canonical rejects a blossom that is not on the tile', () => {
  assert.throws(() => canonical('mmmmmm', 'p'), /not an edge/);
});

test('canonical rejects anything that is not six edges', () => {
  assert.throws(() => canonical('rmm'), /want 6 edges/);
  assert.throws(() => canonical('rmmrmmr'), /want 6 edges/);
});

test('match is cyclic and supports the . wildcard', () => {
  assert.equal(match('i.i', 'imimmm'), true, 'gentle river curve');
  assert.equal(match('i.i', 'immimm'), false, 'wide curve has two gaps');
  assert.equal(match('immimm', 'mmimmi'), true, 'same tile, different rotation');
  assert.equal(match('mi', 'immmmm'), true, 'wraps around the end');
  assert.equal(match('...', 'mmmmmm'), true);
  assert.equal(match('', 'mmmmmm'), true);
  assert.equal(match('iiiiiii', 'iiiiii'), false, 'longer than a tile');
  assert.equal(match('vv', 'vmvmvm'), false);
});

test('a flag answers to its own colour', () => {
  assert.equal(edgeSatisfies('p', '1'), true, 'pink flag is a sakura region');
  assert.equal(edgeSatisfies('v', '2'), true, 'red flag is a village region');
  assert.equal(edgeSatisfies('g', '3'), true, 'green flag is a rice region');
  assert.equal(edgeSatisfies('1', '1'), true);
});

test('a flag does not answer to another colour', () => {
  assert.equal(edgeSatisfies('v', '1'), false);
  assert.equal(edgeSatisfies('g', '1'), false);
  assert.equal(edgeSatisfies('p', '2'), false);
});

test('the rainbow flag counts as any flag and any of the three colours', () => {
  for (const want of ['4', '1', '2', '3', 'p', 'v', 'g']) {
    assert.equal(edgeSatisfies(want, '4'), true, `searching ${want} should find the rainbow flag`);
  }
  for (const want of ['i', 'r', 'm', 'h', 'c']) {
    assert.equal(edgeSatisfies(want, '4'), false, `searching ${want} should not find it`);
  }
});

test('the flag relation is one-way: plain terrain is not a flag', () => {
  assert.equal(edgeSatisfies('1', 'p'), false, 'plain sakura carries no flag');
  assert.equal(edgeSatisfies('4', 'p'), false);
  assert.equal(edgeSatisfies('4', '1'), false, 'a pink flag is not a rainbow flag');
});

test('searching an edge pattern finds flags by their colour', () => {
  assert.equal(match('p', '1mmvvm'), true, 'pink flag answers to sakura');
  assert.equal(match('v', '1mmvvm'), true, 'and the tile really does have village edges');
  assert.equal(match('g', '1mmvvm'), false);
  assert.equal(match('pp', '14mmmm'), true, 'pink flag then rainbow reads as two sakura');
  assert.equal(match('1', 'pmmmmm'), false, 'plain sakura is not a flag');
});

test('hasFeature follows the same rule as the pattern search', () => {
  assert.equal(hasFeature('1mmvvm', 'p'), true);
  assert.equal(hasFeature('1mmvvm', '1'), true);
  assert.equal(hasFeature('1mmvvm', '4'), false);
  assert.equal(hasFeature('4mmmmm', 'g'), true);
  assert.equal(hasFeature('pmmmmm', '1'), false);
});

test('a cloud edge answers to a search for any ordinary terrain', () => {
  for (const want of ['i', 'r', 'p', 'v', 'g', 'm', 'c', '1', '2', '3', '4']) {
    assert.equal(edgeSatisfies(want, 'c'), true, `searching ${want} should find a cloud`);
  }
});

test('a cloud is never hiding a hot spring or Mt. Fuji', () => {
  // Both appear only on their own tiles, so a cloud cannot stand in for them.
  assert.equal(edgeSatisfies('h', 'c'), false);
  assert.equal(edgeSatisfies('j', 'c'), false);
  assert.equal(match('h', 'cmmmmm'), false, 'a cloud tile is not a hot spring tile');
  assert.equal(match('j', 'ccmccm'), false);
  assert.equal(hasFeature('cmmmmm', 'h'), false);
  assert.equal(hasFeature('cmmmmm', 'i'), true, 'ordinary terrain still matches');
});

test('nothing but a cloud answers to a search for clouds', () => {
  for (const edge of ['i', 'r', 'p', 'v', 'g', 'h', 'm', '1', '4']) {
    assert.equal(edgeSatisfies('c', edge), false, `${edge} is not a cloud`);
  }
});

test('a pattern search finds cloud tiles whatever it asks for', () => {
  assert.equal(match('i', 'cmmmmm'), true, 'a cloud could be a river');
  assert.equal(match('r', 'cmmmmm'), true, 'or a road');
  assert.equal(match('ii', 'ccmmmm'), true, 'two clouds could be a river running through');
  assert.equal(match('ii', 'cmmmmm'), false, 'but one cloud is only one edge');
  assert.equal(match('c', 'immmmm'), false, 'a river is not a cloud');
});

test('a flag belongs to the area it stands in', () => {
  assert.equal(areaOf('1'), 'p');
  assert.equal(areaOf('2'), 'v');
  assert.equal(areaOf('3'), 'g');
  assert.equal(areaOf('4'), '4', 'the rainbow flag has no one colour');
  assert.equal(areaOf('m'), 'm');
});

test('format round-trips through parse', () => {
  for (const text of ['rpprgg', 'rppr*gg', 'rpp*rgg', 'mmmmmm*', 'ppp*mgm']) {
    const { edges, blossom } = parse(text);
    const round = parse(format(edges, blossom));
    assert.equal(round.edges, edges, text);
    assert.equal(round.blossom, blossom, text);
  }
});
