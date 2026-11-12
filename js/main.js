import * as THREE from 'three';
import * as A from './assets.js';
import { Snd } from './audio.js';
import { Net } from './net.js';
import * as D from './data.js';
import {
  $, renderer, scene, camera, composer, fxPass, bloom, initPost, post, world, lantern, moon, hemi, updateLamps, updateParticles, updateMotes, motes, sky, emit,
  clamp, lerp, rand, pick, angLerp, resolve, lamps, blocked, lightPool,
} from './core.js';
import { buildStage, buildCapital, lv, fires } from './world.js';
import { G, Player, Bot, Remote, dress, hook, updateActors, clearActors, spawnArrow, spawnDrop, nearestDrop, openDrop, everyone, Enemy } from './actors.js';
import * as Story from './story.js';
const S = Story.S;

const SAVE = 'hollow-games-3d';
const sel = { region: D.REGIONS[0], tribute: D.TRIBUTES[0] };
let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVE)); } catch (e) { }
const store = o => { try { localStorage.setItem(SAVE, JSON.stringify(o)); saved = o; } catch (e) { } };
const show = id => { document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id)); };
function lock() { try { const r = $('gl').requestPointerLock && $('gl').requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
const hud = on => $('hud').classList.toggle('on', on);

// ================= input =================
const inp = { up: 0, down: 0, left: 0, right: 0, sprint: 0, fire: 0, aim: 0, rollHit: 0, joy: null };
const cam = { yaw: Math.PI, pitch: .18, dist: 3.4, shoulder: .65, smoothFov: 62, pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), look: false, orbit: 0 };
cam.aimTarget = p => {
  const o = cam.pos, d = cam.dir; let best = null, bestD = 60;
  const cands = [...G.enemies, ...G.bots, ...[...G.remotes.values()].map(r => r.proxyTarget), ...(G.beaconTargets || [])];
  for (const t of cands) {
    if (!t || t.alive === false || t.team === p.team) continue;
    const cy = (t.y || 0) + (t.height || 1.7) * .62, v = new THREE.Vector3(t.x - o.x, cy - o.y, t.z - o.z), along = v.dot(d);
    if (along < 3 || along > bestD) continue; const perp = v.clone().addScaledVector(d, -along).length();
    if (perp < (t.big ? 1.6 : .75) + along * .01) { best = new THREE.Vector3(t.x, cy, t.z); bestD = along; }
  }
  if (best) return best;
  let far = 45; const pt = new THREE.Vector3();
  for (let s = 6; s < 60; s += 2) { pt.copy(o).addScaledVector(d, s); if (pt.y < .1) { far = s; break; } far = 45; }
  return o.clone().addScaledVector(d, far);
};
const keys = {};
addEventListener('keydown', e => {
  Snd.init(); if (e.repeat) return; keys[e.code] = true;
  const m = G.mode;
  if (e.code === 'KeyM') Snd.toggle();
  if (m === 'play') {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') inp.up = 1; if (e.code === 'KeyS' || e.code === 'ArrowDown') inp.down = 1; if (e.code === 'KeyA' || e.code === 'ArrowLeft') inp.left = 1; if (e.code === 'KeyD' || e.code === 'ArrowRight') inp.right = 1;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.sprint = 1; if (e.code === 'Space') { inp.rollHit = 1; e.preventDefault(); }
    if (e.code === 'KeyQ' && G.player) G.player.drink(); if (e.code === 'KeyE') interactPress(); if (e.code === 'Tab') { e.preventDefault(); showScore(true); }
    if (e.code === 'Escape') pause(true);
  } else if (m === 'pause' && e.code === 'Escape') pause(false);
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') inp.up = 0; if (e.code === 'KeyS' || e.code === 'ArrowDown') inp.down = 0; if (e.code === 'KeyA' || e.code === 'ArrowLeft') inp.left = 0; if (e.code === 'KeyD' || e.code === 'ArrowRight') inp.right = 0;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') inp.sprint = 0; if (e.code === 'Tab') showScore(false);
});
$('gl').addEventListener('mousedown', e => { Snd.init(); if (G.mode === 'play') { if (document.pointerLockElement !== $('gl')) { lock(); return; } if (e.button === 0) inp.fire = 1; if (e.button === 2) inp.aim = 1; } });
addEventListener('mouseup', e => { if (e.button === 0) inp.fire = 0; if (e.button === 2) inp.aim = 0; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => { if (G.mode === 'play' && document.pointerLockElement === $('gl')) { const s = .0022 * (inp.aim || inp.fire ? .7 : 1); cam.yaw -= e.movementX * s; cam.pitch = clamp(cam.pitch + e.movementY * s, -.75, 1.1); } });
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== $('gl') && G.mode === 'play') pause(true); });
// touch
(function touch() {
  if (!('ontouchstart' in window)) return; $('touchui').style.display = 'block'; const joy = $('joy'); let jid = null, lid = null, lx = 0, ly = 0;
  joy.addEventListener('touchstart', e => { jid = e.changedTouches[0].identifier; e.preventDefault(); }, { passive: false });
  joy.addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === jid) { const r = joy.getBoundingClientRect(), x = (t.clientX - r.left - r.width / 2) / (r.width / 2), y = (t.clientY - r.top - r.height / 2) / (r.height / 2), l = Math.hypot(x, y) || 1, k = Math.min(1, l); inp.joy = { x: x / l * k, y: y / l * k }; joy.firstElementChild.style.transform = `translate(${inp.joy.x * 40}px,${inp.joy.y * 40}px)`; } e.preventDefault(); }, { passive: false });
  const end = e => { inp.joy = null; jid = null; joy.firstElementChild.style.transform = ''; }; joy.addEventListener('touchend', end); joy.addEventListener('touchcancel', end);
  addEventListener('touchstart', e => { for (const t of e.changedTouches) if (t.clientX > innerWidth * .4 && !e.target.closest('.tb') && lid == null) { lid = t.identifier; lx = t.clientX; ly = t.clientY; } }, { passive: true });
  addEventListener('touchmove', e => { for (const t of e.changedTouches) if (t.identifier === lid) { cam.yaw -= (t.clientX - lx) * .006; cam.pitch = clamp(cam.pitch + (t.clientY - ly) * .005, -.75, 1.1); lx = t.clientX; ly = t.clientY; } }, { passive: true });
  addEventListener('touchend', e => { for (const t of e.changedTouches) if (t.identifier === lid) lid = null; });
  document.querySelectorAll('.tb').forEach(b => { const k = b.dataset.k; b.addEventListener('touchstart', e => { e.preventDefault(); if (k === 'fire') inp.fire = 1; if (k === 'roll') inp.rollHit = 1; if (k === 'use') interactPress(); if (k === 'heal') G.player && G.player.drink(); }, { passive: false }); b.addEventListener('touchend', () => { if (k === 'fire') inp.fire = 0; }); });
})();

