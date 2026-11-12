import * as THREE from 'three';
import * as A from './assets.js';
import { Snd } from './audio.js';
import { world, resolve, emit, rand, pick, clamp, lamps, scene, blocked } from './core.js';
import { G, hook, Enemy, Boss, Bot, Player, spawnDrop, dropLoot, nearestDrop, openDrop, spawnArrow } from './actors.js';
import { buildHollow, buildCapital, lv, updateGate } from './world.js';
import { REGIONS, TRIBUTES, RIVAL_NAMES, CHAPTERS, ENDINGS, PROLOGUE } from './data.js';

// The campaign. Each chapter is a small state machine; everything it spawns is cleared when it ends
// so the next mission starts clean (markers and objectives go away once they are done).
export const S = { ch: 0, step: 0, t: 0, wave: 0, waves: 3, objs: [], allies: [], marker: null, boss: null, lit: 0, resolved: 0, rivals: 0, busy: false, complete: false };
const ui = () => G.ui;

// --- objectives (shown top-right, struck through then removed once completed) ---
function objectives(list) { S.objs = list.map(o => ({ ...o, done: false })); ui().objectives(S); }
function done(id) { const o = S.objs.find(x => x.id === id); if (o && !o.done) { o.done = true; ui().objectives(S); Snd.play('bell', { vol: .4, rate: 1.3 }); setTimeout(() => { o.gone = true; ui().objectives(S); }, 2600); } }
function setText(id, text) { const o = S.objs.find(x => x.id === id); if (o) { o.text = text; ui().objectives(S); } }
function mark(x, z, label = '') { S.marker = x == null ? null : { x, z, label }; }
function cap(lines, label = '', gap = 4.2) { ui().caption(lines, label, gap); }

// --- helpers to put enemies on the ground around the player ---
function ringPoint(c, rmin, rmax, ahead = null) {
  for (let i = 0; i < 30; i++) {
    const a = ahead != null ? ahead + rand(-1.3, 1.3) : rand(0, 6.28), r = rand(rmin, rmax), x = c.x + Math.sin(a) * r, z = c.z + Math.cos(a) * r;
    if (!blocked(x, z, .6)) return { x, z };
  }
  return { x: c.x + rand(-4, 4), z: c.z - rand(12, 18) };
}
function spawnRisen(n, opt = {}) {
  const p = G.player, c = opt.center || p;
  for (let i = 0; i < n; i++) {
    const pt = ringPoint(c, opt.rmin || 16, opt.rmax || 30, opt.ahead);
    const stitched = opt.brutes && i < opt.brutes;
    const e = new Enemy(stitched ? 'stitched' : 'risen', pt.x, pt.z, { hp: stitched ? 200 : 45 + S.ch * 6 + S.wave * 6, run: Math.random() < (.12 + S.wave * .06) });
    e.state = 'rise'; e.t = -i * .12; G.enemies.push(e);
  }
}
const alive = () => G.enemies.filter(e => e.alive).length;
function killAll() { for (const e of G.enemies) if (e.alive && !e.boss) { e.alive = false; e.state = 'dead'; e.dyingT = 1; e.actor.play('death'); } for (const b of G.bots) if (b.alive && !b.ally) { b.alive = false; b.state = 'dead'; b.dyingT = 1; } }
function rivalRegion(avoid) { return pick(REGIONS.filter(r => r.id !== avoid)); }
function makeRival(c, canYield = true) {
  const reg = rivalRegion(G.player.team), t = pick(TRIBUTES), pt = ringPoint(c, 14, 26);
  const b = new Bot(reg, t, pt.x, pt.z, { name: pick(RIVAL_NAMES), skill: .45 + Math.random() * .25, canYield, hp: 100 }); b.ry = Math.PI; G.bots.push(b);
  emit(pt.x, 1, pt.z, 20, { color: 0xb0d0ff, speed: 3, life: .6, size: .12 }); return b;
}

// --- player construction ---
export function makePlayer(sel, st) {
  if (G.player) G.player.dispose();
  G.player = new Player(sel.region, sel.tribute, st.x, st.z, st.ry); G.player.hp = G.player.max; return G.player;
}

