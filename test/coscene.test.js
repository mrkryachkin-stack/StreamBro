// Smoke tests for the CoScene engine (renderer/js/coscene.js).
// Loads the renderer module in a tiny Node-vm sandbox (no JSDOM) and checks
// the protocol, throttling, LWW, and msid binding without spinning up Electron.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failed = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); failed++; } else { console.log('  ok:', msg); }
}
function assertEq(a, b, msg) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { console.error('FAIL:', msg, 'expected', b, 'got', a); failed++; }
  else { console.log('  ok:', msg); }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Mini-DOM / window shim ─────────────────────────────────────────────────
function makeFakeChannel() {
  const ch = {
    readyState: 'open',
    sent: [],
    listeners: {},
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    removeEventListener(name, fn) {
      if (!this.listeners[name]) return;
      this.listeners[name] = this.listeners[name].filter(f => f !== fn);
    },
    fire(name, ev) { (this.listeners[name] || []).forEach(f => f(ev)); },
    send(payload) { this.sent.push(payload); },
    close() { this.readyState = 'closed'; this.fire('close'); },
  };
  return ch;
}

function makeSandbox() {
  const window = {};
  const sandbox = {
    window,
    setTimeout, clearTimeout,
    crypto: {
      randomUUID: () => 'gid-' + (Math.random().toString(36).slice(2, 10)),
    },
    JSON, console,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'js', 'coscene.js'), 'utf8');
  vm.runInContext(code, sandbox);
  return sandbox;
}

