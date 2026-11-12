import * as THREE from 'three';
import * as A from './assets.js';
import { scene, world, lamps, clearWorld, sky, mulberry, rand, moon, hemi } from './core.js';

const R = mulberry(20260);
export const lv = { kind: '', gates: {}, braziers: [], beacons: [], arena: null, fire: [] };
export const fires = []; // additive flame sprites; they fade as the camera gets close so they never white out the screen

// ---------- helpers ----------
let glowTex;
function glow() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.3, 'rgba(255,200,120,.7)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64); glowTex = new THREE.CanvasTexture(c); return glowTex;
}
export function fireSprite(color = 0xffa040, size = 1.4) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  m.scale.set(size, size * 1.5, 1); m.userData.base = .62; fires.push(m); return m;
}
const boxOf = o => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
export function place(name, x, z, { h, w, rot = 0, col = null, r = 1, shrink = .85, y = 0, tint, emissive, parent } = {}) {
  const o = A.prop(name, { h, w, rotY: rot, tint, emissive });
  o.position.set(x, y, z); (parent || world.group).add(o);
  if (col === 'box') { const b = boxOf(o), cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, hx = (b.max.x - b.min.x) / 2 * shrink, hz = (b.max.z - b.min.z) / 2 * shrink; world.colliders.push({ t: 'b', x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz }); }
  else if (col === 'circle') world.colliders.push({ t: 'c', x, z, r });
  return o;
}
function spread(name, n, area, opt, ok = () => true) {
  const placed = []; let tries = 0;
  while (placed.length < n && tries++ < n * 40) {
    const x = rand(area.x0, area.x1), z = rand(area.z0, area.z1), gap = opt.gap ?? 4;
    if (!ok(x, z) || placed.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap)) continue;
    const hh = opt.h ? (Array.isArray(opt.h) ? rand(opt.h[0], opt.h[1]) : opt.h) : undefined;
    const ww = opt.w ? (Array.isArray(opt.w) ? rand(opt.w[0], opt.w[1]) : opt.w) : undefined;
    place(name, x, z, { h: hh, w: ww, rot: rand(0, 6.28), col: opt.col, r: opt.r, tint: opt.tint, shrink: opt.shrink }); placed.push({ x, z });
  }
  return placed;
}
function groundPlane(w, d, cx, cz, tex, repeat, color = 0xffffff) {
  const geo = new THREE.PlaneGeometry(w, d); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color, map: A.texture(tex + '_diff'), normalMap: A.texture(tex + '_nor_gl', false), roughnessMap: A.texture(tex + '_rough', false), roughness: 1 });
  for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) { t.repeat.set(w / repeat, d / repeat); }
  const m = new THREE.Mesh(geo, mat); m.position.set(cx, 0, cz); m.receiveShadow = true; world.group.add(m); return m;
}
function setAtmosphere(fog, density, hor, exposure = 1.05) {
  scene.fog = new THREE.FogExp2(new THREE.Color(fog).multiplyScalar(2.2), density * .55); scene.background = null;
  sky.material.uniforms.hor.value.set(hor); sky.material.uniforms.mid.value.set(fog).multiplyScalar(1.2);
}

// ---------- gates, braziers, beacons ----------
function makeGate(x, z, width, label) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const stone = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: .9 }), iron = new THREE.MeshStandardMaterial({ color: 0x15151a, roughness: .5, metalness: .8 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7, 1.6), stone); p.position.set(s * (width / 2 + .8), 3.5, 0); p.castShadow = true; g.add(p); const t = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 4), stone); t.position.set(s * (width / 2 + .8), 7.7, 0); t.rotation.y = Math.PI / 4; g.add(t); }
  const bars = new THREE.Group(); const n = Math.round(width / .55);
  for (let i = 0; i <= n; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(.07, .07, 6.2, 6), iron); b.position.set(-width / 2 + i * width / n, 3.1, 0); b.castShadow = true; bars.add(b); const sp = new THREE.Mesh(new THREE.ConeGeometry(.12, .4, 6), iron); sp.position.set(b.position.x, 6.4, 0); bars.add(sp); }
  for (const y of [1, 4.5]) { const r = new THREE.Mesh(new THREE.BoxGeometry(width, .16, .16), iron); r.position.set(0, y, 0); bars.add(r); }
  g.add(bars); world.group.add(g);
  const col = { t: 'b', x0: x - width / 2 - 1.6, x1: x + width / 2 + 1.6, z0: z - .6, z1: z + .6, on: true };
  world.colliders.push(col);
  const gate = { group: g, bars, col, open: false, t: 0, z };
  lamps.push({ x: x - width / 2 - 1.2, y: 4, z: z + 1.5, color: 0xff3b2a, power: 12, dist: 9, flicker: .3 });
  return gate;
}
export function updateGate(gate, dt) { if (gate.open && gate.t < 1) { gate.t = Math.min(1, gate.t + dt * .35); gate.bars.position.y = -gate.t * 6.6; if (gate.t > .55) gate.col.on = false; } }