// ================= UI bridge =================
let capTimer = null, bannerT = null, toastBox = [];
const ui = {
  caption(lines, label = '', gap = 4) {
    clearTimeout(capTimer); const el = $('cap'); let i = 0;
    const next = () => { if (i >= lines.length) { el.classList.remove('on'); return; } el.innerHTML = (label ? `<small>${label}</small>` : '') + lines[i++]; el.classList.add('on'); capTimer = setTimeout(next, gap * 1000); };
    next();
  },
  banner(t, s = '') { const b = $('banner'); b.innerHTML = t + (s ? `<small>${s}</small>` : ''); b.classList.add('on'); clearTimeout(bannerT); bannerT = setTimeout(() => b.classList.remove('on'), 2800); },
  objectives(St) {
    const ul = $('obj-l'); ul.innerHTML = '';
    for (const o of St.objs) { const li = document.createElement('li'); li.textContent = o.text; if (o.done) li.classList.add('done'); if (o.gone) li.classList.add('gone'); ul.appendChild(li); }
  },
  marker(m) {
    const el = $('mark'); const p = G.player; if (!m || !p) { el.style.display = 'none'; return; }
    const v = new THREE.Vector3(m.x, 2.4, m.z).project(camera); const behind = v.z > 1;
    let x = (v.x * .5 + .5) * innerWidth, y = (-v.y * .5 + .5) * innerHeight; if (behind) { x = innerWidth - x; y = innerHeight - 60; }
    x = clamp(x, 40, innerWidth - 40); y = clamp(y, 60, innerHeight - 90); el.style.display = 'block'; el.style.left = x + 'px'; el.style.top = y + 'px';
    $('markd').textContent = `${m.label ? m.label + ' · ' : ''}${Math.round(Math.hypot(m.x - p.x, m.z - p.z))}m`;
  },
  boss(b) { G.bossUI = b; $('bossbar').style.display = b ? 'block' : 'none'; if (b) $('bossname').textContent = b.name; },
  chapterIntro(info, ch) { S.title = info.name; $('obj-ch').textContent = `Chapter ${ch}`; $('obj-t').textContent = info.name; },
  missionDone(name) { ui.banner('Mission complete', name); Snd.play('bell', { vol: .8 }); },
  toast(t) { const d = document.createElement('div'); d.textContent = t; $('feed').appendChild(d); setTimeout(() => d.remove(), 4500); },
};
G.ui = ui; G.hooks.toast = ui.toast;
G.hooks.playerHurt = () => { $('hurt').style.opacity = 1; setTimeout(() => $('hurt').style.opacity = 0, 250); };
G.hooks.playerDied = ctx => { if (G.mp) mpDied(ctx); else setTimeout(() => { if (G.mode === 'play') { G.mode = 'over'; document.exitPointerLock?.(); $('over-txt').textContent = S.ch ? `Chapter ${S.ch}: ${D.CHAPTERS[S.ch].name}. The dark remembers you.` : 'The arena claims another tribute.'; show('s-over'); hud(false); } }, 2600); };
G.hooks.botDied = (b, ctx) => { if (G.mp && !G.mp.net) mpKill(ctx && ctx.from, b); Story.bind && S.ch === 3 && S.step === 1 && !b.ally && S.resolved++; };
G.hooks.botYield = b => { ui.toast(`${b.name} of ${b.region.name} yields`); ui.caption([`${b.name} drops the bow and kneels.`], '', 2.5); };
G.hooks.bossPhase = b => { ui.banner(b.name, 'Enraged'); Snd.play('abbessScream', { vol: .8 }); };
G.hooks.hit = () => { const c = $('cross'); c.style.transform = 'scale(1.5)'; setTimeout(() => c.style.transform = '', 80); Snd.play('bell', { vol: .07, rate: 2.4 }); };
G.hooks.shot = (o, d, a) => { if (G.mp && G.mp.net) G.mp.net.send({ t: 'shot', o: [o.x, o.y, o.z], d: [d.x, d.y, d.z], sp: a.speed, burn: a.burn }); };
G.hooks.abbessSummon = b => { for (let i = 0; i < 4; i++) { const a = rand(0, 6.28), r = rand(3, 7); const e = new Enemy('risen', b.x + Math.sin(a) * r, b.z + Math.cos(a) * r, { hp: 40 }); G.enemies.push(e); } };
G.hooks.beaconDown = t => { ui.toast('A beacon falls dark'); };
G.finish = k => { G.mode = 'end'; document.exitPointerLock?.(); const [t, txt] = D.ENDINGS[k]; $('end-title').innerHTML = t; $('end-txt').innerHTML = `${txt}<br><br><small style="color:#8d8a84;letter-spacing:.2em">${S.sel.region.name} · ${S.sel.tribute.name} · tributes spared: ${S.allies.length}</small>`; hud(false); fadeTo(() => show('s-end')); store({ ...(saved || {}), done: true }); };
G.chapterDone = ch => {
  const next = ch + 1; store({ ch: next, region: sel.region.id, tribute: sel.tribute.id, allies: S.sel.allies || [] });
  setTimeout(async () => {
    if (G.mode !== 'play' || G.mp) return;
    if (ch < 3) { await Story.startChapter(next, { ...S.sel, ...{ region: sel.region, tribute: sel.tribute } }, true); }
    else { fadeTo(async () => { ui.caption(['The Victor\'s train leaves at dawn.'], '', 3); await Story.startChapter(4, { region: sel.region, tribute: sel.tribute, allies: S.sel.allies || [] }); }); }
  }, 4200);
};
function fadeTo(fn, ms = 900) { const f = $('fade'); f.style.opacity = 1; setTimeout(async () => { await fn(); setTimeout(() => f.style.opacity = 0, 150); }, ms); }

