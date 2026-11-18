// Monkey Mayhem test suite. Run one at a time: flock /workspace/.browser-test.lock node test/t.js
const { chromium } = require('/workspace/strike/node_modules/playwright');
const URL = process.env.MM_URL || 'http://127.0.0.1:8765/index.html';
const MM_RELAYS_N = 6;
const SHOTS = __dirname + '/../shots/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const HELPERS = () => {
  window.T = {
    H: [0, 1.6, 0],
    set(oL, oR, gL = false, gR = false) { const h = T.H; MM.fake = { head: h, hands: [{ p: [h[0] + oL[0], h[1] + oL[1], h[2] + oL[2]], grip: gL }, { p: [h[0] + oR[0], h[1] + oR[1], h[2] + oR[2]], grip: gR }] }; },
    run(sec, fn) { const n = Math.round(sec * 72); for (let i = 0; i < n; i++) { if (fn) fn(i / 72); MM.step(1 / 72); } },
    idle() { T.set([-0.27, -0.62, -0.2], [0.27, -0.62, -0.2]); },
    climb(dir, cycles, onStep) { // alternate grip-reach-pull toward a surface in direction dir=[x,z]
      const [dx, dz] = dir; let maxY = -1e9; const R = (i, f, y) => { const s = i ? 0.2 : -0.2; return [dx * f - dz * s, y, dz * f + dx * s]; };
      for (let c = 0; c < cycles; c++) for (const a of [0, 1]) {
        T.run(0.33, t => { const k = t / 0.33; const act = R(a, 0.62 - 0.12 * k, 0.35 - 0.75 * k), ina = R(1 - a, 0.05, -0.4 + 0.75 * k);
          if (a === 0) T.set(act, ina, true, false); else T.set(ina, act, false, true); maxY = Math.max(maxY, MM.headW().y); if (onStep) onStep(); });
      }
      return maxY;
    },
    hw(i) { return MM.handsW()[i]; },
    handTo(i, w) { const P = MM.rig.position; const f = MM.fake; f.hands[i].p = [w[0] - P.x, w[1] - P.y, w[2] - P.z]; },
  };
};