// --- chapter start ---
export async function startChapter(ch, sel, seamless = false) {
  S.ch = ch; S.step = 0; S.t = 0; S.wave = 0; S.lit = 0; S.resolved = 0; S.rivals = 0; S.complete = false; S.marker = null; S.boss = null; S.busy = true; S.sel = sel;
  const info = CHAPTERS[ch];
  if (!seamless) {
    if (ch === 4) await buildCapital(); else if (lv.kind !== 'hollow' || !S.hollowReady) { await buildHollow(sel.region); S.hollowReady = true; }
    const st = lv.starts[ch]; makePlayer(sel, st); G.player.ammo = Math.max(G.player.ammo, Math.round(G.player.ammoMax * .8));
  } else { G.player.ammo = Math.min(G.player.ammoMax, G.player.ammo + 12); G.player.pots += 1; G.player.hp = G.player.max; }
  if (ch !== 4) world.surface = ch === 1 ? 'stone' : 'grass';
  if (ch === 1) { /* first chapter keeps the gates shut */ for (const g of Object.values(lv.gates)) { g.open = false; g.t = 0; g.bars.position.y = 0; g.col.on = true; } }
  if (ch === 2) { lv.gates.lane.open = true; lv.gates.lane.t = 1; lv.gates.lane.bars.position.y = -6.6; lv.gates.lane.col.on = false; }
  if (ch === 3) { for (const g of Object.values(lv.gates)) { g.open = true; g.t = 1; g.bars.position.y = -6.6; g.col.on = false; } }
  G.enemies.forEach(e => e.dispose()); G.enemies = []; G.bots.forEach(b => b.dispose()); G.bots = [];
  G.waveSpeed = 1; G.story = true; G.pvp = false;
  G.beaconTargets = [];
  ui().chapterIntro(info, ch);
  Snd.setMusic(ch === 4 ? 'boss' : ch === 1 ? 'lane' : 'cemetery', ch === 4 ? .55 : .9);
  S.busy = false; await new Promise(r => setTimeout(r, 200));
  begin(ch);
}

function begin(ch) {
  const p = G.player, info = CHAPTERS[ch];
  if (ch === 1) {
    objectives([{ id: 'waves', text: 'Survive the risen (0 / 3 waves)' }, { id: 'gate', text: 'Reach the lane gate' }]);
    S.t = 0; S.step = 0; mark(null);
    // The opening of a fresh game carries the whole premise; a retry gets the short version.
    cap(S.sel && !(S.sel.allies && S.sel.allies.length) && !S.retry ? [...PROLOGUE, S.sel.region.line, info.intro[1]] : [info.intro[1]], 'The Hollow Games', 3.4); S.next = S.retry ? 6 : 17; S.retry = true;
  } else if (ch === 2) {
    objectives([{ id: 'braz', text: 'Light the braziers (0 / 3)' }, { id: 'abbess', text: 'Defeat the Abbess' }, { id: 'gate', text: 'Open the Heart gate' }]);
    cap(info.intro, info.name, 4.6); const b = lv.braziers[0]; mark(b.x, b.z, 'Brazier'); S.step = 0; S.t = 0;
  } else if (ch === 3) {
    objectives([{ id: 'rivals', text: 'Face the other tributes (0 / 3)' }, { id: 'horn', text: 'Survive the Stonehorn' }]);
    cap(info.intro, info.name, 4.6); S.step = 0; S.t = 0; S.next = 8; mark(lv.heartCenter.x, lv.heartCenter.z, 'The Heart');
  } else if (ch === 4) {
    // spared tributes fight beside you
    S.allies = (S.sel.allies || []).slice(0, 5);
    objectives([{ id: 'beacons', text: 'Destroy the Capital\'s beacons (0 / 3)' }, { id: 'gm', text: 'Confront the High Gamemaker' }, { id: 'end', text: 'End the Games' }]);
    cap(info.intro, info.name, 4.2); S.step = 0; S.t = 0; S.next = 10;
    for (const a of S.allies) { const reg = REGIONS.find(r => r.id === a.region) || REGIONS[0], tr = TRIBUTES.find(t => t.id === a.tribute) || TRIBUTES[0]; const b = new Bot(reg, tr, p.x + rand(-3, 3), p.z + rand(-3, 3), { name: a.name, skill: .7 }); b.setAlly(p); G.bots.push(b); }
    G.player && (G.alliesCount = S.allies.length);
    G.beaconTargets = lv.beacons.map(b => makeBeaconTarget(b)); mark(lv.beacons[0].x, lv.beacons[0].z, 'Beacon');
    S.beaconsLeft = 3;
  }
}

