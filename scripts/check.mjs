#!/usr/bin/env node
/**
 * Data & routing smoke test (no browser needed):  node scripts/check.mjs
 * - every restaurant has a valid category, position and building
 * - every restaurant is reachable from the station for WALK / BIKE / CAR × FASTEST / EASY / SCENIC
 * - route paths are finite and plausible
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoadGraph } from '../src/routing.js';
import { buildRoutePath } from '../src/pathgeo.js';
import { CATEGORIES } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const roads = read('roads.json');
const buildings = read('buildings.json');
const restaurants = read('restaurants.json').restaurants;
const errors = [];
const ids = new Set();
const withBuilding = new Set(Object.values(buildings.shops));
for (const r of restaurants) {
  if (ids.has(r.id)) errors.push(`${r.id}: duplicate id`);
  ids.add(r.id);
  if (!CATEGORIES[r.category]) errors.push(`${r.id}: unknown category "${r.category}"`);
  if (!Number.isFinite(r.position?.x) || !Number.isFinite(r.position?.z)) errors.push(`${r.id}: bad position`);
  if (!withBuilding.has(r.id)) errors.push(`${r.id}: no shop building — run "node scripts/generate-data.mjs"`);
  for (const k of ['name', 'description', 'priceText']) if (!r[k]) errors.push(`${r.id}: missing ${k}`);
}
const t0 = performance.now();
const graph = new RoadGraph(roads, restaurants);
let routes = 0;
for (const r of restaurants) {
  const all = graph.routesFor(r.id);
  for (const m of ['walk', 'bike', 'car']) for (const v of ['fastest', 'easy', 'scenic']) {
    const rt = all[m][v];
    if (!rt) { errors.push(`${r.id}: no ${m}/${v} route`); continue; }
    const p = buildRoutePath(graph, rt, r);
    if (![...p.x, ...p.z].every(Number.isFinite)) errors.push(`${r.id}: ${m}/${v} path has NaN`);
    if (!(rt.time > 0 && rt.time < 3600)) errors.push(`${r.id}: ${m}/${v} implausible time ${rt.time}`);
    routes++;
  }
  if (!all.best?.reason) errors.push(`${r.id}: no recommendation`);
}
const ms = Math.round(performance.now() - t0);
if (errors.length) {
  console.error(errors.join('\n'));
  console.error(`\n✗ ${errors.length} problem(s)`);
  process.exit(1);
}
console.log(`✓ ${restaurants.length} restaurants, ${roads.nodes.length} nodes, ${roads.edges.length} edges, ${buildings.items.length} buildings`);
console.log(`✓ ${routes} routes computed in ${ms} ms`);