function makeBrazier(x, z, big = false) {
  const o = place('brazier', x, z, { h: big ? 2.4 : 1.5, col: 'circle', r: big ? 1.1 : .7 });
  const f = fireSprite(0xff8a30, big ? 3 : 2); f.position.set(x, (big ? 2.5 : 1.6), z); f.visible = false; world.group.add(f);
  const lamp = { x, y: 2, z, color: 0xff8a3a, power: big ? 46 : 34, dist: 20, flicker: .22, on: false };
  lamps.push(lamp);
  const b = { x, z, obj: o, fire: f, lit: false, lamp, big, ember: [] };
  b.light = () => { b.lit = true; f.visible = true; lamp.on = true; };
  return b;
}

// ---------- Hollow: Lane → Cemetery → Heart ----------
export async function buildHollow(region) {
  clearWorld(); fires.length = 0; lv.kind = 'hollow'; lv.gates = {}; lv.braziers = []; lv.beacons = [];
  await A.loadProps(['ruined', 'tree', 'lantern', 'tombstones', 'gravestones', 'candlegraves', 'angel', 'hearse', 'brazier', 'skulls', 'columns', 'spearrack', 'crate', 'parachute']);
  world.bound = { t: 'rect', x0: -36, x1: 36, z0: -394, z1: 9 };
  setAtmosphere(region.fog, .021, 0x1d2634);
  moon.color.set(0xa9bcff); moon.intensity = 2.1; hemi.intensity = 1.7;
  const Z = { laneEnd: -148, cemEnd: -300 };
  const g = groundPlane(160, 440, 0, -190, 'brown_mud_leaves_01', 7, 0x8a7f78);
  groundPlane(6.4, 150, 0, -75, 'cobblestone_floor_08', 3, 0x5a5c68).position.y = .02;
  groundPlane(5.4, 170, 0, -226, 'cobblestone_floor_08', 3, 0x484a56).position.y = .02;
  // a clearing at the heart
  const disc = new THREE.Mesh(new THREE.CircleGeometry(42, 48), new THREE.MeshStandardMaterial({ map: A.texture('castle_wall_slates_diff'), normalMap: A.texture('castle_wall_slates_nor_gl', false), roughness: 1, color: 0x6a6a78 }));
  disc.material.map.repeat.set(14, 14); disc.material.normalMap.repeat.set(14, 14); disc.rotation.x = -Math.PI / 2; disc.position.set(0, .03, -338); disc.receiveShadow = true; world.group.add(disc);

  // Hollow Lane — houses, lamps, a cart
  for (let i = 0; i < 9; i++) {
    const z = -18 - i * 15.5, side = i % 2 ? 1 : -1, x = side * (rand(11, 15));
    place('ruined', x, z, { w: rand(9, 11), rot: side > 0 ? Math.PI / 2 + rand(-.15, .15) : -Math.PI / 2 + rand(-.15, .15), col: 'box', shrink: .8 });
  }
  const post = new THREE.MeshStandardMaterial({ color: 0x17171b, metalness: .7, roughness: .5 });
  for (let i = 0; i < 9; i++) {
    const z = -8 - i * 17, side = i % 2 ? 1 : -1, x = side * 4.2;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, 3, 6), post); p.position.set(x, 1.5, z); p.castShadow = true; world.group.add(p);
    const l = place('lantern', x, z, { h: .8, y: 2.95, emissive: 0xffa040 }); void l;
    const s = fireSprite(0xffa050, .8); s.position.set(x, 3.25, z); world.group.add(s);
    lamps.push({ x, y: 3.2, z, color: 0xffa860, power: 20, dist: 15, flicker: .1 });
    world.colliders.push({ t: 'c', x, z, r: .22, low: true });
  }
  place('hearse', 5.4, -64, { w: 2.8, rot: .2, col: 'box' }); place('hearse', -5.2, -112, { w: 2.8, rot: -.35 + Math.PI, col: 'box' });
  place('skulls', -8, -40, { w: 2.2 }); place('skulls', 8.5, -92, { w: 2.4, rot: 1 });
  place('spearrack', -6, -126, { w: 2.2, col: 'box', rot: .6 });

  // Cemetery
  const cemOK = (x, z) => Math.abs(x) > 2.6 || Math.abs(z + 226) > 85;
  spread('gravestones', 22, { x0: -32, x1: 32, z0: -296, z1: -154 }, { w: [5, 7], gap: 6, col: 'circle', r: 1.2 }, (x, z) => Math.abs(x) > 3.6);
  spread('candlegraves', 12, { x0: -30, x1: 30, z0: -296, z1: -156 }, { w: [2.6, 3.4], gap: 6, col: 'circle', r: .9, tint: 0xdddddd }, (x, z) => Math.abs(x) > 3.8);
  spread('tombstones', 8, { x0: -30, x1: 30, z0: -296, z1: -160 }, { w: [3.2, 4.2], gap: 9, col: 'circle', r: 1.1 }, (x, z) => Math.abs(x) > 4);
  const angels = [[-9, -172], [10, -204], [-12, -238], [9, -268], [-5, -290]];
  for (const [x, z] of angels) place('angel', x, z, { h: rand(4.6, 5.6), rot: rand(0, 6.28), col: 'circle', r: 1.3 });
  place('hearse', 12, -230, { w: 2.8, rot: 1.1, col: 'box' }); place('hearse', -11, -194, { w: 2.8, rot: -.4, col: 'box' });
  for (const [x, z] of [[-20, -176], [18, -214], [-14, -270]]) place('skulls', x, z, { w: 2.3, rot: rand(0, 6) });
  lv.braziers = [makeBrazier(-17, -182), makeBrazier(16, -228), makeBrazier(-11, -277)];

  // Hollow Heart — a ring of broken columns and an old altar-fire
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, rr = 30; place('columns', Math.sin(a) * rr, -338 + Math.cos(a) * rr, { w: 5, rot: a, col: 'box', shrink: .9 }); }
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + .3; place('skulls', Math.sin(a) * 18, -338 + Math.cos(a) * 18, { w: 2.2, rot: a }); }
  lv.heart = makeBrazier(0, -338, true);

  // forests close the arena in
  const edge = (x, z) => Math.abs(x) > 22 || (Math.abs(x) > 17 && R() < .4);
  spread('tree', 70, { x0: -35, x1: 35, z0: -140, z1: 6 }, { h: [8, 12], gap: 5, col: 'circle', r: 1.0 }, (x, z) => Math.abs(x) > 19);
  spread('tree', 55, { x0: -35, x1: 35, z0: -300, z1: -150 }, { h: [8, 13], gap: 5.5, col: 'circle', r: 1.0 }, (x, z) => Math.abs(x) > 20 || (Math.abs(x) > 12 && R() < .15));
  spread('tree', 36, { x0: -36, x1: 36, z0: -394, z1: -300 }, { h: [9, 13], gap: 5.5, col: 'circle', r: 1.0 }, (x, z) => Math.hypot(x, z + 338) > 40);
  // a wall of trunks behind the start so nobody walks out
  for (let x = -36; x <= 36; x += 4.5) place('tree', x + rand(-1, 1), 7.5 + rand(0, 1), { h: rand(9, 12), col: 'circle', r: 1 });
  for (let x = -36; x <= 36; x += 4.5) place('tree', x + rand(-1, 1), -391 + rand(0, 1), { h: rand(10, 13), col: 'circle', r: 1 });

  lv.gates.lane = makeGate(0, Z.laneEnd, 7, 'lane'); lv.gates.heart = makeGate(0, Z.cemEnd, 7, 'heart');
  lv.starts = { 1: { x: 0, z: -1, ry: Math.PI }, 2: { x: 0, z: -154, ry: Math.PI }, 3: { x: 0, z: -306, ry: Math.PI } };
  lv.heartCenter = { x: 0, z: -338 };
  lv.zone = z => z > Z.laneEnd ? 'Hollow Lane' : z > Z.cemEnd ? 'Old Cemetery' : 'Hollow Heart';
  return lv;
}

