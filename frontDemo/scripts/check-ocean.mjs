// Usage: node scripts/check-ocean.mjs /path/to/ne_10m_land.geojson
// Natural Earth 1:10m land polygons; run check-reconstruction.ts first.
import { readFileSync } from 'node:fs';
const land = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fields = JSON.parse(readFileSync('/private/tmp/oilspill-frame-contours.json', 'utf8'));
const bbox = ring => ring.reduce((b, p) => [Math.min(b[0], p[0]), Math.min(b[1], p[1]), Math.max(b[2], p[0]), Math.max(b[3], p[1])], [Infinity, Infinity, -Infinity, -Infinity]);
const overlaps = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const inside = (p, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const intersects = (a, b, c, d) => overlaps(bbox([a, b]), bbox([c, d])) && cross(a, b, c) * cross(a, b, d) <= 0 && cross(c, d, a) * cross(c, d, b) <= 0;
const polygons = land.features.flatMap(f => f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
  .map(rings => ({ rings, box: bbox(rings[0]) }));
const collisions = [];
for (const f of fields.features) {
  let hit = false;
  for (const [ring] of f.geometry.coordinates) {
    const box = bbox(ring);
    for (const land of polygons) {
      if (!overlaps(box, land.box)) continue;
      const [outer, ...holes] = land.rings;
      if ((inside(ring[0], outer) && !holes.some(h => inside(ring[0], h))) || inside(outer[0], ring)) { hit = true; break; }
      const segments = land.rings.flatMap(r => r.slice(1).map((p, i) => [r[i], p])).filter(s => overlaps(box, bbox(s)));
      if (segments.some(([a, b]) => ring.slice(1).some((p, i) => intersects(a, b, ring[i], p)))) { hit = true; break; }
    }
    if (hit) break;
  }
  if (hit) collisions.push(f.properties);
}
console.log(JSON.stringify({ checkedFrames: fields.features.length, landIntersections: collisions }, null, 2));
if (collisions.length) process.exitCode = 1;