(async () => {
  console.log('## CoScene protocol & engine');

  // 1) Module exports
  {
    const sb = makeSandbox();
    assert(typeof sb.window.CoScene === 'function', 'CoScene class exposed');
    assert(typeof sb.window.CoSceneHelpers.newGid === 'function', 'newGid helper exposed');
    const a = sb.window.CoSceneHelpers.newGid();
    const b = sb.window.CoSceneHelpers.newGid();
    assert(a !== b, 'newGid returns unique ids');
  }

  // 2) Snapshot is sent automatically once a channel opens
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    co.setHandlers({ getSnapshot: () => ({ srcs:[{gid:'a',type:'mic',name:'m'}], items:[{sid:'a',cx:1,cy:2}], order:['a'] }) });
    const dc = makeFakeChannel();
    co.attachChannel('peerB', dc);
    await sleep(280);
    assert(dc.sent.length === 1, 'one snapshot sent on open (got ' + dc.sent.length + ')');
    const msg = JSON.parse(dc.sent[0]);
    assertEq(msg.op, 'snapshot', 'msg.op == snapshot');
    assert(Array.isArray(msg.srcs) && msg.srcs.length === 1, 'snapshot carries 1 src');
    assert(Array.isArray(msg.items) && msg.items.length === 1, 'snapshot carries 1 item');
  }

  // 3) item.upsert is throttled (≈30 Hz) — many calls coalesce into ≤3 messages within 50ms
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    co.setHandlers({ getSnapshot: () => ({ srcs:[], items:[], order:[] }) });
    const dc = makeFakeChannel();
    co.attachChannel('peerB', dc);
    await sleep(280);
    dc.sent.length = 0;
    for (let i = 0; i < 50; i++) co.queueItemUpsert({ sid:'i1', cx:i, cy:i, w:10, h:10 });
    await sleep(80);
    const upserts = dc.sent.map(s => JSON.parse(s)).filter(m => m.op === 'item.upsert');
    assert(upserts.length <= 3 && upserts.length >= 1, 'throttled to 1-3 messages for 50 calls (got ' + upserts.length + ')');
    const last = upserts[upserts.length - 1];
    assertEq(last.it.sid, 'i1', 'last upsert sid is i1');
    assert(last.it.cx === 49, 'final cx (49) propagated');
  }

  // 4) flushItem sends synchronously, bypassing throttle
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    co.setHandlers({ getSnapshot: () => ({ srcs:[], items:[], order:[] }) });
    const dc = makeFakeChannel();
    co.attachChannel('p', dc);
    await sleep(280);
    dc.sent.length = 0;
    co.queueItemUpsert({ sid:'i1', cx:0, cy:0 });
    co.flushItem('i1');
    const upserts = dc.sent.map(s => JSON.parse(s)).filter(m => m.op === 'item.upsert');
    assert(upserts.length === 1, 'flushItem sends synchronously (got ' + upserts.length + ')');
    assertEq(upserts[0].it.sid, 'i1', 'flushed sid is correct');
  }

  // 5) LWW: older ts is dropped on the receiver side
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    const calls = [];
    co.setHandlers({
      getSnapshot: () => ({ srcs:[], items:[], order:[] }),
      applyItemUpsert: it => calls.push(it),
    });
    const dc = makeFakeChannel();
    co.attachChannel('p', dc);
    dc.fire('message', { data: JSON.stringify({ op:'item.upsert', it:{sid:'x',cx:5}, ts: 1000 }) });
    dc.fire('message', { data: JSON.stringify({ op:'item.upsert', it:{sid:'x',cx:1}, ts:  500 }) });
    dc.fire('message', { data: JSON.stringify({ op:'item.upsert', it:{sid:'x',cx:9}, ts: 2000 }) });
    assert(calls.length === 2, 'older ts dropped (' + calls.length + ' applies)');
    assertEq(calls[0].cx, 5, 'first apply: cx=5');
    assertEq(calls[1].cx, 9, 'last apply: cx=9');
  }

  // 6) msid → gid binding works in either order
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    let added = null;
    co.setHandlers({
      getSnapshot: () => ({ srcs:[], items:[], order:[] }),
      applySrcAdd: (meta, pending, fromPid) => { added = { meta, pending, fromPid }; },
    });

    // Order A: src.add arrives FIRST, then track event arrives later
    added = null;
    co._dispatch('peer1', { op:'src.add', src:{ gid:'g1', type:'camera', name:'c', msid:'streamABC' }, ts: 100 });
    assert(added && added.meta.gid === 'g1', 'src.add applied (track may be pending)');
    assert(!added.pending, 'no pending track at this point');
    const r1 = co.bindIncomingStream({ id: 'streamABC' }, 'video', 'peer1');
    assert(r1 && r1.srcMeta && r1.srcMeta.gid === 'g1', 'arriving track resolves stashed src.add (returns meta)');

    // Order B: track FIRST, then src.add
    added = null;
    const r2 = co.bindIncomingStream({ id: 'streamXYZ' }, 'audio', 'peer2');
    assert(r2 === null, 'track without prior src.add is parked');
    co._dispatch('peer2', { op:'src.add', src:{ gid:'g2', type:'mic', name:'m', msid:'streamXYZ' }, ts: 200 });
    assert(added && added.meta.gid === 'g2', 'src.add fired after track was parked');
    assert(added.pending && Array.isArray(added.pending.streams) && added.pending.streams.length === 1, 'pending streams handed to applySrcAdd');
    assertEq(added.pending.streams[0].kind, 'audio', 'pending stream kind preserved');
  }

  // 7) request-snapshot → triggers snapshot reply
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    co.setHandlers({ getSnapshot: () => ({ srcs:[{gid:'a'}], items:[], order:['a'] }) });
    const dc = makeFakeChannel();
    co.attachChannel('p', dc);
    await sleep(280);
    dc.sent.length = 0;
    dc.fire('message', { data: JSON.stringify({ op:'request-snapshot' }) });
    const sent = dc.sent.map(s => JSON.parse(s));
    assert(sent.length === 1 && sent[0].op === 'snapshot', 'request-snapshot → snapshot');
    assertEq(sent[0].srcs[0].gid, 'a', 'snapshot includes our srcs');
  }

  // 8) applyingRemote() guard suppresses re-broadcast (no echo)
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    let outApplied = null;
    co.setHandlers({
      getSnapshot: () => ({ srcs:[], items:[], order:[] }),
      applyItemUpsert: it => { outApplied = it; co.queueItemUpsert(it); },
    });
    const dc = makeFakeChannel();
    co.attachChannel('peerB', dc);
    await sleep(280);
    dc.sent.length = 0;
    dc.fire('message', { data: JSON.stringify({ op:'item.upsert', it:{sid:'z',cx:7}, ts: Date.now() }) });
    await sleep(60);
    const upserts = dc.sent.map(s => JSON.parse(s)).filter(m => m.op === 'item.upsert');
    assert(upserts.length === 0, 'no echo on remote-applied op (got ' + upserts.length + ')');
    assertEq(outApplied.cx, 7, 'remote op was applied');
  }

  // 9) detachPeer cleans channel state
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    co.setHandlers({ getSnapshot: () => ({ srcs:[], items:[], order:[] }) });
    const dc = makeFakeChannel();
    co.attachChannel('peerB', dc);
    await sleep(280);
    co.detachPeer('peerB');
    dc.sent.length = 0;
    co.broadcast({ op:'cursor', x:1, y:2, ts:1 });
    assert(dc.sent.length === 0, 'after detach, broadcast() doesn\'t reach the channel');
  }

  // 10) src.update preserves LWW
  {
    const sb = makeSandbox();
    const co = new sb.window.CoScene({});
    const upd = [];
    co.setHandlers({
      getSnapshot: () => ({ srcs:[], items:[], order:[] }),
      applySrcUpdate: meta => upd.push(meta),
    });
    const dc = makeFakeChannel();
    co.attachChannel('p', dc);
    dc.fire('message', { data: JSON.stringify({ op:'src.update', src:{gid:'a',vol:0.5}, ts: 100 }) });
    dc.fire('message', { data: JSON.stringify({ op:'src.update', src:{gid:'a',vol:0.1}, ts:  50 }) });
    dc.fire('message', { data: JSON.stringify({ op:'src.update', src:{gid:'a',vol:1.0}, ts: 300 }) });
    assert(upd.length === 2, 'older src.update dropped');
    assertEq(upd[0].vol, 0.5, 'first update vol=0.5');
    assertEq(upd[1].vol, 1.0, 'second update vol=1.0');
  }

  console.log(failed === 0 ? '\nAll CoScene tests PASSED' : '\n' + failed + ' test(s) FAILED');
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