// ---------- The Capital: colosseum ----------
export async function buildCapital() {
  clearWorld(); fires.length = 0; lv.kind = 'capital'; lv.gates = {}; lv.beacons = []; lv.braziers = [];
  await A.loadProps(['colosseum', 'brazier', 'columns', 'spearrack', 'crate', 'parachute', 'skulls']);
  const RX = 14.5, RZ = 22; // the open floor between the gates (measured from the model)
  world.bound = { t: 'ell', rx: RX, rz: RZ };
  setAtmosphere(0x14110f, .011, 0x3a2a22);
  moon.color.set(0xffe2c0); moon.intensity = 2.0; hemi.intensity = 1.6;
  const rim = new THREE.Mesh(new THREE.CircleGeometry(220, 48), new THREE.MeshStandardMaterial({ color: 0x1a1612, roughness: 1 })); rim.rotation.x = -Math.PI / 2; rim.position.y = -.2; world.group.add(rim);
  // The colosseum from your Unity project. Sit it so its sand is exactly at ground level.
  const col = A.prop('colosseum', { w: 130 }); world.group.add(col); lv.shell = col;
  let sandTop = 3; col.updateMatrixWorld(true);
  col.traverse(o => { if (o.isMesh && o.material && o.material.name === 'mat_sand') { sandTop = new THREE.Box3().setFromObject(o).max.y; } });
  col.position.y = -sandTop + .02;
  // cover in the arena
  const cover = [[0, 0, 4], [-7, -7, 3], [7, -7, 3], [-7, 9, 3], [7, 9, 3], [0, -15, 3]];
  for (const [x, z, w] of cover) place('columns', x, z, { w, rot: Math.atan2(x, z), col: 'box', shrink: .9 });
  for (const [x, z] of [[-4, 15], [4, -12], [-10, 0], [10, 3]]) place('skulls', x, z, { w: 2.4, rot: x });
  // beacons: the Capital's broadcast braziers
  for (const [x, z] of [[-10, -12], [10, -8], [0, 17]]) {
    const b = makeBrazier(x, z, true); b.lit = true; b.fire.visible = true; b.lamp.on = true; b.lamp.color = 0x6ab0ff; b.fire.material.color.set(0x66aaff); b.beacon = true; b.hp = 400; b.max = 400; b.alive = true;
    lv.beacons.push(b);
  }
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2, x = Math.sin(a) * (RX - 1), z = Math.cos(a) * (RZ - 1); const f = fireSprite(0xff9040, 1.2); f.position.set(x, 3, z); world.group.add(f); lamps.push({ x, y: 3, z, color: 0xff9a50, power: 22, dist: 16, flicker: .2 }); }
  lv.arena = { rx: RX, rz: RZ };
  lv.spawnPoints = []; for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; lv.spawnPoints.push({ x: Math.sin(a) * (RX - 4), z: Math.cos(a) * (RZ - 5) }); }
  lv.starts = { 4: { x: 0, z: 15, ry: Math.PI } };
  lv.zone = () => 'The Capital';
  return lv;
}

// ---------- menu stage ----------
export async function buildStage() {
  clearWorld(); fires.length = 0; lv.kind = 'stage';
  await A.loadProps(['tree', 'tombstones', 'brazier', 'ruined', 'angel']);
  world.bound = { t: 'circle', x: 0, z: 0, r: 40 };
  setAtmosphere(0x0b1220, .03, 0x1a2638);
  groundPlane(120, 120, 0, 0, 'brown_mud_leaves_01', 7, 0x5e5a5e);
  place('brazier', 2.4, -1.2, { h: 1.4 }); const f = fireSprite(0xff8a30, 2); f.position.set(2.4, 1.55, -1.2); world.group.add(f);
  lamps.push({ x: 2.4, y: 2, z: -1.2, color: 0xff9040, power: 14, dist: 12, flicker: .2 });
  for (const [x, z, h] of [[-9, -6, 10], [8, -11, 11], [-4, -15, 9], [13, -3, 10], [-14, 2, 9]]) place('tree', x, z, { h });
  place('angel', -6, -9, { h: 5 }); place('tombstones', 7, -6, { w: 5 }); place('ruined', 0, -26, { w: 14 });
  return lv;
}
