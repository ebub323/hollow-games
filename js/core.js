import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const $ = id => document.getElementById(id);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = a => a[Math.floor(Math.random() * a.length)];
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function angLerp(a, b, t) { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * t; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ---------- renderer ----------
const canvas = $('gl');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.55;
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, .1, 420);
scene.add(camera);

// ---------- lights ----------
export const hemi = new THREE.HemisphereLight(0x8ea2d8, 0x2a2420, 1.7); scene.add(hemi);
export const moon = new THREE.DirectionalLight(0x93a9ff, 1.35); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048); const sc = moon.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120;
moon.shadow.bias = -.0004; moon.shadow.normalBias = .05;
scene.add(moon, moon.target);
export const lantern = new THREE.PointLight(0xffc080, 60, 30, 1.4); lantern.castShadow = false; scene.add(lantern);
// A small pool of real lights that jump to whichever lamps/fires are near the player.
export const lightPool = []; for (let i = 0; i < 5; i++) { const l = new THREE.PointLight(0xffa060, 0, 16, 1.7); scene.add(l); lightPool.push(l); }
export const lamps = []; // {x,y,z,color,power,flicker}
export function updateLamps(px, pz, t) {
  const near = lamps.map(l => ({ l, d: (l.x - px) ** 2 + (l.z - pz) ** 2 })).filter(o => o.d < 1600 && o.l.on !== false).sort((a, b) => a.d - b.d);
  for (let i = 0; i < lightPool.length; i++) {
    const L = lightPool[i], o = near[i];
    if (!o) { L.intensity = 0; continue; }
    L.position.set(o.l.x, o.l.y, o.l.z); L.color.set(o.l.color || 0xffa060);
    L.intensity = (o.l.power || 28) * 1.5 * (1 + (o.l.flicker ?? .12) * Math.sin(t * 17 + o.l.x * 3) * Math.sin(t * 7.3 + o.l.z));
    L.distance = o.l.dist || 16;
  }
}

// ---------- sky ----------
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x02040a) }, mid: { value: new THREE.Color(0x0e1830) }, hor: { value: new THREE.Color(0x1a2a3e) }, t: { value: 0 } },
  vertexShader: 'varying vec3 p; void main(){ p=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `varying vec3 p; uniform vec3 top,mid,hor; uniform float t;
    float h(vec3 q){ return fract(sin(dot(q,vec3(12.9898,78.233,45.164)))*43758.5453); }
    void main(){ float y=clamp(p.y,0.,1.); vec3 c=mix(hor,mid,smoothstep(0.,.35,y)); c=mix(c,top,smoothstep(.3,1.,y));
      vec3 g=floor(p*260.); float s=step(.9965,h(g))*smoothstep(.12,.5,y); c+=vec3(.8,.9,1.)*s*(.6+.4*sin(t*2.+h(g)*40.));
      vec3 m=normalize(vec3(-.45,.5,-.74)); float d=dot(p,m); c+=vec3(.75,.82,1.)*smoothstep(.9985,.9992,d)*1.4; c+=vec3(.25,.3,.5)*pow(max(d,0.),60.)*.8;
      gl_FragColor=vec4(c,1.); }`,
});
export const sky = new THREE.Mesh(new THREE.SphereGeometry(380, 24, 16), skyMat); sky.renderOrder = -10; scene.add(sky);

// ---------- particles ----------
const MAXP = 1400;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3), pSize = new Float32Array(MAXP);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
  uniforms: { scale: { value: 600 } },
  vertexShader: 'attribute float size; varying vec3 vc; uniform float scale; void main(){ vc=color; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*scale/-mv.z; gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec3 vc; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; gl_FragColor=vec4(vc*(1.-d*1.6),1.); }',
});
const pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; scene.add(pts);
const parts = []; for (let i = 0; i < MAXP; i++) parts.push({ life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, g: 0, r: 0, gc: 0, b: 0, s: 0, drag: 0 });
let pHead = 0;
export function emit(x, y, z, n, o = {}) {
  const c = new THREE.Color(o.color ?? 0xffffff);
  for (let i = 0; i < n; i++) {
    const p = parts[pHead]; pHead = (pHead + 1) % MAXP;
    const sp = o.speed ?? 3, a = Math.random() * 6.283, e = (o.up ?? 0) + (Math.random() - .5) * (o.spread ?? 1);
    p.x = x + (Math.random() - .5) * (o.jit ?? 0); p.y = y + (Math.random() - .5) * (o.jit ?? 0); p.z = z + (Math.random() - .5) * (o.jit ?? 0);
    const s = sp * (.3 + Math.random() * .7);
    p.vx = Math.cos(a) * s * (o.flat ?? 1); p.vz = Math.sin(a) * s * (o.flat ?? 1); p.vy = e * sp * .6 + (o.lift ?? 0);
    p.g = o.grav ?? 6; p.life = p.max = (o.life ?? .7) * (.6 + Math.random() * .6); p.s = o.size ?? .12; p.drag = o.drag ?? .5;
    p.r = c.r; p.gc = c.g; p.b = c.b;
  }
}
export function updateParticles(dt) {
  for (let i = 0; i < MAXP; i++) {
    const p = parts[i];
    if (p.life <= 0) { pSize[i] = 0; continue; }
    p.life -= dt; p.vy -= p.g * dt; const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vz *= d;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < .02 && p.g > 0) { p.y = .02; p.vy *= -.2; p.vx *= .6; p.vz *= .6; }
    const k = Math.max(0, p.life / p.max);
    pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
    pCol[i * 3] = p.r * k; pCol[i * 3 + 1] = p.gc * k; pCol[i * 3 + 2] = p.b * k; pSize[i] = p.s * (.4 + k * .6);
  }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
}

// Dust motes / embers floating near the player.
const moteN = 160, moteGeo = new THREE.BufferGeometry(), motePos = new Float32Array(moteN * 3);
for (let i = 0; i < moteN; i++) { motePos[i * 3] = rand(-14, 14); motePos[i * 3 + 1] = rand(.2, 7); motePos[i * 3 + 2] = rand(-14, 14); }
moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
export const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ color: 0x9fb4d8, size: .05, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
motes.frustumCulled = false; scene.add(motes);
export function updateMotes(px, pz, t) {
  motes.position.set(px, 0, pz);
  const a = moteGeo.attributes.position;
  for (let i = 0; i < moteN; i++) { a.array[i * 3 + 1] += Math.sin(t + i) * .002 + .002; if (a.array[i * 3 + 1] > 7) a.array[i * 3 + 1] = .2; a.array[i * 3] += Math.sin(t * .4 + i * 3) * .003; }
  a.needsUpdate = true;
}

// ---------- post ----------
export const post = { hurt: 0, low: 0, flash: 0 };
const FX = {
  uniforms: { tDiffuse: { value: null }, t: { value: 0 }, hurt: { value: 0 }, low: { value: 0 }, aspect: { value: 1 }, flash: { value: 0 }, desat: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float t,hurt,low,aspect,flash,desat; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    void main(){
      vec2 c=vUv-.5; float r=dot(c,c);
      float ca=.0004+hurt*.006+low*.003*sin(t*5.);
      vec3 col=vec3(texture2D(tDiffuse,vUv+c*ca*8.).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-c*ca*8.).b);
      float l=dot(col,vec3(.299,.587,.114)); col=mix(col,vec3(l),desat+low*.35);
      col*=1.-smoothstep(.25,.75,r)*.42;
      col+=vec3(.5,.02,.03)*hurt*smoothstep(.05,.5,r);
      col*=1.+ (h(vUv*vec2(aspect,1.)*900.+t)-.5)*.07;
      col+=flash*vec3(.9,.95,1.);
      gl_FragColor=vec4(col,1.); }`,
};
export let composer, bloom, fxPass;
export function initPost() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // A single NaN/Inf pixel (from a degenerate skinned normal) would smear across the whole frame through bloom.
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec4 c=texture2D(tDiffuse,vUv); bool ok=(c.r==c.r)&&(c.g==c.g)&&(c.b==c.b)&&(abs(c.r)<1e6)&&(abs(c.g)<1e6)&&(abs(c.b)<1e6); gl_FragColor= ok ? vec4(min(c.rgb,vec3(16.)),c.a) : vec4(0.,0.,0.,1.); }' }));
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), .45, .6, .82); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  fxPass = new ShaderPass(FX); composer.addPass(fxPass);
  resize();
}
export function resize() {
  renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); }
  pMat.uniforms.scale.value = innerHeight * .9;
}
addEventListener('resize', resize);