function makeBeaconTarget(b) {
  return { x: b.x, z: b.z, team: 'capital', alive: true, hp: b.hp, max: b.max, radius: 1.3, height: 3, big: true, y: 0, b, spawnT: 0,
    hurt(d, ctx) { if (!this.alive) return false; this.hp -= d; emit(this.x, 2, this.z, 8, { color: 0x88c0ff, speed: 4, life: .5, size: .12 }); Snd.play('hitFlesh', { at: this, vol: .5, rate: 1.5 }); if (this.hp <= 0) { this.alive = false; b.alive = false; b.lamp.on = false; b.fire.visible = false; emit(this.x, 2, this.z, 90, { color: 0x88c0ff, speed: 9, life: 1.5, size: .25 }); G.shake = 1.4; Snd.play('cannon', { vol: .9 }); hook('beaconDown', this); } return true; },
    update() { } };
}

// --- per-frame story logic ---
export function update(dt) {
  const p = G.player; if (!p) return;
  for (const g of Object.values(lv.gates)) updateGate(g, dt);
  S.t += dt;
  const ch = S.ch;
  if (ch === 1) chapter1(dt, p); else if (ch === 2) chapter2(dt, p); else if (ch === 3) chapter3(dt, p); else if (ch === 4) chapter4(dt, p);
  if (S.marker) ui().marker(S.marker); else ui().marker(null);
}

function chapter1(dt, p) {
  if (S.step === 0) { // waves
    if (S.wave < 3 && S.t > S.next && (alive() === 0 || (alive() <= 1 && S.t > S.next + 12))) {
      S.wave++; G.waveSpeed = 1 + S.wave * .03; setText('waves', `Survive the risen (${S.wave - 1} / 3 waves)`);
      ui().banner(`Wave ${S.wave}`, S.wave === 3 ? 'The dead rise faster' : 'The dead stir'); Snd.play('stinger', { vol: .7 });
      spawnRisen(5 + S.wave * 3, { ahead: Math.PI, rmin: 18, rmax: 30 }); if (S.wave === 3) spawnRisen(1, { brutes: 1, ahead: Math.PI, rmin: 24, rmax: 32 });
      if (S.wave === 2) { const d = spawnDrop(p.x + 4, p.z - 6); }
      S.next = S.t + 4;
    }
    if (S.wave === 3 && (alive() === 0 || (alive() <= 1 && S.t > S.next + 14)) && S.t > S.next) { S.step = 1; setText('waves', 'Survive the risen (3 / 3 waves)'); done('waves'); lv.gates.lane.open = true; Snd.play('rumble', { vol: .9 }); ui().banner('The gate opens', 'Hollow Lane is behind you'); cap(['The lane gate groans open. Beyond it: the Old Cemetery.'], '', 3.5); mark(0, -148, 'Gate'); }
  } else if (S.step === 1) { if (p.z < -152) { done('gate'); mark(null); S.step = 2; endMission('The Reaping'); } }
}

function chapter2(dt, p) {
  if (S.step === 0) { // braziers
    const b = lv.braziers[S.lit]; if (b) mark(b.x, b.z, 'Light the brazier');
    if (S.wait) { if (alive() === 0 && S.t > S.next) { S.wait = false; } }
    if (S.lit >= 3 && alive() === 0 && !S.wait) { S.step = 1; done('braz'); S.t = 0; mark(null); cap(['The last fire catches.', 'The Abbess laughs somewhere in the dark.'], 'The Old Cemetery', 3.2); }
  } else if (S.step === 1) {
    if (S.t > 4.5) {
      const c = lv.braziers[1]; const ang = Math.atan2(p.x - c.x, p.z - c.z);
      S.boss = new Boss('abbess', c.x, c.z - 4, { hp: 1100, name: 'The Abbess', tint: 0xffffff }); S.boss.ry = ang; G.enemies.push(S.boss); G.bossRef = S.boss; ui().boss(S.boss);
      Snd.play('abbessReveal', { vol: 1 }); Snd.setMusic('boss', .8); ui().banner('The Abbess', 'The Gamemakers\' voice'); G.shake = 1; S.step = 2; S.hunt = 0;
    }
  } else if (S.step === 2) {
    if (S.boss && !S.boss.alive) { S.step = 3; done('abbess'); ui().boss(null); killAll(); Snd.setMusic('cemetery', .8); lv.gates.heart.open = true; Snd.play('rumble', { vol: 1 }); cap(['The Abbess crumbles. Somewhere beyond the graves, a gate grinds open.'], '', 4); mark(0, -300, 'Gate'); }
  } else if (S.step === 3) { if (p.z < -304) { done('gate'); mark(null); S.step = 4; endMission('The Old Cemetery'); } }
}