// ================= flow =================
const prev = { actor: null, t: 0 };
async function boot() {
  initPost();
  A.setProgress((f, l) => { $('lbar').style.width = Math.round(f * 100) + '%'; $('ltxt').textContent = l; });
  await A.load(['tribute']); await buildStage();
  prev.actor = new A.Actor('tribute'); scene.add(prev.actor.root); applyPreview(); prev.actor.play('idle');
  // the rest streams in while the menu is open
  A.load(['risen', 'stitched', 'abbess', 'stonehorn']);
  $('lbar').style.width = '100%'; setTimeout(() => { show('s-title'); G.mode = 'menu'; }, 300);
  $('b-cont').style.display = saved && saved.ch && saved.ch <= 4 ? '' : 'none';
  requestAnimationFrame(loop);
}
function applyPreview() { if (prev.actor) dress(prev.actor, sel.region, sel.tribute); }
const go = (id, mode) => { show(id); G.mode = mode; };
$('b-story').onclick = () => { pickFor = 'story'; Snd.init(); Snd.setMusic('menu', .7); buildRegions(); go('s-region', 'menu'); };
$('b-cont').onclick = async () => { Snd.init(); sel.region = D.REGIONS.find(r => r.id === saved.region) || D.REGIONS[0]; sel.tribute = D.TRIBUTES.find(t => t.id === saved.tribute) || D.TRIBUTES[0]; await beginStory(Math.min(4, saved.ch || 1), saved.allies || []); };
let pickFor = 'story';
const mpWho = () => { $('mp-who').innerHTML = `Playing as <b style="color:${sel.region.color}">${sel.tribute.name} of ${sel.region.name}</b>`; };
$('b-mp').onclick = () => { Snd.init(); mpWho(); go('s-mp', 'menu'); $('mp-msg').textContent = ''; };
$('mp-pick').onclick = () => { pickFor = 'mp'; buildRegions(); go('s-region', 'menu'); };
$('b-help').onclick = () => go('s-help', 'menu'); $('h-back').onclick = () => go('s-title', 'menu');
let audioBack = 's-title', audioMode = 'menu';
const syncAudioUI = () => { for (const k of ['master', 'music', 'sfx']) $('v-' + k).value = Snd.vol[k]; $('v-mute').checked = Snd.muted; };
for (const k of ['master', 'music', 'sfx']) $('v-' + k).oninput = e => { Snd.init(); Snd.setVol(k, +e.target.value); if (k === 'sfx') Snd.play('twang', { vol: .6 }); };
$('v-mute').onchange = e => { Snd.init(); if (Snd.muted !== e.target.checked) Snd.toggle(); };
$('b-audio').onclick = () => { audioBack = 's-title'; audioMode = 'menu'; syncAudioUI(); go('s-audio', 'menu'); };
$('p-audio').onclick = () => { audioBack = 's-pause'; audioMode = 'pause'; syncAudioUI(); show('s-audio'); };
$('a-back').onclick = () => { show(audioBack); G.mode = audioMode; };
$('mp-back').onclick = () => go('s-title', 'menu');
$('r-back').onclick = () => { if (pickFor === 'mp') { pickFor = 'story'; mpWho(); go('s-mp', 'menu'); } else go('s-title', 'menu'); }; $('r-next').onclick = () => { buildTributes(); go('s-tribute', 'menu'); $('t-go').textContent = pickFor === 'mp' ? 'Confirm →' : 'Begin →'; };
$('t-back').onclick = () => go('s-region', 'menu'); $('t-go').onclick = () => { if (pickFor === 'mp') { pickFor = 'story'; mpWho(); go('s-mp', 'menu'); } else beginStory(1, []); };
function buildRegions() {
  const box = $('regions'); box.innerHTML = '';
  D.REGIONS.forEach(r => { const d = document.createElement('div'); d.className = 'card' + (r === sel.region ? ' sel' : ''); d.style.setProperty('--c', r.color); d.innerHTML = `<div class="n">${r.name}</div><div class="t">${r.tag}</div><div class="p">${r.perk} — ${r.desc}</div>`; d.onclick = () => { sel.region = r; applyPreview(); $('regionlead').textContent = r.line; box.querySelectorAll('.card').forEach(c => c.classList.toggle('sel', c === d)); Snd.play('bell', { vol: .15, rate: 1.5 }); }; box.appendChild(d); });
  $('regionlead').textContent = sel.region.line;
}
function buildTributes() {
  const box = $('tributes'); box.innerHTML = ''; $('tlead').textContent = `${sel.region.name} sends a tribute. Who stands in the dark?`;
  D.TRIBUTES.forEach(t => { const d = document.createElement('div'); d.className = 'tcard' + (t === sel.tribute ? ' sel' : ''); d.innerHTML = `<div class="sw"><i style="background:${t.skin}"></i><i style="background:${t.cloth}"></i><i style="background:${sel.region.color}"></i></div><div class="n">${t.name}</div>`; d.onclick = () => { sel.tribute = t; applyPreview(); $('tinfo').textContent = t.blurb; box.querySelectorAll('.tcard').forEach(c => c.classList.toggle('sel', c === d)); }; box.appendChild(d); });
  $('tinfo').textContent = sel.tribute.blurb;
}

