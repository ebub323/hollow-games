import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const loader = new GLTFLoader();
const modelCache = new Map(), clipCache = new Map(), texCache = new Map();
export let onProgress = () => {};
export const setProgress = f => { onProgress = f; };
let total = 0, done = 0;
const tick = label => { done++; onProgress(done / Math.max(total, 1), label); };

// Flaky connections happen; try a few times before giving up on a file.
async function retry(fn, n = 4) { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= n) throw e; await new Promise(r => setTimeout(r, 400 * (i + 1))); } } }
function stripLights(o) { const l = []; o.traverse(c => { if (c.isLight) l.push(c); }); l.forEach(c => c.parent && c.parent.remove(c)); }
export function model(name) {
  if (!modelCache.has(name)) { total++; const p = retry(() => loader.loadAsync(`models/${name}.glb`)).then(g => { p._v = g; tick(name); return g; }); modelCache.set(name, p); p.catch(() => modelCache.delete(name)); }
  return modelCache.get(name);
}
export function clip(name) {
  if (!clipCache.has(name)) { total++; const p = retry(() => loader.loadAsync(`anims/${name}.glb`)).then(g => { const c = g.animations[0]; c.name = name; p._v = c; tick(name); return c; }); clipCache.set(name, p); p.catch(() => clipCache.delete(name)); }
  return clipCache.get(name);
}
export function texture(name, srgb = true, repeat = 1) {
  const k = name + srgb;
  if (!texCache.has(k)) {
    const t = new THREE.TextureLoader().load(`tex/${name}.webp`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
    texCache.set(k, t);
  }
  return texCache.get(k);
}

// What each character is built from. `hips` keeps the clip's own hip motion (same skeleton family);
// zombie clips are shared between bodies of different proportions, so their translation is dropped.
export const SPEC = {
  tribute: { model: 'Tribute', h: 1.72, hips: true,
    clips: { idle: 'archer_idle', walk: 'archer_walk', run: 'archer_run', back: 'archer_walk_back', left: 'archer_walk_left', right: 'archer_walk_right', shoot: 'archer_shoot', roll: 'archer_roll', fall: 'archer_fall', block: 'archer_block', win: 'archer_victory' },
    once: ['shoot', 'roll', 'fall', 'block', 'win'] },
  risen: { model: 'Risen', h: 1.82, hips: false,
    clips: { idle: 'zombie_idle', walk: 'zombie_walk', run: 'zombie_run', attack: 'zombie_attack', death: 'zombie_death', scream: 'zombie_scream' }, once: ['attack', 'death', 'scream'] },
  stitched: { model: 'Stitched', h: 2.6, hips: false,
    clips: { idle: 'zombie_idle', walk: 'zombie_walk', run: 'zombie_run', attack: 'zombie_attack', death: 'zombie_death', scream: 'zombie_scream' }, once: ['attack', 'death', 'scream'] },
  abbess: { model: 'Abbess', h: 2.05, hips: false,
    clips: { idle: 'abbess_idle', swipe: 'abbess_swipe', swipe2: 'abbess_swipe_left', overhead: 'abbess_overhead', summon: 'abbess_summon', scream: 'abbess_scream', laugh: 'abbess_laugh', hit: 'abbess_hit', death: 'abbess_die' },
    once: ['swipe', 'swipe2', 'overhead', 'summon', 'scream', 'laugh', 'hit', 'death'] },
  stonehorn: { model: 'Stonehorn', h: 3.9, hips: false,
    clips: { idle: 'stonehorn_idle', walk: 'stonehorn_walk', run: 'stonehorn_walk', attack: 'stonehorn_attack', scream: 'stonehorn_roar', death: 'stonehorn_die' }, once: ['attack', 'scream', 'death'] },
};

export async function preload(kind) {
  const s = SPEC[kind];
  await Promise.all([model(s.model), ...Object.values(s.clips).map(clip)]);
}

function prep(c, hips) {
  const out = c.clone(); out.name = c.name;
  out.tracks = out.tracks.filter(t => {
    if (!t.name.endsWith('.position')) return true;
    return hips && /Hips\.position$/.test(t.name);
  }).map(t => {
    if (hips && /Hips\.position$/.test(t.name)) { // keep the bob, lose the travel
      const v = t.values.slice(); for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
      return new THREE.VectorKeyframeTrack(t.name, t.times, v);
    }
    return t;
  });
  return out;
}

export class Actor {
  constructor(kind) {
    this.kind = kind; const s = SPEC[kind]; this.spec = s;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(modelCache.get(s.model)._v.scene);
    stripLights(this.model); // some converted files carry their editor lights (thousands of candela) along

    this.model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material) { o.material = o.material.clone(); } } });
    // converted spec/gloss materials come out mirror-like under a point light; make them read as skin, cloth and stone
    this.model.traverse(o => { if (o.isMesh && o.material) { const m = o.material; if (m.metalness !== undefined) { m.metalness = kind === 'tribute' ? Math.min(m.metalness, .25) : .02; m.metalnessMap = null; if (!(kind === 'tribute')) { m.roughnessMap = null; m.roughness = .82; } else m.roughness = Math.max(m.roughness, .55); m.envMapIntensity = 0; } } });
    this.root.add(this.model);
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    // a skinned mesh can report a bind-pose box far off the posed height — fall back to the spec height
    const k = size.y > .2 ? s.h / size.y : 1; this.scaleK = k;
    this.model.scale.multiplyScalar(k);
    this.model.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(this.model);
    this.model.position.y -= b2.min.y;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.act = {}; this.cur = null;
    for (const [n, cn] of Object.entries(s.clips)) {
      const a = this.mixer.clipAction(prep(clipCache.get(cn)._v, s.hips));
      if (s.once.includes(n)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      this.act[n] = a;
    }
    this.speed = 1;
  }
  play(n, fade = .18, ts = 1) {
    const a = this.act[n]; if (!a) return null;
    if (this.cur === a && !this.spec.once.includes(n)) { a.timeScale = ts; return a; }
    a.reset().setEffectiveTimeScale(ts).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.cur && this.cur !== a) this.cur.fadeOut(fade);
    this.cur = a; this.curName = n; return a;
  }
  duration(n) { return this.act[n] ? this.act[n].getClip().duration : 1; }
  update(dt) { this.mixer.update(dt); }
  tint(map) { // map: meshNameFragment -> hex
    this.model.traverse(o => {
      if (!o.isMesh) return;
      for (const [frag, col] of Object.entries(map)) if (o.name.toLowerCase().includes(frag)) o.material.color.set(col);
    });
  }
}

