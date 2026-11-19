// Cave TEST build suite (/cave-test/). Run alone: flock /workspace/.browser-test.lock node test/cave.js
const { chromium } = require('/workspace/strike/node_modules/playwright');
const fs = require('fs');
const URL = process.env.MM_CAVE_URL || 'http://127.0.0.1:8765/cave-test/index.html';
const SHOTS = __dirname + '/../shots/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const tsrc = fs.readFileSync(__dirname + '/t.js', 'utf8');
const LOCAL_TRANSPORT = eval('(' + tsrc.split('const LOCAL_TRANSPORT = ')[1].split('\n};\n')[0] + '\n})');
const HELPERS = () => {
  const T3 = MM.THREE;
  window.C = {
    F: MM.CX.F, yaw: 0,
    q(yaw, pitch = 0) { return new T3.Quaternion().setFromEuler(new T3.Euler(pitch, yaw, 0, 'YXZ')).toArray(); },
    rot(o, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] * c + o[2] * s, o[1], -o[0] * s + o[2] * c]; },
    idle(yaw = C.yaw, pitch = 0) { C.yaw = yaw; MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: [{ p: C.rot([-0.27, 0.98, -0.2], yaw) }, { p: C.rot([0.27, 0.98, -0.2], yaw) }], a: false }; },
    run(sec, fn) { const n = Math.round(sec * 72); for (let i = 0; i < n; i++) { if (fn && fn(i / 72) === false) return false; MM.step(1 / 72); } return true; },
    spawns() { return MM.stats.spawns || 0; },
    stand(x, z, yaw = 0, y = C.F) { C.idle(yaw); MM.place(x, y + 1.3, z); C.run(0.8); },
    head() { return MM.headW(); },
    jump(hold, fn) { MM.fake.a = true; C.run(hold, fn); MM.fake.a = false; },
    // run until landed (grounded, not moving) or respawned
    land(maxSec = 3.5) { const s0 = C.spawns(); let t = 0, still = 0; while (t < maxSec) { MM.step(1 / 72); t += 1 / 72; if (C.spawns() > s0) return { spawned: true, t }; if (MM.PH.grounded && MM.PH.V.length() < 0.05) { if (++still > 20) break; } else still = 0; } const h = C.head(); return { spawned: false, t, x: h.x, y: h.y, z: h.z }; },
    handTo(i, w) { const P = MM.rig.position; MM.fake.hands[i].p = [w[0] - P.x, w[1] - P.y + MM.HAND_DROP, w[2] - P.z]; },
    vine() { return MM.VINES.find(v => v.trig); },
    resetVine() { const v = C.vine(); v.q.copy(v.top).y -= v.L; v.qp.copy(v.q); },
    vinePt(y) { const v = C.vine(), t = Math.min(1, Math.max(0, (v.top.y - y) / Math.max(0.01, v.top.y - v.q.y))); return v.top.clone().lerp(v.q, t).toArray(); },
  };
};
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/google/chrome/chrome', headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const vp = { width: 640, height: 400 };
  const ctx = await b.newContext({ viewport: vp }); const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.goto(URL); await p.waitForFunction(() => !!window.MM, null, { timeout: 30000 }); await p.evaluate(HELPERS);
  ok(await p.evaluate(() => document.title.includes('CAVE TEST') && document.querySelector('.sub').textContent.includes('CAVE TEST') && MM.APPID === 'optimusgrok-monkey-mayhem-cavetest-v1'), 'test build: own title/banner and its own multiplayer namespace (appId ' + await p.evaluate(() => MM.APPID) + ')');
  await p.evaluate(() => { document.getElementById('roomIn').value = 'CAVE' + Math.random().toString(36).slice(2, 6); document.getElementById('voiceIn').checked = false; });
  await p.click('#playDesk'); await p.waitForTimeout(600);
  await p.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('hint').style.display = 'none'; MM.paused = true; MM.timeOverride = 0.25; });
  ok(errs.length === 0, 'loads and starts with no console errors ' + JSON.stringify(errs.slice(0, 3)));
  // ---------- 1. jump charge ----------
  const ch = await p.evaluate(() => {
    const r = {}, J = MM.JUMP; r.curve = [0, 0.5, 0.9, 1].map(c => { const s = J.speed(c); return [c, +s.h.toFixed(2), +s.u.toFixed(2)]; });
    C.stand(0, 4, 0, MM.terrainH(0, 4)); const y0 = C.head().y; MM.fake.a = true;
    const samp = []; C.run(4.0, t => { if ([0.5, 1.5, 2.9, 3.9].some(s => Math.abs(t - s) < 0.007)) { const h = MM.handsW(); samp.push({ t: +t.toFixed(2), c: +J.c.toFixed(3), sink: +(y0 - C.head().y).toFixed(3), handY: +((h[0][1] + h[1][1]) / 2 - MM.terrainH(0, 3.6)).toFixed(3), hand0: h[0] }); } });
    r.samp = samp; r.planted = Math.hypot(samp[1].hand0[0] - samp[3].hand0[0], samp[1].hand0[2] - samp[3].hand0[2]) < 0.02;
    r.vel0 = MM.PH.V.length();
    MM.fake.a = false; MM.step(1 / 72); const h0 = MM.handsW(), hy0 = C.head().y; r.launch = { c: J.last.c, h: J.last.h, u: J.last.u, vy: MM.PH.V.y };
    MM.step(1 / 72, 7); const h1 = MM.handsW(); r.push = { headUp: C.head().y - hy0, handMoved: Math.hypot(h1[0][0] - h0[0][0], h1[0][1] - h0[0][1], h1[0][2] - h0[0][2]) };
    const l = C.land(); r.land = l; r.jumpDist = Math.hypot(l.x - 0, l.z - 4);
    C.stand(0, 4, 0, MM.terrainH(0, 4)); C.jump(0.1); r.tap = C.land(); r.tapDist = Math.hypot(r.tap.x, r.tap.z - 4);
    return r;
  });
  console.log('INFO charge samples', JSON.stringify(ch.samp.map(s => ({ t: s.t, c: s.c, sink: s.sink, handY: s.handY }))));
  ok(ch.samp[0].c > 0.15 && ch.samp[0].c < 0.18 && Math.abs(ch.samp[1].c - 0.5) < 0.01 && ch.samp[2].c > 0.96 && ch.samp[3].c === 1, `holding A charges linearly to full at 3 s and caps there (c ${ch.samp.map(s => s.c).join(' / ')} at ${ch.samp.map(s => s.t).join(' / ')} s)`);
  ok(ch.curve[0][1] < 1.5 && ch.curve[3][1] > 4 && ch.curve[2][1] / ch.curve[3][1] < 0.88, 'launch speed curve: small hop on a tap, steepest near full charge ' + JSON.stringify(ch.curve));
  ok(ch.samp[3].sink > 0.27 && ch.samp[3].sink < 0.33 && ch.samp[0].sink < ch.samp[1].sink && ch.samp[1].sink < ch.samp[3].sink, `camera sinks slowly while charging (${ch.samp.map(s => s.sink).join(' → ')} m)`);
  ok(ch.samp.every(s => Math.abs(s.handY - 0.07) < 0.06) && ch.planted && ch.vel0 < 0.01, 'hands stay planted on the ground while charging and the body stays put');
  ok(ch.push.headUp > 0.25 && ch.push.handMoved < 0.03 && ch.launch.vy > 4, `release: pushes off with both hands still on the ground (head +${ch.push.headUp.toFixed(2)} m in 0.1 s, hands moved ${ch.push.handMoved.toFixed(3)} m), then lifts off`);
  ok(!ch.land.spawned && ch.jumpDist > 3.5 && ch.tapDist < 0.9, `works anywhere: full jump in the jungle travels ${ch.jumpDist.toFixed(2)} m, a tap is a ${ch.tapDist.toFixed(2)} m hop`);
  // ---------- 2. pillar gaps ----------
  const gaps = await p.evaluate(() => {
    const r = { full: [], short: [] }, CX = MM.CX, edges = [CX.ledgeZ, ...CX.pillars.map(pc => pc.z - CX.PR)], targets = [...CX.pillars.map(pc => pc.z + CX.PR), CX.endEdge];
    edges.forEach((ez, i) => { C.stand(3, ez, 0); C.jump(3.1); const l = C.land(); r.full.push({ from: ez, ok: !l.spawned && l.z < targets[i] - 0.05 && Math.abs(l.y - (CX.F + 0.9)) < 0.1, z: l.z && +l.z.toFixed(2) }); });
    for (const hold of [2.8, 2.6, 2.0]) { C.stand(3, CX.ledgeZ, 0); C.jump(hold); const l = C.land(); r.short.push({ hold, c: +MM.JUMP.last.c.toFixed(3), spawned: l.spawned }); }
    C.stand(3, CX.pillars[0].z - CX.PR, 0); C.jump(2.85); const l = C.land(); r.short.push({ from: 'pillar1', hold: 2.85, spawned: l.spawned });
    // full traversal without teleporting: ledge -> 3 pillars -> ledge, small hops to reach each far edge
    C.stand(3, CX.ledgeZ, 0); const s0 = C.spawns(); r.chain = [];
    for (let i = 0; i < 4; i++) {
      C.jump(3.1); let l = C.land(); r.chain.push(l.spawned ? 'fell' : +l.z.toFixed(2)); if (l.spawned) break;
      if (i < 3) { const far = CX.pillars[i].z - CX.PR; let hops = 0; while (C.head().z - far > 0.45 && hops < 8) { C.jump(C.head().z - far > 1.0 ? 1.68 : 0.1); l = C.land(); hops++; if (l.spawned) break; } r.chain.push('hops' + hops + '@' + (C.head().z - far).toFixed(2)); }
    }
    r.chainOk = C.spawns() === s0 && C.head().z < CX.endEdge;
    return r;
  });
  ok(gaps.full.every(g => g.ok), 'a full 3 s charge from the very edge clears every gap (ledge → pillar 1 → 2 → 3 → far ledge): ' + JSON.stringify(gaps.full.map(g => g.z)));
  ok(gaps.short.every(g => g.spawned), 'any lesser charge falls short into the dark: ' + JSON.stringify(gaps.short));
  ok(gaps.chainOk, 'whole crossing in one go, small hops to each far edge: ' + JSON.stringify(gaps.chain));
  // ---------- 3. falling = 2 s, then spawn ----------
  const fall = await p.evaluate(() => {
    const r = [], CX = MM.CX;
    for (const [x, z, yaw, name] of [[3, CX.ledgeZ + 0.3, 0, 'chasm'], [10.9, -72, -Math.PI / 2, 'cliff (lip)'], [21.5, -72.4, -Math.PI / 2, 'long ledge']]) {
      C.stand(x, z, yaw, name === 'long ledge' ? CX.F + 3 : CX.F); const s0 = C.spawns(), f0 = MM.stats.fallResets || 0;
      MM.place(...(name === 'chasm' ? [3, CX.F + 1, CX.ledgeZ - 1.5] : name === 'cliff (lip)' ? [11.9, CX.F + 1, -71.5] : [21.5, CX.F + 4, -71.6])); // step off the edge
      let t = 0, minY = 99; while (C.spawns() === s0 && t < 4) { MM.step(1 / 72); t += 1 / 72; if (C.spawns() === s0) minY = Math.min(minY, C.head().y); }
      const h = C.head(); r.push({ name, t: +t.toFixed(2), fell: +(CX.F + 1 - minY).toFixed(1), atSpawn: Math.hypot(h.x, h.z) < 2 && h.y < 2, timer: (MM.stats.fallResets || 0) > f0 });
    }
    return r;
  });
  ok(fall.every(f => Math.abs(f.t - 2.0) < 0.05 && f.fell > 15 && f.atSpawn && f.timer), 'falling into a void (chasm, off the cliff, off the long ledge) = 2 s of falling, then back at spawn: ' + JSON.stringify(fall));
  // ---------- 4. play area: standing anywhere in the cave system never respawns ----------
  const stay = await p.evaluate(() => {
    const CX = MM.CX, spots = [[3, -27.5, 0], [3, -31, 0], [3, -40, 0], [5, -44, 0], [3, CX.ledgeZ + 0.2, 0], [3, CX.pillars[1].z, 0], [3, -72.5, 0], [8, -72, -Math.PI / 2], [10.6, -72, -Math.PI / 2], [13.3, -72.9, -Math.PI / 2], [15.9, -72.9, -Math.PI / 2], [23, -72.9, -Math.PI / 2, CX.F + 3]];
    const s0 = C.spawns(), bad = [];
    for (const [x, z, yaw, y] of spots) { C.stand(x, z, yaw, y ?? CX.F); C.run(2); const h = C.head(); if (Math.hypot(h.x - x, h.z - z) > 0.4 || Math.abs(h.y - ((y ?? CX.F) + 0.9)) > 0.15) bad.push([x, z, +h.x.toFixed(2), +h.y.toFixed(2), +h.z.toFixed(2)]); }
    return { spawns: C.spawns() - s0, bad, oob: [MM.outOfBounds(3, CX.F + 1, -40), MM.outOfBounds(3, CX.F - 20, -59), MM.outOfBounds(30, CX.F - 100, -60), MM.outOfBounds(3, CX.F + 1, -90), MM.outOfBounds(-15, CX.F + 1, -40)] };
  });
  ok(stay.spawns === 0 && stay.bad.length === 0, 'tunnel, big cave, ledge, pillar top, ledge chamber, side tunnel, cliff lip and all ledges are solid play area (2 s each, no respawn, no drift) ' + JSON.stringify(stay.bad));
  ok(stay.oob.join() === 'false,false,false,true,true', 'out-of-bounds: cave system, chasm and cliff air are in bounds; solid rock beyond them is out ' + stay.oob);
  // ---------- 5. reachability by jumping only (no teleports): cave 2 -> tunnel -> big cave; chamber -> side tunnel -> cliff lip -> ledges ----------
  const reach = await p.evaluate(() => {
    const CX = MM.CX, r = {}; C.stand(3, -25.6, 0); const s0 = C.spawns(); let n = 0;
    while (C.head().z > CX.ledgeZ + 4 && n < 40) { C.jump(1.9); C.land(); n++; }
    MM.render(); r.cave = { hops: n, z: +C.head().z.toFixed(2), spawns: C.spawns() - s0, zone: MM.CX_STATE.zone, jungleHidden: !MM.CXG.in.parent.children.find(o => o.isMesh && o.geometry.attributes.position.count > 100000)?.visible };
    C.stand(3, -71.5, -Math.PI / 2); n = 0; const s1 = C.spawns();
    while (C.head().x < 10.9 && n < 30) { C.jump(1.73); C.land(); n++; }
    MM.render(); r.exit = { hops: n, x: +C.head().x.toFixed(2), spawns: C.spawns() - s1, zone: MM.CX_STATE.zone };
    // lip -> ledge 1 -> ledge 2 with medium charges
    C.stand(11.15, -72.9, -Math.PI / 2); const s2 = C.spawns(); r.ledges = [];
    for (const [hold, target] of [[2.38, CX.ledges[0]], [2.38, CX.ledges[1]]]) { C.jump(hold); const l = C.land(); r.ledges.push(l.spawned ? 'fell' : +l.x.toFixed(2)); if (!l.spawned && Math.abs(l.x - target.c.x) < 0.8) { MM.place(target.c.x + target.h.x - 0.05, CX.F + 1.3, -72.9); C.run(0.5); } }
    r.ledgesOk = C.spawns() === s2 && r.ledges.every((x, i) => Math.abs(x - CX.ledges[i].c.x) < 0.8);
    return r;
  });
  ok(reach.cave.spawns === 0 && reach.cave.z < MM_LEDGE_Z + 4.5 && /cave|ledge/.test(reach.cave.zone), 'the big cave is reachable from the wall cave through the arched tunnel (jumping only): ' + JSON.stringify(reach.cave));
  ok(reach.exit.spawns === 0 && reach.exit.x > 10.6, 'from the ledge chamber the 4 m side tunnel to the right leads out onto the cliff lip: ' + JSON.stringify(reach.exit));
  ok(reach.ledgesOk, 'cliff: jump forward from the lip onto the 1x1 ledge, then the second 1x1 ledge (medium charges): ' + JSON.stringify(reach.ledges));
  // ---------- 6. vine: either trigger grabs, one hand holds, hand-over-hand climb 3 m, jump to the long ledge ----------
  const vine = await p.evaluate(() => {
    const CX = MM.CX, r = {}, v = C.vine(), F = CX.F;
    // grip alone does not grab the cliff vine; right trigger does (on a jump from ledge 2)
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].grip = true; C.run(0.2);
    MM.fake.a = true; C.run(2.1); MM.fake.a = false; let grabbedGrip = false; C.run(0.6, () => { if (MM.PH.hands.some(h => h.vine === v)) grabbedGrip = true; }); r.gripOnly = grabbedGrip;
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].trig = true; C.run(0.2);
    MM.fake.a = true; C.run(2.1); MM.fake.a = false; let tg = -1; C.run(1.0, t => { if (tg < 0 && MM.PH.hands[1].vine === v) tg = t; });
    r.rightGrab = tg >= 0; r.closedR = MM.myHands[1].geometry === MM.gorillaGeo.handRc && MM.myHands[0].geometry === MM.gorillaGeo.handL;
    // hang with ONE hand for 3 s
    const s0 = C.spawns(), yA = C.head().y; let lo = 99, hi = -99; C.run(3, () => { const y = C.head().y; lo = Math.min(lo, y); hi = Math.max(hi, y); });
    r.oneHand = { spawns: C.spawns() - s0, swing: +(hi - lo).toFixed(2), sag: +(yA - C.head().y).toFixed(2), y: +yA.toFixed(2), holding: MM.PH.hands[1].vine === v && !MM.PH.hands[0].vine }; // swings like a pendulum, never falls
    // left trigger grabs too
    C.handTo(0, C.vinePt(MM.handsW()[1][1] + 0.4)); MM.fake.hands[0].trig = true; C.run(0.1); r.leftGrab = MM.PH.hands[0].vine === v; r.closedBoth = MM.myHands[0].geometry === MM.gorillaGeo.handLc && MM.GRIP() === 3;
    // climb hand over hand: free hand reaches 0.45 m up the vine and grips, the other lets go, then pull down
    const y0 = C.head().y; let hand = 0, steps = 0; MM.fake.hands[1].trig = false; C.run(0.1);
    while (C.head().y - y0 < 3.05 && steps < 20) {
      const P = MM.rig.position, start = MM.fake.hands[hand].p.slice();
      C.run(0.4, t => { MM.fake.hands[hand].p = [start[0], start[1] - 0.5 * t / 0.4, start[2]]; }); // pull
      const o = 1 - hand; C.handTo(o, C.vinePt(MM.handsW()[hand][1] + 0.45)); MM.fake.hands[o].trig = true; C.run(0.08);
      if (MM.PH.hands[o].vine !== v) { r.miss = steps; break; }
      MM.fake.hands[hand].trig = false; C.run(0.05); hand = o; steps++;
    }
    r.climb = { rose: +(C.head().y - y0).toFixed(2), steps, spawns: C.spawns() - s0 };
    // one-hand pull also raises you
    const yp = C.head().y, st = MM.fake.hands[hand].p.slice(); C.run(0.4, t => { MM.fake.hands[hand].p = [st[0], st[1] - 0.4 * t / 0.4, st[2]]; }); r.onePull = +(C.head().y - yp).toFixed(2);
    C.run(0.6); r.afterPull = +(C.head().y - yp).toFixed(2); // still held up there, one hand
    r.vineHead = C.head().toArray().map(x => +x.toFixed(2));
    // charged jump off the vine onto the 6 m ledge
    MM.fake.a = true; C.run(2.67); MM.fake.a = false; MM.fake.hands[0].trig = MM.fake.hands[1].trig = false; MM.fake.hands[0].p = C.rot([-0.27, 0.98, -0.2], -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.27, 0.98, -0.2], -Math.PI / 2);
    const l = C.land(); const L = CX.ledges[2]; r.longLedge = { ...l, on: !l.spawned && Math.abs(l.x - L.c.x) < L.h.x && Math.abs(l.y - (F + 3.9)) < 0.15 };
    // let go of the vine with both hands = fall
    C.resetVine(); C.stand(16.35, -72.8, -Math.PI / 2); MM.fake.hands[1].p = C.rot([0.18, 1.55, -0.6], -Math.PI / 2); MM.fake.hands[1].trig = true; C.run(0.2); MM.fake.a = true; C.run(2.1); MM.fake.a = false; C.run(1.0); r.heldBefore = MM.PH.hands[1].vine === C.vine();
    const sF = C.spawns(); MM.fake.hands[1].trig = false; let tf = 0; while (C.spawns() === sF && tf < 4) { MM.step(1 / 72); tf += 1 / 72; } r.letGo = +tf.toFixed(2);
    return r;
  });
  ok(!vine.gripOnly && vine.rightGrab, 'cliff vine: grip alone does not catch it, the RIGHT TRIGGER does (caught mid-jump from ledge 2)');
  ok(vine.closedR, 'pressing the right trigger closes the right hand (fingers + thumb curled), the left stays open');
  ok(vine.oneHand.spawns === 0 && vine.oneHand.holding && vine.oneHand.sag < 0.45 && vine.oneHand.swing < 0.6, `one hand on the vine is enough: hung 3 s on the right trigger alone, swinging (±${vine.oneHand.swing} m) but not falling`);
  ok(vine.leftGrab && vine.closedBoth, 'the LEFT trigger grabs the vine too, closing the left hand');
  ok(vine.climb.rose >= 3 && vine.climb.spawns === 0 && vine.onePull > 0.1 && vine.afterPull > 0.05, `hand-over-hand climb: ${vine.climb.rose} m in ${vine.climb.steps} grips; a single one-hand pull raises you ${vine.onePull} m and you stay up`);
  ok(vine.longLedge.on, 'charged jump off the vine lands on the 6 m x 1 m ledge: ' + JSON.stringify({ x: vine.longLedge.x, y: vine.longLedge.y, from: vine.vineHead }));
  ok(vine.heldBefore && Math.abs(vine.letGo - 2.0) < 0.1, `letting go with both hands = fall, respawn after ${vine.letGo} s`);
  // ---------- 7. darkness: each pillar barely visible from the one before ----------
  const dark = await p.evaluate(() => {
    const CX = MM.CX, r = [];
    const pairs = [[CX.ledgeZ + 0.5, CX.pillars[0].z + CX.PR], [CX.pillars[0].z, CX.pillars[1].z + CX.PR], [CX.pillars[1].z, CX.pillars[2].z + CX.PR], [CX.pillars[2].z, CX.endEdge]];
    for (const [z, tz] of pairs) { C.stand(3, z, 0); MM.render(); const f = MM.fogInfo(), h = C.head(), d = Math.hypot(h.z - tz, h.y - CX.F); r.push({ fog: +((d - f.near) / (f.far - f.near)).toFixed(2), d: +d.toFixed(2), col: f.color }); }
    C.stand(3, CX.pillars[1].z, 0); MM.render(); const ff = MM.fogInfo(); return { list: r, beyond: Math.hypot(CX.G + 2 * CX.PR + CX.PR, 1) > ff.far };
  });
  ok(dark.list.every(d => d.fog > 0.75 && d.fog < 0.95 && d.col === '000000') && dark.beyond, 'pitch-black chasm: the next pillar is barely visible (fog ' + dark.list.map(d => d.fog).join(' / ') + ' at its near edge), anything further is black');
  // ---------- 8. performance / culling ----------
  const perf = await p.evaluate(() => {
    const CX = MM.CX, out = {}, info = () => { MM.render(); const i = MM.renderer.info.render; return { calls: i.calls, tris: i.triangles }; };
    C.stand(0, 2, Math.PI); out.spawn = { ...info(), cave: MM.CXG.in.visible || MM.CXG.rt.visible || MM.CXG.out.visible };
    C.stand(3, -25.6, 0); out.wallCave = { ...info(), in: MM.CXG.in.visible, out: MM.CXG.out.visible };
    C.stand(3, -40, 0); out.bigCave = { ...info(), jungle: MM.scene.children.filter(o => o.visible && o.isMesh).length };
    C.stand(3, CX.pillars[1].z, 0); out.chasm = info();
    C.stand(15.9, -72.9, -Math.PI / 2); out.cliff = { ...info(), in: MM.CXG.in.visible };
    return out;
  });
  console.log('INFO render', JSON.stringify(perf));
  ok(!perf.spawn.cave && perf.wallCave.in && !perf.wallCave.out && !perf.cliff.in && perf.bigCave.calls <= perf.spawn.calls && perf.cliff.tris < 20000, 'cave system only drawn when near (hidden at spawn), jungle skipped deep inside, cliff view stays light');
  // ---------- 9. trigger hand pose syncs to other players ----------
  const MPctx = await b.newContext({ viewport: { width: 320, height: 200 } }); const room = 'CT' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const pages = [];
  for (const nm of ['Kong', 'Bongo']) { const q = await MPctx.newPage(); await q.addInitScript(LOCAL_TRANSPORT); await q.goto(URL); await q.waitForFunction(() => !!window.MM); await q.evaluate(HELPERS); await q.fill('#nameIn', nm); await q.fill('#roomIn', room); await q.evaluate(() => { document.getElementById('voiceIn').checked = false; }); await q.click('#playDesk'); await q.evaluate(() => { C.idle(0); }); pages.push(q); }
  const seen = await pages[1].waitForFunction(() => MM.remoteList().length > 0, null, { timeout: 15000 }).then(() => true).catch(() => false);
  await pages[0].evaluate(() => { MM.fake.hands[0].trig = true; });
  const g1 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 1 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  await pages[0].evaluate(() => { MM.fake.hands[0].trig = false; MM.fake.hands[1].trig = true; });
  const g2 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 2 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  await pages[0].evaluate(() => { MM.fake.hands[1].trig = false; });
  const g3 = await pages[1].waitForFunction(() => MM.remoteList()[0] && MM.remoteList()[0].grip === 0 ? 1 : 0, null, { timeout: 5000 }).then(() => 1).catch(() => 0);
  ok(seen && g1 && g2 && g3, 'closed/open hands sync over the network: the other player sees left trigger, right trigger, release (pose field 16)');
  await MPctx.close();
  // ---------- shots ----------
  const shot = async (name, pos, yaw, pitch, hands, extra) => { await p.evaluate(([pos, yaw, pitch, hands, extra]) => { MM.timeOverride = 0.25; MM.PH.freeze = true; MM.fake = { head: [0, 1.6, 0], headQ: C.q(yaw, pitch), hands: hands || [{ p: C.rot([-0.25, 0.95, 0.2], yaw) }, { p: C.rot([0.25, 0.95, 0.2], yaw) }] }; if (extra) Object.assign(MM.fake, extra); MM.place(...pos); MM.step(1 / 72); MM.render(); }, [pos, yaw, pitch, hands, extra]); await p.screenshot({ path: SHOTS + name }); };
  const F = await p.evaluate(() => MM.CX.F), HH = F + 1.25;
  await shot('cave_tunnel.png', [3, HH, -26.2], 0, 0.02);
  await shot('cave_big.png', [3, HH + 0.3, -35.5], 0.25, 0.12);
  await shot('cave_ledge_pillar.png', [3, HH, MM_LEDGE_Z + 0.4], 0, -0.18);
  await shot('cave_pillar_next.png', [3, HH, -53], 0, -0.15);
  await shot('cave_exit.png', [8.4, HH, -72], -Math.PI / 2 - 0.12, -0.08, [{ p: C_rot([-0.22, 1.05, -0.45], -Math.PI / 2 - 0.12) }, { p: C_rot([0.22, 1.05, -0.45], -Math.PI / 2 - 0.12) }]);
  await shot('cave_cliff_down.png', [11.0, HH, -71.2], -Math.PI / 2 + 0.6, -0.7);
  await shot('cave_vine.png', [16.2, HH, -72.7], -Math.PI / 2 + 0.05, 0.25, [{ p: C_rot([-0.2, 1.1, -0.4], -Math.PI / 2), trig: false }, { p: C_rot([0.1, 1.5, -0.5], -Math.PI / 2), trig: true }]);
  await shot('cave_long_ledge.png', [20.4, HH + 3, -72.9], -Math.PI / 2, -0.12);
  await shot('cave_hands_closed.png', [20.4, HH + 3, -72.9], -Math.PI / 2, -0.55, [{ p: C_rot([-0.2, 1.2, -0.42], -Math.PI / 2), trig: true }, { p: C_rot([0.2, 1.2, -0.42], -Math.PI / 2), trig: false }]);
  await p.evaluate(() => { MM.PH.freeze = false; C.stand(0, 4, 0, MM.terrainH(0, 4)); MM.fake.headQ = C.q(0, -0.6); MM.fake.a = true; C.run(2.5); MM.render(); });
  await p.screenshot({ path: SHOTS + 'cave_jump_charge.png' });
  await p.evaluate(() => { MM.fake.a = false; C.run(0.05); MM.render(); });
  await b.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error(e); process.exit(2); });
function C_rot(o, yaw) { const c = Math.cos(yaw), s = Math.sin(yaw); return [o[0] * c + o[2] * s, o[1], -o[0] * s + o[2] * c]; }
var MM_LEDGE_Z = -48;