async function beginStory(ch, allies) {
  G.mp = null; $('killsw').style.display = ''; $('allyw').style.display = '';
  show('loading'); $('ltxt').textContent = 'Entering the Hollow…'; $('lbar').style.width = '30%';
  const kinds = ['tribute', 'risen', 'stitched']; if (ch >= 2) kinds.push('abbess'); if (ch >= 3) kinds.push('stonehorn');
  await A.load(kinds); S.hollowReady = false;
  clearActors(); G.kills = 0; G.alliesNow = allies.length; Story.bind(); S.retry = false;
  const fade = $('fade'); fade.style.opacity = 1;
  const full = { region: sel.region, tribute: sel.tribute, allies: allies.slice() };
  S.sel = full; S.allies = full.allies;
  await Story.startChapter(ch, full);
  store({ ch, region: sel.region.id, tribute: sel.tribute.id, allies: full.allies });
  prev.actor.root.visible = false; show(''); hud(true); G.mode = 'play'; lock(); setTimeout(() => fade.style.opacity = 0, 100);
  $('cross').style.display = ''; setTimeout(() => lock(), 300);
}
function pause(on) {
  if (G.mode !== 'play' && G.mode !== 'pause') return;
  if (on) { G.mode = 'pause'; show('s-pause'); document.exitPointerLock?.(); inp.fire = inp.aim = 0; } else { G.mode = 'play'; show(''); lock(); }
}
$('p-res').onclick = () => pause(false);
const toMenu = () => { G.mp && G.mp.net && G.mp.net.close(); G.mp = null; G.net = null; clearActors(); G.mode = 'menu'; hud(false); show('s-title'); document.exitPointerLock?.(); prev.actor.root.visible = true; buildStage().then(() => { scene.add(prev.actor.root); }); Snd.setMusic('menu', .7); S.hollowReady = false; S.ch = 0; $('b-cont').style.display = saved && saved.ch ? '' : 'none'; if (G.player) { G.player.dispose(); G.player = null; } $('hpf').style.width = '100%'; };
$('p-quit').onclick = toMenu; $('o-quit').onclick = toMenu; $('e-quit').onclick = toMenu;
$('o-retry').onclick = async () => { show('loading'); const ch = S.ch; S.retry = true; clearActors(); S.hollowReady = false; await Story.startChapter(ch, S.sel); show(''); hud(true); G.mode = 'play'; lock(); };