export const ready = p => p;
export async function load(kinds) {
  const ps = [];
  for (const k of kinds) {
    const s = SPEC[k];
    ps.push(ready(model(s.model)));
    for (const c of Object.values(s.clips)) ps.push(ready(clip(c)));
  }
  await Promise.all(ps);
}

// Static scenery: loaded once, cloned, normalised to a requested size and sat on the ground.
const propBase = new Map();
// Many scenery models ship as hundreds of tiny meshes. Bake them into one mesh per material
// so a house costs a handful of draw calls instead of hundreds.
function bake(scene) {
  scene.updateMatrixWorld(true);
  const groups = new Map(), rest = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh || Array.isArray(o.material)) { rest.push(o); return; }
    let g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(k)) { g.deleteAttribute(k); continue; }
      const a = g.attributes[k]; // quantised attributes must become plain floats before they can merge
      if (!(a.array instanceof Float32Array) || a.isInterleavedBufferAttribute) {
        const n = a.itemSize, f = new Float32Array(a.count * n);
        for (let i = 0; i < a.count; i++) { f[i * n] = a.getX(i); if (n > 1) f[i * n + 1] = a.getY(i); if (n > 2) f[i * n + 2] = a.getZ(i); }
        g.setAttribute(k, new THREE.BufferAttribute(f, n));
      }
    }
    g.applyMatrix4(o.matrixWorld);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const e = groups.get(o.material) || { mat: o.material, geos: [] }; e.geos.push(g); groups.set(o.material, e);
  });
  const out = new THREE.Group();
  for (const { mat, geos } of groups.values()) {
    const idx = geos.filter(g => g.index).length;
    const list = (idx === 0 || idx === geos.length) ? geos : geos.map(g => g.index ? g.toNonIndexed() : g);
    const merged = list.length > 1 ? mergeGeometries(list, false) : list[0];
    if (merged) out.add(new THREE.Mesh(merged, mat));
  }
  for (const m of rest) { const c = m.clone(); c.applyMatrix4(m.matrixWorld); out.add(c); }
  return out;
}
export async function loadProps(names) {
  await Promise.all(names.map(async n => { const g = await model(n); if (!g._baked) { g.scene = bake(g.scene); g._baked = true; } }));
}
export function prop(name, { h, w, rotY = 0, tint, emissive } = {}) {
  const g = modelCache.get(name)._v;
  const o = g.scene.clone(true); stripLights(o);
  o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; if (tint) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(tint)); } if (emissive) { m.material = m.material.clone(); m.material.emissive = new THREE.Color(emissive); m.material.emissiveIntensity = 1.2; } } });
  const wrap = new THREE.Group(); wrap.add(o);
  wrap.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(o), size = box.getSize(new THREE.Vector3());
  const s = h ? h / size.y : w ? w / Math.max(size.x, size.z) : 1;
  o.scale.setScalar(s); o.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new THREE.Vector3());
  o.position.set(-c.x, -box.min.y, -c.z);
  wrap.rotation.y = rotY;
  return wrap;
}