function chapter3(dt, p) {
  if (S.step === 0) {
    if (S.t > S.next) {
      S.step = 1; S.rivals = 3; ui().banner('Rival tributes', 'You do not have to kill them');
      for (let i = 0; i < 3; i++) setTimeout(() => { if (S.ch === 3 && G.player) makeRival(lv.heartCenter); }, i * 900);
      cap(['They have been starving in the dark for days.', 'If a rival kneels — you can spare them.'], 'The Hollow Heart', 5);
      mark(null); Snd.setMusic('boss', .45);
    }
  } else if (S.step === 1) {
    const unresolved = G.bots.filter(b => b.alive && !b.ally && b.state !== 'yield').length, yielding = G.bots.filter(b => b.alive && b.state === 'yield').length;
    setText('rivals', `Face the other tributes (${S.resolved} / 3)`);
    if (S.resolved >= 3) { S.step = 2; S.t = 0; done('rivals'); }
  } else if (S.step === 2) {
    if (S.t > 3) { S.step = 3; cap(['The ground shudders.', 'The Gamemakers have released the last thing in the arena.'], '', 4); Snd.play('rumble', { vol: 1 }); G.shake = 1.2; S.t = 0; }
  } else if (S.step === 3) {
    if (S.t > 4) { const c = lv.heartCenter; S.boss = new Boss('stonehorn', c.x, c.z - 22, { hp: 1500, name: 'The Stonehorn' }); S.boss.ry = 0; G.enemies.push(S.boss); ui().boss(S.boss); ui().banner('The Stonehorn', 'The arena\'s last trick'); Snd.play('reveal', { vol: 1 }); Snd.setMusic('boss', .85); S.step = 4; }
  } else if (S.step === 4) {
    if (S.boss && !S.boss.alive) { S.step = 5; done('horn'); ui().boss(null); killAll(); S.t = 0; Snd.setMusic('menu', .5); cap(['The Stonehorn falls.', 'The cannons fire. The Capital announces a victor.', 'You are not the winner they wanted.'], 'Victor', 4.5); }
  } else if (S.step === 5) { if (S.t > 14) { S.step = 6; endMission('The Hollow Heart', true); } }
}