// ================= interaction =================
let holdT = 0, curIt = null;
function interactPress() { if (curIt && !curIt.hold) { curIt.fn(); curIt = null; } }
function updateInteract(dt) {
  const p = G.player; if (!p) return;
  curIt = Story.nearby(p); const pr = $('prompt');
  if (curIt) { pr.style.display = 'block'; pr.innerHTML = `<b>E</b>${curIt.text}${curIt.hold ? ' (hold)' : ''}`; }
  else pr.style.display = 'none';
  if (curIt && curIt.hold && keys.KeyE) { holdT += dt; pr.innerHTML = `<b>E</b>${curIt.text} ${'▮'.repeat(Math.floor(holdT / curIt.hold * 8))}${'▯'.repeat(8 - Math.floor(holdT / curIt.hold * 8))}`; if (holdT >= curIt.hold) { curIt.fn(); holdT = 0; } } else holdT = 0;
}

// ================= multiplayer arena =================
const mp = {
  net: null, players: new Map(), time: 0, over: false, scores: {}, kills: new Map(), myKills: 0, deaths: 0, start: 0, limit: 15, respawnT: 0,
};
function code4() { return Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(''); }
$('mp-host').onclick = async () => {
  const m = $('mp-msg'); m.textContent = 'Opening a room…'; mp.net = new Net();
  try { const code = code4(); await mp.net.host(code); wireNet(); lobby(true, code); } catch (e) { m.textContent = e.message; mp.net = null; }
};
$('mp-join').onclick = async () => {
  const code = $('mp-code').value.trim().toUpperCase(); const m = $('mp-msg'); if (code.length !== 4) { m.textContent = 'Enter the 4-letter room code.'; return; }
  m.textContent = 'Joining…'; mp.net = new Net();
  try { await mp.net.join(code); wireNet(); lobby(false, code); mp.net.send({ t: 'hello', name: sel.tribute.name, region: sel.region.id, tribute: sel.tribute.id }); } catch (e) { m.textContent = e.message; mp.net = null; }
};
$('mp-skirm').onclick = () => startMatch(null, true);
$('lb-back').onclick = () => { mp.net && mp.net.close(); mp.net = null; go('s-mp', 'menu'); };
$('lb-start').onclick = () => { if (mp.net && mp.net.isHost) { mp.net.send({ t: 'start' }); startMatch(mp.net, false); } };
const roster = new Map(); // id -> {name, region, tribute}
function lobby(isHost, code) {
  show('s-lobby'); G.mode = 'menu'; roster.clear(); roster.set(mp.net.id, { name: sel.tribute.name, region: sel.region.id, tribute: sel.tribute.id });
  $('lobby-title').textContent = isHost ? 'Your arena' : 'Joined arena'; $('lobby-code').innerHTML = `Room code <b style="font-family:Creepster;font-size:44px;letter-spacing:.3em;color:#c9a24b">${code}</b>`;
  $('lb-start').style.display = isHost ? '' : 'none'; drawLobby();
}
function drawLobby() { $('lobby-list').innerHTML = [...roster.values()].map(r => { const rg = D.REGIONS.find(x => x.id === r.region); return `<div><span>${r.name}</span><span style="color:${rg.color}">${rg.name}</span></div>`; }).join(''); }
function wireNet() {
  const n = mp.net;
  n.on('hello', (m, from) => { roster.set(from, { name: m.name, region: m.region, tribute: m.tribute }); if (G.mp) addRemote(from, m); drawLobby(); });
  n.on('peer+', (m, from) => { n.send({ t: 'roster', to: from, list: [...roster.entries()].map(([id, r]) => ({ id, ...r })) }); });
  n.on('roster', m => { for (const r of m.list) roster.set(r.id, r); drawLobby(); });
  n.on('left', m => { roster.delete(m.id); const r = G.remotes.get(m.id); if (r) { r.dispose(); G.remotes.delete(m.id); ui.toast('A tribute left the arena'); } drawLobby(); });
  n.on('start', () => startMatch(n, false));
  n.on('st', (m, from) => { const r = G.remotes.get(from); if (r) r.set(m); });
  n.on('shot', (m, from) => { const r = G.remotes.get(from); if (r) { r.shootT = .4; r.actor.play('shoot', .05, 1.6); } spawnArrow(new THREE.Vector3(...m.o), new THREE.Vector3(...m.d), { speed: m.sp, owner: r, team: r ? r.team : '', burn: m.burn, visualOnly: true, grav: m.g ?? 9 }); Snd.play('twang', { at: r || m, vol: .6 }); });
  n.on('dmg', (m, from) => { if (m.to === n.id && G.player && G.player.alive) { G.lastHit = { from: m.by, team: m.byRegion, id: from }; G.player.hurt(m.d * (m.head ? 1 : 1), { from: { team: m.byRegion }, head: m.head }); } });
  n.on('kill', m => mpScore(m));
  n.on('drop', m => { spawnDrop(m.x, m.z, m.id); });
  n.on('closed', () => { ui.toast('Host closed the room'); toMenu(); });
}
function addRemote(id, m) {
  if (G.remotes.has(id)) return; const reg = D.REGIONS.find(r => r.id === m.region) || D.REGIONS[0], tr = D.TRIBUTES.find(t => t.id === m.tribute) || D.TRIBUTES[0];
  const r = new Remote(id, reg, tr, m.name); G.remotes.set(id, r); ui.toast(`${m.name} of ${reg.name} entered the arena`);
}
async function startMatch(net, skirmish) {
  show('loading'); $('ltxt').textContent = 'Opening the colosseum…'; $('lbar').style.width = '50%';
  await A.load(['tribute']); clearActors(); G.story = false; G.pvp = true; G.mp = mp; mp.net = net; G.net = net; mp.over = false; mp.scores = {}; mp.myKills = 0; mp.deaths = 0; mp.time = 0; mp.kills = new Map(); mp.respawnT = 0;
  await buildCapital(); world.surface = 'stone'; for (const b of lv.beacons) { b.lamp.on = true; }
  const sp = lv.spawnPoints[Math.floor(Math.random() * lv.spawnPoints.length)];
  const player = new Player(sel.region, sel.tribute, sp.x, sp.z, Math.atan2(-sp.x, -sp.z)); G.player = player; cam.yaw = player.ry;
  G.beaconTargets = []; G.kills = 0; $('killsw').style.display = ''; $('allyw').style.display = 'none'; Story.bind(); S.ch = 0; S.objs = []; ui.objectives(S); $('obj-ch').textContent = skirmish ? 'Skirmish' : 'Region War'; $('obj-t').textContent = 'First region to 15 kills'; S.marker = null;
  if (skirmish) { for (let i = 0; i < 5; i++) mpBot(); } else { for (const [id, r] of roster) if (id !== net.id) addRemote(id, r); mpDropTimer = 0; }
  prev.actor.root.visible = false; show(''); hud(true); G.mode = 'play'; Snd.setMusic('boss', .55); ui.banner('Region War', 'Fight for your banner'); Snd.play('cannon', { vol: .8 });
  lock(); $('cross').style.display = '';
}
function mpBot() { const reg = pick(D.REGIONS.filter(r => r.id !== sel.region.id || Math.random() < .2)), t = pick(D.TRIBUTES), a = pick(lv.spawnPoints); const b = new Bot(reg, t, a.x, a.z, { name: pick(D.RIVAL_NAMES), skill: .5 + Math.random() * .3 }); G.bots.push(b); }
let mpDropTimer = 0, netT = 0;
function mpScore(m) {
  mp.scores[m.reg] = (mp.scores[m.reg] || 0) + 1; const pk = mp.kills.get(m.who) || { k: 0, d: 0, reg: m.reg, name: m.who }; pk.k++; mp.kills.set(m.who, pk); const v = mp.kills.get(m.victim) || { k: 0, d: 0, reg: m.vreg, name: m.victim }; v.d++; mp.kills.set(m.victim, v);
  ui.toast(`${m.who} ▸ ${m.victim}`); if (mp.scores[m.reg] >= mp.limit && !mp.over) mpEnd(m.reg);
}
function mpKill(from, victim) { if (!G.mp || G.mp.net) return; const who = from && from.name ? from.name : 'The arena', reg = from && from.team ? from.team : '', k = { who, reg, victim: victim.name, vreg: victim.team }; mpScore(k); }
function mpDied(ctx) {
  mp.deaths++; const by = G.lastHit || (ctx && ctx.from ? { from: ctx.from.name, team: ctx.from.team } : { from: 'The arena', team: '' });
  const k = { t: 'kill', who: by.from, reg: by.team, victim: G.player.name, vreg: G.player.team };
  if (mp.net) { mp.net.send(k); } mpScore(k); G.lastHit = null; mp.respawnT = 4;
  ui.caption(['You were defeated. Respawning…'], '', 3.5);
}
function mpEnd(reg) { mp.over = true; const r = D.REGIONS.find(x => x.id === reg); ui.banner(`${r ? r.name : 'Nobody'} wins`, 'The Region War is over'); document.exitPointerLock?.(); setTimeout(() => { G.mode = 'end'; $('end-title').innerHTML = `${r ? r.name : 'Nobody'} <b>prevails</b>`; $('end-txt').innerHTML = scoreHTML(); hud(false); show('s-end'); }, 3500); }
function scoreHTML() {
  const rows = D.REGIONS.filter(r => mp.scores[r.id]).sort((a, b) => mp.scores[b.id] - mp.scores[a.id]).map(r => `<tr><td style="color:${r.color}">${r.name}</td><td>${mp.scores[r.id]}</td></tr>`).join('');
  const ps = [...mp.kills.values()].sort((a, b) => b.k - a.k).map(p => { const r = D.REGIONS.find(x => x.id === p.reg); return `<tr><td>${p.name}</td><td style="color:${r ? r.color : '#aaa'}">${r ? r.name : ''}</td><td>${p.k}</td><td>${p.d}</td></tr>`; }).join('');
  return `<table style="margin:auto"><tr><th>REGION</th><th>KILLS</th></tr>${rows}</table><br><table style="margin:auto"><tr><th>TRIBUTE</th><th>REGION</th><th>K</th><th>D</th></tr>${ps}</table>`;
}
function showScore(on) { const s = $('score'); if (!on || !G.mp) { s.style.display = 'none'; return; } s.innerHTML = `<h2 style="text-align:center">Region War</h2>${scoreHTML()}`; s.style.display = 'block'; }
function mpUpdate(dt) {
  mp.time += dt;
  if (mp.respawnT > 0 && G.player && !G.player.alive) { mp.respawnT -= dt; if (mp.respawnT <= 0) { const sp = pick(lv.spawnPoints); const p = G.player; p.alive = true; p.dead = false; p.hp = p.max; p.x = sp.x; p.z = sp.z; p.ry = Math.atan2(-sp.x, -sp.z); cam.yaw = p.ry; p.ammo = p.ammoMax; p.invT = 2.5; p.actor.play('idle', .1); } }
  if (G.player && mp.net) { netT -= dt; if (netT <= 0) { netT = 1 / 15; const p = G.player; mp.net.send({ t: 'st', x: p.x, z: p.z, r: p.ry, hp: p.hp, s: p.alive ? 'live' : 'dead', a: p.rollT > 0 ? 'roll' : '' }); } }
  if (G.player && !mp.net) { // skirmish: keep the arena stocked
    mpDropTimer += dt; if (mpDropTimer > 35) { mpDropTimer = 0; const a = rand(0, 6.28), r = rand(2, 9); spawnDrop(Math.sin(a) * r * .8, Math.cos(a) * r * 1.3); }
    if (G.bots.filter(b => b.alive).length < 4 && mp.time % 6 < dt) mpBot();
  } else if (mp.net && mp.net.isHost) { mpDropTimer += dt; if (mpDropTimer > 35) { mpDropTimer = 0; const a = rand(0, 6.28), r = rand(2, 9), x = Math.sin(a) * r * .8, z = Math.cos(a) * r * 1.3; mp.net.send({ t: 'drop', x, z }); spawnDrop(x, z); } }
}

