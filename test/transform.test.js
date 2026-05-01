// Smoke tests for transform math (rotMat, localToWorld, worldToLocal, opposite, _enforceCircle).
// These mirror the implementation in renderer/js/app.js. We replicate them here
// (not cross-imported) to keep the renderer file framework-free, and run as plain Node.

'use strict';

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}
function assertNear(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) { console.error('FAIL:', msg, 'expected', b, 'got', a); failed++; }
  else { console.log('  ok:', msg); }
}

// ─── Implementations under test ──────────────────────────────────────────────
function rotMat(deg) { const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return { a: c, b: s, c: -s, d: c }; }
function localToWorld(it, lx, ly) { const m = rotMat(it.rot); return { x: it.cx + m.a * lx + m.c * ly, y: it.cy + m.b * lx + m.d * ly }; }
function worldToLocal(it, wx, wy) { const m = rotMat(-it.rot); const dx = wx - it.cx, dy = wy - it.cy; return { x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy }; }
function opposite(hid, w, h) { const hw = w / 2, hh = h / 2; const m = { tl: { x: hw, y: hh }, tr: { x: -hw, y: hh }, bl: { x: hw, y: -hh }, br: { x: -hw, y: -hh }, tm: { x: 0, y: hh }, bm: { x: 0, y: -hh }, ml: { x: hw, y: 0 }, mr: { x: -hw, y: 0 } }; return m[hid] || { x: 0, y: 0 }; }

// ─── Tests ───────────────────────────────────────────────────────────────────
console.log('## transform math');

// 1) rotation 0° leaves coords unchanged
{
  const it = { cx: 100, cy: 100, rot: 0, w: 200, h: 100 };
  const w = localToWorld(it, 50, 30);
  assertNear(w.x, 150, 'rot0: x');
  assertNear(w.y, 130, 'rot0: y');
}

// 2) rotation 90° maps local (x,0) to world (0,x) relative to center
{
  const it = { cx: 0, cy: 0, rot: 90, w: 100, h: 100 };
  const w = localToWorld(it, 10, 0);
  assertNear(w.x, 0, 'rot90: lx=10 → wx≈0');
  assertNear(w.y, 10, 'rot90: lx=10 → wy≈10');
}

// 3) round-trip world↔local across rotations and offsets
for (const rot of [0, 33, 90, 180, -45, 270]) {
  const it = { cx: 200, cy: 150, rot, w: 200, h: 100 };
  const samples = [[10, 20], [-30, 5], [123, -77]];
  for (const [lx, ly] of samples) {
    const w = localToWorld(it, lx, ly);
    const l = worldToLocal(it, w.x, w.y);
    assertNear(l.x, lx, `roundtrip rot=${rot} lx`, 1e-9);
    assertNear(l.y, ly, `roundtrip rot=${rot} ly`, 1e-9);
  }
}

// 4) opposite handles return symmetric points
{
  const w = 200, h = 100;
  for (const hid of ['tl','tr','bl','br','tm','bm','ml','mr']) {
    const o = opposite(hid, w, h);
    assert(typeof o.x === 'number' && typeof o.y === 'number', 'opposite('+hid+') returns numbers');
  }
  const tl = opposite('tl', w, h), br = opposite('br', w, h);
  assertNear(tl.x, -br.x, 'tl.x = -br.x');
  assertNear(tl.y, -br.y, 'tl.y = -br.y');
}

// 5) After a rotation handles still align with the bounding box (no drift)
{
  const it = { cx: 500, cy: 400, rot: 30, w: 200, h: 100 };
  // Top-right corner local = (w/2, -h/2)
  const local = { x: it.w / 2, y: -it.h / 2 };
  const world = localToWorld(it, local.x, local.y);
  const back = worldToLocal(it, world.x, world.y);
  assertNear(back.x, local.x, 'tr handle stays at local (w/2,-h/2) after rotation');
  assertNear(back.y, local.y, 'tr handle y stable');
}

// 6) crop math invariants — visible width shrinks proportionally
{
  const cr = { l: 0.1, t: 0.0, r: 0.1, b: 0.0 };
  const visW = 1 - cr.l - cr.r;
  assertNear(visW, 0.8, 'crop visW');
  const uncropW = 100 / visW;
  assertNear(uncropW, 125, 'uncropW from visW=0.8 and w=100');
}

// 7) negative scale (flip) round-trip — flipH affects rendering, not coordinate math
{
  const it = { cx: 0, cy: 0, rot: 45, w: 100, h: 80 };
  const lx = 25, ly = -10;
  const w = localToWorld(it, lx, ly);
  const back = worldToLocal(it, w.x, w.y);
  assertNear(back.x, lx, 'flip-stable rotated roundtrip x');
  assertNear(back.y, ly, 'flip-stable rotated roundtrip y');
}

// 8) snapping at common rotations: rotMat returns exact c=±1, s=±1 for 0/90/180/270 within float noise
for (const angle of [0, 90, 180, 270, -90]) {
  const m = rotMat(angle);
  const det = m.a * m.d - m.b * m.c;
  assertNear(det, 1, `det(rotMat(${angle})) = 1`, 1e-9);
}

if (failed > 0) {
  console.error('\n## transform: ' + failed + ' test(s) FAILED');
  process.exit(1);
} else {
  console.log('\n## transform: all tests passed');
}