// ---------- ground & colliders ----------
export const world = {
  group: new THREE.Group(), colliders: [], bound: { t: 'rect', x0: -30, x1: 30, z0: -400, z1: 8 }, surface: 'grass',
};
scene.add(world.group);
export function resolve(e, r) {
  for (const c of world.colliders) {
    if (c.on === false) continue;
    if (c.t === 'c') {
      const dx = e.x - c.x, dz = e.z - c.z, m = c.r + r, d2 = dx * dx + dz * dz;
      if (d2 < m * m) { const d = Math.sqrt(d2) || .001; e.x = c.x + dx / d * m; e.z = c.z + dz / d * m; }
    } else {
      const px = clamp(e.x, c.x0, c.x1), pz = clamp(e.z, c.z0, c.z1), dx = e.x - px, dz = e.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2); e.x = px + dx / d * r; e.z = pz + dz / d * r; }
        else { const l = e.x - c.x0 + r, rr = c.x1 - e.x + r, t = e.z - c.z0 + r, b = c.z1 - e.z + r, m = Math.min(l, rr, t, b); if (m === l) e.x = c.x0 - r; else if (m === rr) e.x = c.x1 + r; else if (m === t) e.z = c.z0 - r; else e.z = c.z1 + r; }
      }
    }
  }
  const b = world.bound;
  if (b.t === 'rect') { e.x = clamp(e.x, b.x0 + r, b.x1 - r); e.z = clamp(e.z, b.z0 + r, b.z1 - r); }
  else if (b.t === 'ell') { const nx = e.x / (b.rx - r), nz = e.z / (b.rz - r), d = Math.hypot(nx, nz); if (d > 1) { e.x /= d; e.z /= d; } }
  else { const dx = e.x - b.x, dz = e.z - b.z, d = Math.hypot(dx, dz), m = b.r - r; if (d > m) { e.x = b.x + dx / d * m; e.z = b.z + dz / d * m; } }
}
export function blocked(x, z, r = .3) { const o = { x, z }; resolve(o, r); return Math.abs(o.x - x) > .02 || Math.abs(o.z - z) > .02; }
// Is there open air between two points? (used by archers to decide whether to shoot)
export function losClear(a, b) {
  const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2);
  for (let i = 1; i < n; i++) { const t = i / n, x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t); for (const c of world.colliders) { if (c.on === false || c.low) continue; if (c.t === 'b' ? (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) : ((x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r)) return false; } }
  return true;
}
export function clearWorld() {
  if (typeof window !== 'undefined' && window.__fires) window.__fires.length = 0;
  scene.remove(world.group); world.group.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose?.(); });
  world.group = new THREE.Group(); scene.add(world.group); world.colliders.length = 0; lamps.length = 0;
}