// ================= frame =================
let last = performance.now(), T = 0; const _v = new THREE.Vector3();
function updateCamera(dt) {
  const p = G.player; if (!p) return;
  const aim = p.aimMode, tgtDist = aim ? 1.9 : 3.5, sh = aim ? .8 : .6;
  cam.dist = lerp(cam.dist, tgtDist, 1 - Math.exp(-10 * dt)); cam.shoulder = lerp(cam.shoulder, sh, 1 - Math.exp(-10 * dt));
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * cp, -sp, Math.cos(cam.yaw) * cp), right = new THREE.Vector3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
  const T0 = new THREE.Vector3(p.x, 1.55 - (p.alive ? 0 : .8), p.z).addScaledVector(right, cam.shoulder);
  let d = cam.dist; const pos = new THREE.Vector3();
  for (let t = d; t > .4; t -= .25) { pos.copy(T0).addScaledVector(dir, -t); if (pos.y < .35) { pos.y = .35; } let hit = false; for (const c of world.colliders) { if (c.on === false || c.low) continue; if (c.t === 'b' ? (pos.x > c.x0 - .2 && pos.x < c.x1 + .2 && pos.z > c.z0 - .2 && pos.z < c.z1 + .2) : ((pos.x - c.x) ** 2 + (pos.z - c.z) ** 2 < (c.r + .2) ** 2)) { hit = true; break; } } if (!hit) { d = t; break; } d = t; }
  pos.copy(T0).addScaledVector(dir, -d); pos.y = Math.max(pos.y, .3);
  const sk = G.shake > .01 ? G.shake : 0; if (sk) { pos.x += (Math.random() - .5) * sk * .12; pos.y += (Math.random() - .5) * sk * .12; pos.z += (Math.random() - .5) * sk * .12; }
  camera.position.copy(pos); camera.lookAt(pos.clone().add(dir)); cam.pos.copy(pos); cam.dir.copy(dir);
  const fov = aim ? 48 : (p.speed > 5.5 ? 68 : 62); cam.smoothFov = lerp(cam.smoothFov, fov, 1 - Math.exp(-6 * dt)); camera.fov = cam.smoothFov; camera.updateProjectionMatrix();
  Snd.listener.x = p.x; Snd.listener.z = p.z;
}
function updateHUD(dt) {
  const p = G.player; if (!p) return;
  $('hpf').style.width = (p.hp / p.max * 100) + '%'; $('stf').style.width = p.stam + '%'; $('ammo').textContent = p.ammo; $('pots').textContent = p.pots; $('kills').textContent = G.kills; $('allies').textContent = (G.alliesNow || 0);
  if (G.alliesNow > 0 && !G.mp) $('allyw').style.display = '';
  const dr = $('draw'); if (p.drawing) { dr.style.opacity = 1; dr.style.borderColor = 'rgba(232,226,212,.55)'; dr.style.transform = `scale(${1.15 + Math.min(.5, Math.max(0, p.fireCd || 0) * 2)})`; } else dr.style.opacity = 0;
  if (G.bossUI) $('bossfill').style.width = Math.max(0, G.bossUI.hp / G.bossUI.max * 100) + '%';
  G.hurt = Math.max(0, (G.hurt || 0) - dt * 1.5);
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt; G.time = T;
  sky.material.uniforms.t.value = T; sky.position.copy(camera.position);
  const mode = G.mode;
  if (mode === 'play' || mode === 'over' || mode === 'end') {
    const p = G.player;
    if (mode === 'play') {
      inp.rollHit = inp.rollHit; if (p) p.update(dt, inp, cam); inp.rollHit = 0;
      Story.update(dt); updateActors(dt); if (G.mp) mpUpdate(dt); updateInteract(dt);
    } else { updateActors(dt); if (p) p.update(dt, {}, cam); }
    updateCamera(dt); updateHUD(dt);
    if (p) { lantern.position.set(p.x, 2.3, p.z); lantern.intensity = 46 + Math.sin(T * 13) * 2.5 + Math.sin(T * 5.1) * 2; updateLamps(p.x, p.z, T); updateMotes(p.x, p.z, T);
      const mdir = new THREE.Vector3(-.45, .5, -.74).normalize(); moon.position.set(p.x + mdir.x * 70, mdir.y * 70, p.z + mdir.z * 70); moon.target.position.set(p.x, 0, p.z); }
  } else if (mode === 'menu' || mode === 'loading') {
    prev.t += dt; const a = Math.sin(prev.t * .35) * .5; camera.position.set(Math.sin(a) * 3.0, 1.25, Math.cos(a) * 3.0); camera.lookAt(-.95, 1.0, 0); camera.fov = 46; camera.updateProjectionMatrix();
    prev.actor.update(dt); lantern.position.set(1.6, 2.0, 2.2); lantern.intensity = 46; lantern.color.set(0xffd2a0); updateLamps(0, 0, T); updateMotes(0, 0, T); moon.position.set(-30, 40, -50); moon.target.position.set(0, 0, 0);
    const rim = lightPool[4]; rim.position.set(-1.8, 2.3, -2.4); rim.color.set(0x6f94ff); rim.intensity = 55; rim.distance = 12;
  }
  if ((G.frame = (G.frame || 0) + 1) % 180 === 0) for (let i = fires.length - 1; i >= 0; i--) { let o = fires[i]; while (o.parent) o = o.parent; if (o !== scene) fires.splice(i, 1); }
  for (const f of fires) { const d = f.getWorldPosition(_v).distanceTo(camera.position); f.material.opacity = clamp((d - 2) / 5, 0, 1) * f.userData.base; }
  updateParticles(dt); G.shake = Math.max(0, G.shake - dt * 3);
  fxPass.uniforms.t.value = T; fxPass.uniforms.hurt.value = Math.max(G.hurt || 0, 0) * .8; fxPass.uniforms.low.value = G.player && G.player.alive && mode === 'play' ? clamp(1 - G.player.hp / G.player.max * 2.2, 0, 1) : 0;
  fxPass.uniforms.aspect.value = innerWidth / innerHeight; fxPass.uniforms.desat.value = G.player && !G.player.alive ? .8 : 0;
  composer.render();
}
window.__g = { G, S, sel, cam, inp, Story, D, A, mp, lv, scene, world, beginStory, pause };
boot().catch(e => { console.error(e); $('ltxt').textContent = 'Failed to load: ' + e.message; });