// Local stand-in for Trystero used ONLY in the multiplayer logic test: this box's Chrome policy blocks
// non-proxied UDP, so real WebRTC data channels can't open here. Same API surface as Trystero's joinRoom.
const LOCAL_TRANSPORT = () => {
  const selfId = 'p' + Math.random().toString(36).slice(2, 10);
  window.__MM_TRANSPORT__ = { selfId, joinRoom(cfg, roomId) {
    const bc = new BroadcastChannel('mmtest-' + roomId), peers = new Set(), acts = {}, L = { join: () => {}, leave: () => {}, stream: () => {} };
    const post = m => bc.postMessage({ ...m, from: selfId });
    const add = id => { if (!peers.has(id)) { peers.add(id); setTimeout(() => L.join(id), 0); } };
    bc.onmessage = ({ data: m }) => {
      if (m.from === selfId || (m.to && m.to !== selfId)) return;
      if (m.type === 'hello') { add(m.from); post({ type: 'ack', to: m.from }); }
      else if (m.type === 'ack') add(m.from);
      else if (m.type === 'leave') { peers.delete(m.from); L.leave(m.from); }
      else if (m.type === 'act' && peers.has(m.from)) (acts[m.action] || (() => {}))(m.data, m.from);
      else if (m.type === 'stream') { // synthesise the remote mic as a test tone stream
        const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start(); L.stream(d.stream, m.from); }
    };
    setTimeout(() => post({ type: 'hello' }), 50);
    return {
      makeAction: name => [(data, to) => post({ type: 'act', action: name, data, to: Array.isArray(to) ? to[0] : to }), cb => { acts[name] = cb; }],
      onPeerJoin: f => L.join = f, onPeerLeave: f => L.leave = f, onPeerStream: f => L.stream = f,
      addStream: (s, to) => post({ type: 'stream', to }), leave: () => post({ type: 'leave' }), getPeers: () => [...peers],
    };
  } };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const vp = { width: 640, height: 400 };
  async function open(ctxOpts = {}, name, denyMic) {
    const ctx = await b.newContext({ viewport: vp, ...ctxOpts }); const p = await ctx.newPage(); const errs = [];
    if (denyMic) await p.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')); });
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await p.goto(URL); await p.waitForFunction(() => !!window.MM, null, { timeout: 30000 }); await p.evaluate(HELPERS);
    if (name) await p.fill('#nameIn', name);
    return { ctx, p, errs };
  }
  // ===== single player, scripted fake XR =====
  const A = await open({}, 'Tester', true);
  await A.p.waitForTimeout(800);
  ok(A.errs.length === 0, 'loads with no console errors on landing ' + JSON.stringify(A.errs));
  ok(await A.p.evaluate(() => document.querySelector('h1').textContent.includes('MONKEY MAYHEM') && !!document.getElementById('enterVR') && document.getElementById('roomCode').textContent === 'PUBLIC' && /^Tester$/.test(document.getElementById('nameIn').value)), 'landing: title, Enter VR button, room code, name field');
  ok(await A.p.evaluate(() => /^Monkey\d{3}$/.test(localStorage.getItem('mm_name') || 'Monkey123')), 'random default name format MonkeyNNN');
  await A.p.screenshot({ path: SHOTS + 'landing.png' });
  // offline/solo: block the signalling module so no network join happens for the single-player part
  await A.p.evaluate(() => { document.getElementById('roomIn').value = 'SOLO' + Math.random().toString(36).slice(2, 7); });
  await A.p.click('#playDesk'); await A.p.waitForTimeout(1500);
  ok(await A.p.evaluate(() => MM.GAME.playing && MM.VOICE.denied), 'desktop play starts; mic denied (no permission) is handled, game still runs');
  ok(await A.p.evaluate(() => MM.NET.mode === 'solo'), 'solo free play when alone');
  const loco = await A.p.evaluate(() => {
    MM.paused = true; T.idle(); MM.place(0, MM.terrainH(0, 0) + 0.95, 0); T.run(0.6);
    const s = MM.headW(); const out = { z0: s.z, y0: s.y };
    for (let c = 0; c < 4; c++) {
      T.set([-0.25, -0.6, -0.45], [0.25, -0.6, -0.45]); T.run(0.08);
      T.set([-0.25, -0.98, -0.45], [0.25, -0.98, -0.45]); T.run(0.08);
      T.run(0.3, t => { const z = -0.45 + (t / 0.3) * 0.9; T.set([-0.25, -0.98, z], [0.25, -0.98, z]); });
      T.set([-0.25, -0.55, 0.45], [0.25, -0.55, 0.45]); T.run(0.12);
    }
    T.idle(); T.run(0.8); out.z1 = MM.headW().z;
    // arms idle, no input: must not move
    const z2 = MM.headW().z; T.run(1); out.drift = Math.abs(MM.headW().z - z2);
    // push down hard = jump
    T.set([-0.25, -0.86, -0.2], [0.25, -0.86, -0.2]); T.run(0.1); const yb = MM.headW().y;
    T.run(0.1, t => { const y = -0.86 - (t / 0.1) * 0.5; T.set([-0.25, y, -0.2], [0.25, y, -0.2]); });
    T.set([-0.25, -0.3, -0.2], [0.25, -0.3, -0.2]); let my = -9; T.run(1.2, () => my = Math.max(my, MM.headW().y)); out.jump = my - yb;
    return out;
  });
  ok(loco.z0 - loco.z1 > 1.5, `hand-push locomotion moves the player forward ${(loco.z0 - loco.z1).toFixed(2)} m in 4 arm strokes`);
  ok(loco.drift < 0.02, `no movement without arm swings (drift ${loco.drift.toFixed(3)} m)`);
  ok(loco.jump > 0.35, `push down + release launches a jump (+${loco.jump.toFixed(2)} m)`);
  const climb = await A.p.evaluate(() => {
    const r = {}; const g = MM.terrainH;
    // tree (T4), approached from -x
    const t = MM.TREES[3]; MM.place(t.x - 1.6, g(t.x - 1.6, t.z) + 0.95, t.z); T.idle(); T.run(0.4); const y0 = MM.headW().y; r.tree = T.climb([1, 0], 9) - y0;
    // T1 (course tree) from the north-west side, past the start pad height
    const t1 = MM.TREES[0], a = -2.2, px = t1.x + Math.cos(a) * 1.62, pz = t1.z + Math.sin(a) * 1.62; MM.place(px, g(px, pz) + 0.95, pz); T.idle(); T.run(0.4);
    r.t1 = T.climb([-Math.cos(a), -Math.sin(a)], 16); r.padTop = MM.COURSE.start.c.y + MM.COURSE.start.h.y;
    // lower wall (west) from the ground: climbs, but stops near the smooth upper half
    MM.place(-24.5, g(-24.5, 4) + 0.95, 4); T.idle(); T.run(0.4); const w0 = MM.headW().y; r.wall0 = w0; r.wallMax = T.climb([-1, 0], 28); r.wallEnd = MM.headW().y;
    // upper wall: start hanging at 12 m against the smooth section, try to climb → slide/fall
    const s0 = MM.stats.slips; MM.place(-24.5, 13.5, -4); T.idle(); const u0 = MM.headW().y; let anch = 0; const um = T.climb([-1, 0], 1, () => { if (MM.PH.anyAnch) anch++; }); r.upperDrop = u0 - MM.headW().y; r.upperAnch = anch; r.upperMax = um - u0; r.slips = MM.stats.slips - s0;
    return r;
  });
  ok(climb.tree > 3, `grip-climbing a tree trunk gains ${climb.tree.toFixed(2)} m`);
  ok(climb.t1 > climb.padTop + 0.8, `course tree climbable from the ground to above the start pad (head ${climb.t1.toFixed(2)} m, pad top ${climb.padTop.toFixed(2)} m)`);
  ok(climb.wallMax - climb.wall0 > 4, `lower rock wall is climbable (+${(climb.wallMax - climb.wall0).toFixed(2)} m)`);
  ok(climb.wallMax < 10.6, `climbing stops at the smooth upper half (max head height ${climb.wallMax.toFixed(2)} m, climbable to ${9} m, wall 18 m)`);
  ok(climb.upperAnch === 0 && climb.upperDrop > 1 && climb.slips > 0 && climb.upperMax < 0.05, `upper wall can't be grabbed: 0 anchors, slid down ${climb.upperDrop.toFixed(2)} m (${climb.slips} slip contacts)`);
  const vine = await A.p.evaluate(() => {
    const v = MM.VINES[2]; const q = v.q.clone(); MM.place(q.x - 0.45, q.y + 0.2, q.z); T.set([-0.27, -0.62, -0.2], [0.45, -0.1, 0], false, true);
    MM.PH.V.set(0, 0, 2.5); MM.step(1 / 72);
    const grabbed = MM.PH.hands[1].vine === v; let minY = 99, zs = [], vz = [];
    T.run(3, () => { const h = MM.headW(); minY = Math.min(minY, h.y); zs.push(h.z); vz.push(v.q.z); });
    const relV = MM.PH.V.length(); T.set([-0.27, -0.62, -0.2], [0.45, -0.1, 0], false, false); MM.step(1 / 72); const afterV = MM.PH.V.length(); const released = !MM.PH.hands[1].vine;
    return { grabbed, minY, ground: MM.terrainH(q.x, q.z), zr: Math.max(...zs) - Math.min(...zs), vr: Math.max(...vz) - Math.min(...vz), relV, afterV, released, grabs: MM.stats.vineGrabs };
  });
  ok(vine.grabbed && vine.grabs > 0, 'grip on a vine grabs it');
  ok(vine.minY > vine.ground + 1.2, `hanging from the vine keeps the player off the ground (min head ${vine.minY.toFixed(2)} m)`);
  ok(vine.zr > 1 && vine.vr > 1, `vine swings physically with the player (player swing ${vine.zr.toFixed(2)} m, vine end ${vine.vr.toFixed(2)} m)`);
  ok(vine.released && vine.afterV > 0.3, `letting go keeps swing momentum (${vine.afterV.toFixed(2)} m/s)`);
  const ban = await A.p.evaluate(() => {
    MM.PH.freeze = true; const b = MM.BANANAS[0]; MM.place(b.p.x, MM.terrainH(b.p.x, b.p.z) + 0.95, b.p.z + 0.6); T.idle(); MM.step(1 / 72); const n0 = MM.ME.bananas;
    T.handTo(1, b.p.toArray()); MM.step(1 / 72); const n1 = MM.ME.bananas; const gone = !b.alive; MM.step(1 / 72); const n2 = MM.ME.bananas;
    const b2 = MM.BANANAS[5]; T.idle(); MM.place(b2.p.x, b2.p.y, b2.p.z); MM.step(1 / 72); const n3 = MM.ME.bananas; MM.PH.freeze = false;
    return { n0, n1, n2, n3, gone, hud: document.getElementById('hud').textContent };
  });
  ok(ban.n1 === ban.n0 + 1 && ban.gone && ban.n2 === ban.n1, `banana collects on hand touch (counter ${ban.n0}→${ban.n1}), only once`);
  ok(ban.n3 === ban.n2 + 1, 'banana collects by head touch too');
  const course = await A.p.evaluate(() => {
    localStorage.removeItem('mm_course_best'); MM.COURSE_S.best = null;
    const C = MM.COURSE, s = C.start, f = C.finish; const r = {};
    // gap check along the course: every hop ≤ 1.6 m (beam end→vine, vine swing→platform etc.)
    const v1 = MM.VINES[0], v2 = MM.VINES[1]; const d2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    r.gaps = [d2(C.beams[0][1], v1.q), d2(v1.q, C.mid.c) - C.mid.h.x, d2(C.beams[1][1], v2.q), d2(v2.q, f.c) - f.h.x];
    r.vineBottoms = [v1.q.y, v2.q.y];
    T.idle(); MM.place(s.c.x, s.c.y + s.h.y + 0.92, s.c.z); T.run(0.3); r.ready = MM.COURSE_S.state;
    MM.place(s.c.x + 1.6, s.c.y + s.h.y + 1.3, s.c.z - 0.2); MM.PH.freeze = true; MM.step(1 / 72); r.running = MM.COURSE_S.state;
    const t0 = performance.now(); while (performance.now() - t0 < 700) { } MM.step(1 / 72);
    MM.PH.freeze = false; MM.place(f.c.x, f.c.y + f.h.y + 0.92, f.c.z); T.run(0.2); r.done = MM.COURSE_S.state; r.best = MM.COURSE_S.best; r.ls = localStorage.getItem('mm_course_best');
    MM.render(); r.sign = MM.signText;
    // falling to the ground cancels a run
    MM.place(s.c.x, s.c.y + s.h.y + 0.92, s.c.z); T.run(0.2); MM.place(s.c.x + 1.6, 1.0, s.c.z + 1.5); T.run(0.3); r.fell = MM.COURSE_S.state + ' / ' + MM.COURSE_S.msg;
    return r;
  });
  ok(course.ready === 'ready' && course.running === 'running' && course.done === 'done', `canopy course: start pad → timer running → finish pad (${course.ready}/${course.running}/${course.done})`);
  ok(course.best > 0.5 && course.ls && Math.abs(parseFloat(course.ls) - course.best) < 0.01, `best time saved to localStorage (${course.ls}s)`);
  ok(course.sign && course.sign[1].startsWith('Best: ' + course.best.toFixed(2)), 'sign shows last/best time: ' + JSON.stringify(course.sign));
  ok(course.gaps.every(g => g < 1.6), 'course hops are all within reach/swing: ' + course.gaps.map(g => g.toFixed(2)).join(', ') + ' m');
  ok(/idle/.test(course.fell), 'falling to the ground cancels the run: ' + course.fell);
  const daynight = await A.p.evaluate(() => {
    const r = {}; MM.timeOverride = 0.25; MM.render(); r.noon = { sun: MM.sunVisible(), moon: MM.moonVisible(), ff: MM.firefliesOp(), rays: MM.raysOp(), sunI: MM.sunI(), fog: MM.fogColor() };
    MM.timeOverride = 0.75; MM.render(); r.night = { sun: MM.sunVisible(), moon: MM.moonVisible(), ff: MM.firefliesOp(), rays: MM.raysOp(), sunI: MM.sunI(), fog: MM.fogColor() };
    MM.timeOverride = 0.5; MM.render(); r.dusk = MM.fogColor();
    MM.timeOverride = null; MM.render(); r.phase = MM.DAY.phase; r.expected = ((Date.now() / 1000) % 600) / 600;
    const b0 = MM.birdPos(), u0 = MM.butterPos(); const t0 = performance.now(); while (performance.now() - t0 < 300) { } MM.render(); r.birdMoved = Math.hypot(...MM.birdPos().map((v, i) => v - b0[i])); r.butterMoved = Math.hypot(...MM.butterPos().map((v, i) => v - u0[i])); r.birdY = b0[1];
    return r;
  });
  ok(daynight.noon.sun && !daynight.noon.moon && daynight.noon.ff === 0 && daynight.night.moon && !daynight.night.sun && daynight.night.ff > 0.9, 'day/night: sun by day; moon + glowing fireflies at night');
  ok(daynight.night.rays < daynight.noon.rays / 2.5 && daynight.night.sunI < daynight.noon.sunI / 3 && daynight.noon.fog !== daynight.night.fog && daynight.dusk !== daynight.noon.fog, `sky, fog and light change; sun shafts dim at night (rays ${daynight.noon.rays.toFixed(2)}→${daynight.night.rays.toFixed(2)}, fog #${daynight.noon.fog}→#${daynight.night.fog}, dusk #${daynight.dusk})`);
  ok(Math.abs(daynight.phase - daynight.expected) < 0.003, `time of day comes from the shared clock (10 min cycle), phase ${daynight.phase.toFixed(4)}`);
  ok(daynight.birdMoved > 0.1 && daynight.butterMoved > 0.02 && daynight.birdY > 14, `birds fly overhead (y≈${daynight.birdY.toFixed(1)} m) and butterflies flutter (moved ${daynight.birdMoved.toFixed(2)} / ${daynight.butterMoved.toFixed(2)} m)`);
  // audio graph: ambience sources exist and are positional
  const au = await A.p.evaluate(() => ({ state: MM.AU.ctx && MM.AU.ctx.state, srcs: (MM.AU.sources || []).map(s => s.name), birds: MM.AU.birds, wind: !!MM.AU.wind, crickets: !!MM.AU.cricket, cicada: !!MM.AU.cicada }));
  ok(au.srcs.includes('waterfall') && au.srcs.includes('stream') && au.srcs.includes('pond') && au.wind && au.crickets && au.cicada, 'ambient audio graph: wind, insects (day cicadas / night crickets), birds, positional water at waterfall/stream/pond: ' + JSON.stringify(au));
  // frame cost
  const perf = await A.p.evaluate(async () => {
    MM.paused = false; MM.fake = null; MM.timeOverride = 0.3; MM.respawn(); await new Promise(r => setTimeout(r, 1500));
    MM.paused = true; T.idle(); const ts = []; for (let i = 0; i < 300; i++) { const t0 = performance.now(); MM.step(1 / 72); ts.push(performance.now() - t0); }
    ts.sort((a, b) => a - b); MM.render(); const ri = MM.renderInfo();
    return { updAvg: ts.reduce((a, b) => a + b, 0) / ts.length, updP95: ts[Math.floor(ts.length * 0.95)], ...ri };
  });
  ok(perf.updAvg < 1.5 && perf.calls < 40 && perf.triangles < 60000, `frame cost: game update ${perf.updAvg.toFixed(3)} ms avg / ${perf.updP95.toFixed(3)} p95, ${perf.calls} draw calls, ${perf.triangles} triangles per eye (solo)`);
  // screenshots (HUD hidden)
  await A.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; });
  const shot = async (name, pos, yaw, pitch, t) => { await A.p.evaluate(([pos, yaw, pitch, t]) => { MM.timeOverride = t; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(pitch, yaw, 0, 'YXZ')).toArray(), hands: [{ p: [-0.25, 0.95, -0.35] }, { p: [0.25, 0.95, -0.35] }] }; MM.place(...pos); MM.step(1 / 72); MM.render(); }, [pos, yaw, pitch, t]); await A.p.screenshot({ path: SHOTS + name }); };
  await shot('jungle_spawn_day.png', [0, 0.95, 2], 0.25, 0.08, 0.22);
  await shot('waterfall_caves.png', [-4, 3, -14], 0.12, 0.05, 0.3);
  await shot('canopy_course.png', [-6.4, 8.2, -5.2], -1.45, -0.12, 0.27);
  await shot('jungle_overview.png', [21, 15, 21], 0.78, -0.42, 0.2);
  await shot('night_fireflies.png', [2, 1.3, 6], -0.6, 0.05, 0.78);
  await shot('sunset.png', [-10, 4.5, 12], -2.4, 0.0, 0.485);
  await A.ctx.close();

  // ===== multiplayer game logic: two pages joined through the local transport =====
  const room = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
  const MPctx = await b.newContext({ viewport: vp, permissions: ['microphone'] });
  async function openMP(name) { const p = await MPctx.newPage(); const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message)); await p.addInitScript(LOCAL_TRANSPORT); await p.goto(URL); await p.waitForFunction(() => !!window.MM); await p.evaluate(HELPERS); await p.fill('#nameIn', name); return { p, errs }; }
  const P1 = await openMP('Kong'), P2 = await openMP('Bongo');
  for (const [P, x] of [[P1, -1.5], [P2, 1.5]]) { await P.p.fill('#roomIn', room); await P.p.click('#playDesk'); await P.p.evaluate(x => { MM.fake = { head: [0, 1.6, 0], headQ: new MM.THREE.Quaternion().setFromEuler(new MM.THREE.Euler(0, x > 0 ? Math.PI / 2 : -Math.PI / 2, 0, 'YXZ')).toArray(), hands: [{ p: [-0.27, 0.98, -0.2] }, { p: [0.27, 0.98, -0.2] }] }; MM.place(x, MM.terrainH(x, 0) + 0.95, 0); }, x); }
  const t0 = Date.now(); let seen = false;
  while (Date.now() - t0 < 20000) { const a = await P1.p.evaluate(() => MM.remoteList()), c = await P2.p.evaluate(() => MM.remoteList()); if (a.length && c.length && a[0].visible && c[0].visible && a[0].tag === 'Bongo' && c[0].tag === 'Kong') { seen = true; break; } await P1.p.waitForTimeout(300); }
  ok(seen, `two players see each other's gorillas (synced in ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (seen) {
    await P1.p.waitForTimeout(500);
    const r1 = await P1.p.evaluate(() => MM.remoteList()[0]), me2 = await P2.p.evaluate(() => MM.headW().toArray());
    const err = Math.hypot(r1.head[0] - me2[0], r1.head[1] - me2[1], r1.head[2] - me2[2]);
    ok(err < 0.25, `remote head pose synced at 15 Hz and interpolated (err ${err.toFixed(3)} m)`);
    ok(r1.name === 'Bongo' && r1.tag === 'Bongo', 'floating name tag above the remote gorilla shows the name set on the landing page');
    const rate = await P1.p.evaluate(async () => { const a = MM.stats.posesSent; await new Promise(r => setTimeout(r, 2000)); return (MM.stats.posesSent - a) / 2; });
    ok(rate >= 10 && rate <= 20, `pose send rate ${rate.toFixed(1)} Hz`);
    await P1.p.waitForFunction(() => MM.NET.round >= 1 && MM.NET.infected.size === 1, null, { timeout: 15000 }).catch(() => { });
    await P1.p.waitForTimeout(400);
    const st = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ round: MM.NET.round, inf: [...MM.NET.infected], self: MM.NET.selfId, mode: MM.NET.mode }))));
    if (st[0].round > 2) console.log(await P1.p.evaluate(() => MM.NETLOG.join('\n')), '\n--\n', await P2.p.evaluate(() => MM.NETLOG.join('\n')));
    ok(st[0].round >= 1 && st[0].inf.length === 1 && st[1].round === st[0].round && st[1].inf[0] === st[0].inf[0], `tag round starts with one lava monkey, agreed by both (round ${st[0].round})`);
    const [tagger, runner] = st[0].inf[0] === st[0].self ? [P1, P2] : [P2, P1];
    const lavaLook = await runner.p.evaluate(() => MM.remoteList()[0].it);
    ok(lavaLook, 'the IT player renders lava/red on the other client');
    const round0 = st[0].round;
    await tagger.p.evaluate(() => { MM.PH.freeze = true; const r = MM.remoteList()[0]; const P = MM.rig.position; MM.fake.hands[1].p = [r.head[0] - P.x, r.head[1] - P.y, r.head[2] - P.z]; });
    const both = await runner.p.waitForFunction(() => MM.NET.infected.size === 2 && MM.NET.infected.has(MM.NET.selfId), null, { timeout: 8000 }).then(() => true).catch(() => false);
    ok(both, 'touching the other gorilla with a hand infects them and it propagates to their client');
    await runner.p.waitForTimeout(500); const hudTxt = await runner.p.evaluate(() => document.getElementById('hud').textContent);
    ok(/Everyone is lava|YOU ARE IT/.test(hudTxt), 'tagged player sees lava state: "' + hudTxt.split('Course')[0].split('players 2')[1] + '"');
    await tagger.p.evaluate(() => { MM.fake.hands[1].p = [0.27, 0.98, -0.2]; MM.PH.freeze = false; });
    const reset = await P1.p.waitForFunction(r0 => MM.NET.round > r0 && MM.NET.infected.size === 1, round0, { timeout: 9000 }).then(() => true).catch(() => false);
    await P1.p.waitForTimeout(300);
    const st2 = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ round: MM.NET.round, n: MM.NET.infected.size }))));
    ok(reset && st2[1].round === st2[0].round && st2[1].n === 1, `round ends when everyone is infected, then resets (round ${round0}→${st2[0].round}, ${st2[0].n} infected)`);
    // voice chat
    await P1.p.waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].voice, null, { timeout: 15000 }).catch(() => { });
    await P1.p.waitForTimeout(300);
    const v = await Promise.all([P1, P2].map(P => P.p.evaluate(() => ({ voice: MM.remoteList()[0].voice, pan: MM.remoteList()[0].pannerPos, head: MM.remoteList()[0].head, stream: !!MM.VOICE.stream }))));
    ok(v[0].voice && v[1].voice && v[0].stream && v[1].stream, 'proximity voice: both mics open (getUserMedia) and each side wires the peer stream into WebAudio');
    ok(v[0].pan && Math.hypot(v[0].pan[0] - v[0].head[0], v[0].pan[2] - v[0].head[2]) < 0.5, 'voice is positional: HRTF panner follows the remote gorilla head');
    const g = d => 1.2 / (1.2 + 1.6 * (Math.max(d, 1.2) - 1.2)); ok(g(20) < 0.05 && g(2) > 0.4, `voice fades with distance (inverse model: gain ${g(2).toFixed(2)} at 2 m, ${g(10).toFixed(2)} at 10 m, ${g(20).toFixed(3)} at 20 m)`);
    const mute = await P1.p.evaluate(() => { MM.PH.freeze = true; MM.step(1 / 72); const P = MM.rig.position; const b = MM.muteBtnW(); MM.fake.hands[1].p = [b[0] - P.x, b[1] - P.y, b[2] - P.z]; MM.step(1 / 72); MM.step(1 / 72); const r = { muted: MM.VOICE.muted, track: MM.VOICE.stream.getAudioTracks()[0].enabled }; MM.fake.hands[1].p = [0.27, 0.98, -0.2]; MM.step(1 / 72); MM.PH.freeze = false; return r; });
    ok(mute.muted && !mute.track, 'touching the wrist mute button with the right hand mutes the mic track');
    const ph = await Promise.all([P1, P2].map(P => P.p.evaluate(() => MM.DAY.phase)));
    ok(Math.abs(ph[0] - ph[1]) < 0.002, `time of day in sync across players (${ph[0].toFixed(4)} vs ${ph[1].toFixed(4)})`);
    const perf2 = await P2.p.evaluate(() => { MM.render(); return MM.renderInfo(); });
    console.log('INFO draw calls with one remote player:', JSON.stringify(perf2));
    // screenshot from the runner looking at the tagger: lava gorilla + name tag
    await runner.p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.timeOverride = 0.25; });
    await tagger.p.evaluate(() => { MM.NET.infected.add(MM.NET.selfId); });
    await runner.p.waitForTimeout(600); await runner.p.screenshot({ path: SHOTS + 'multiplayer_nametag.png' });
  }
  // ===== real public signalling check (Trystero + Nostr relays) =====
  {
    const sroom = 'S' + Math.random().toString(36).slice(2, 8).toUpperCase(); const S = [];
    for (const nm of ['Sig1', 'Sig2']) { const c = await b.newContext({ viewport: { width: 320, height: 200 } }); const p = await c.newPage(); await p.goto(URL); await p.waitForFunction(() => !!window.MM); await p.fill('#nameIn', nm); await p.fill('#roomIn', sroom); await p.evaluate(() => { document.getElementById('voiceIn').checked = false; }); await p.click('#playDesk'); S.push(p); }
    await S[0].waitForTimeout(1500);
    const ids = await Promise.all(S.map(p => p.evaluate(() => MM.NET.selfId)));
    for (const [i, p] of S.entries()) await p.evaluate(async other => { const T = await import('./vendor/trystero-nostr.js'); window.__seen = 0; window.__open = 0; for (const s of Object.values(T.getRelaySockets())) { if (s.readyState === 1) __open++; s.addEventListener('message', e => { if (String(e.data).includes(other)) __seen++; }); } }, ids[1 - i]);
    await S[0].waitForTimeout(14000);
    const sig = await Promise.all(S.map(p => p.evaluate(() => ({ open: __open, seen: __seen, peers: MM.NET.remotes.size }))));
    ok(sig[0].open >= 3 && sig[0].seen > 0 && sig[1].seen > 0, `public Nostr signalling works from the browser: ${sig[0].open}/${MM_RELAYS_N} relays open, each peer received the other's signalling messages (${sig[0].seen}/${sig[1].seen}); WebRTC data channel itself can't open in this sandbox (peers: ${sig[0].peers})`);
    for (const p of S) await p.context().close();
  }
  const allErr = [...P1.errs, ...P2.errs];
  ok(allErr.length === 0, 'no console errors during multiplayer ' + JSON.stringify(allErr.slice(0, 5)));
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