function chapter4(dt, p) {
  const L = lv.beacons;
  if (S.step === 0) {
    if (S.t > S.next) {
      S.step = 1; S.t = 0; ui().banner('The Exhibition', 'The Leaders watch'); Snd.play('announcer', { vol: .7 }); Snd.play('cannon', { vol: .7 });
      S.waveT = 1; spawnPhase(); S.next = 0;
    }
  } else if (S.step === 1) {
    const left = L.filter(b => b.alive !== false).length; S.beaconsLeft = left;
    setText('beacons', `Destroy the Capital's beacons (${3 - left} / 3)`);
    const nxt = L.find(b => b.alive !== false); if (nxt) mark(nxt.x, nxt.z, 'Beacon'); else mark(null);
    S.waveT -= dt; if (S.waveT <= 0 && left > 0) { S.waveT = 22; S.pulse = (S.pulse || 0) + 1; if (alive() + G.bots.filter(b => !b.ally && b.alive).length < 9) spawnPhase(); }
    if (left === 0) { S.step = 2; done('beacons'); G.beaconTargets = []; killAll(); S.t = 0; mark(null); cap(['The last beacon falls dark. Across the Capital, the broadcast cuts out.', 'The crowd goes silent.'], '', 4); }
  } else if (S.step === 2) {
    if (S.t > 6) {
      S.step = 3; S.boss = new Boss('abbess', 0, -10, { hp: 2600, name: 'The High Gamemaker', scale: 1.35, tint: 0xffe08a }); S.boss.ry = 0; G.enemies.push(S.boss); ui().boss(S.boss);
      ui().banner('The High Gamemaker', 'She made the rules'); Snd.play('abbessReveal', { vol: 1 }); Snd.setMusic('boss', .9); G.waveSpeed = 1.05;
      spawnRisen(4, { brutes: 2, rmin: 20, rmax: 34 });
    }
  } else if (S.step === 3) {
    if (S.boss && !S.boss.alive) { S.step = 4; done('gm'); ui().boss(null); killAll(); S.t = 0; Snd.setMusic('menu', .5); }
    else if (alive() < 3 && S.t > 20 && S.boss.alive) { S.t = 0; spawnRisen(3, { rmin: 20, rmax: 34 }); }
  } else if (S.step === 4) {
    if (S.t > 3.5) { S.step = 5; done('end'); const n = G.player ? S.allies.length : 0; G.finish(n >= 3 ? 'many' : n >= 1 ? 'some' : 'alone'); }
  }
}
function spawnPhase() {
  const p = G.player; ui().banner(`Phase ${S.pulse || 1}`, 'Champions of the Capital');
  const n = 2 + Math.min(2, S.pulse || 0);
  for (let i = 0; i < n; i++) { const b = makeRival(p, false); b.skill = .55 + Math.random() * .2; b.name = 'Champion ' + b.name; }
  spawnRisen(4 + (S.pulse || 0) * 2, { rmin: 20, rmax: 36 });
}

// --- mission end: tear down what the chapter spawned, then move on ---
function endMission(name, last3 = false) {
  S.complete = true; mark(null); killAll(); ui().boss(null);
  for (const o of S.objs) if (!o.done) { o.done = true; o.gone = true; }
  ui().objectives(S); ui().missionDone(name);
  G.bossRef = null; G.chapterDone(S.ch);
}

// --- interactions ---
export function nearby(p) {
  if (!p.alive) return null;
  const d = nearestDrop(p); if (d) return { text: 'Open supply crate', fn: () => openDrop(d, p) };
  for (const b of G.bots) if (b.alive && b.state === 'yield' && Math.hypot(b.x - p.x, b.z - p.z) < 3.2) return { text: `Spare ${b.name}`, fn: () => spare(b, p) };
  if (S.ch === 2 && S.step === 0 && !S.wait) { const b = lv.braziers[S.lit]; if (b && !b.lit && Math.hypot(b.x - p.x, b.z - p.z) < 3.2) return { text: 'Light the brazier', hold: 1.6, fn: () => lightBrazier(b) }; }
  return null;
}
function lightBrazier(b) {
  b.light(); S.lit++; setText('braz', `Light the braziers (${S.lit} / 3)`); Snd.play('fire', { vol: .5, at: b, range: 30 }); Snd.play('stinger', { vol: .6 });
  S.wait = true; S.next = S.t + 3; G.waveSpeed = 1 + S.lit * .04; S.wave = S.lit;
  spawnRisen(6 + S.lit * 3, { center: b, rmin: 12, rmax: 26 }); if (S.lit === 3) spawnRisen(1, { brutes: 1, center: b, rmin: 16, rmax: 24 });
  const nx = lv.braziers[S.lit]; if (nx) mark(nx.x, nx.z, 'Brazier'); else mark(null);
  ui().banner('The fire catches', 'The dead are watching');
}
function spare(b, p) {
  b.setAlly(p); S.resolved++; S.sel.allies = S.sel.allies || []; S.sel.allies.push({ region: b.region.id, tribute: b.tribute.id, name: b.name });
  G.alliesNow = (G.alliesNow || 0) + 1; hook('toast', `${b.name} of ${b.region.name} stands with you`); Snd.play('bell', { vol: .7, rate: .9 }); emit(b.x, 1, b.z, 30, { color: 0xffe9a0, speed: 3, life: 1, size: .12, grav: -1, up: 1 });
  cap([`"${b.name} — from ${b.region.name}. I won't forget this."`], b.name, 3.2); b.actor.play('idle', .4);
}

// --- events ---
export function bind() { }
