import * as THREE from 'three';
import * as A from './assets.js';
import { Snd } from './audio.js';
import { scene, world, resolve, emit, clamp, lerp, rand, pick, angLerp, losClear, lamps } from './core.js';
import { fireSprite } from './world.js';

// One shared bag of live game state.
export const G = {
  mode: 'loading', player: null, enemies: [], bots: [], remotes: new Map(), arrows: [], pickups: [], bolts: [], drops: [],
  time: 0, shake: 0, kills: 0, hooks: {}, net: null, pvp: false, story: false,
};
export const hook = (n, ...a) => G.hooks[n] && G.hooks[n](...a);
export const everyone = () => [G.player, ...G.bots, ...G.remotes.values()].filter(f => f && f.alive);
const fwd = ry => ({ x: Math.sin(ry), z: Math.cos(ry) });

// ---------- arrows ----------
const arrowGeo = (() => { const g = new THREE.CylinderGeometry(.012, .012, .95, 5); g.rotateX(Math.PI / 2); const t = new THREE.ConeGeometry(.035, .12, 5); t.rotateX(Math.PI / 2); t.translate(0, 0, .5); const m = new THREE.BufferGeometry(); return [g, t]; })();
const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b5638, roughness: .8 }), headMat = new THREE.MeshStandardMaterial({ color: 0xc8c8d0, metalness: .9, roughness: .3 });
const fireMat = new THREE.MeshBasicMaterial({ color: 0xff8a30 });
export function spawnArrow(pos, dir, { speed = 42, dmg = 20, owner = null, team = '', burn = false, visualOnly = false, grav = 9 } = {}) {
  const m = new THREE.Group(); m.add(new THREE.Mesh(arrowGeo[0], shaftMat), new THREE.Mesh(arrowGeo[1], burn ? fireMat : headMat));
  scene.add(m); m.position.copy(pos);
  const a = { m, p: pos.clone(), v: dir.clone().normalize().multiplyScalar(speed), owner, team, dmg, life: 5, stuck: 0, burn, visualOnly, grav };
  G.arrows.push(a); orient(a); return a;
}
function orient(a) { const d = a.v.clone().normalize(); a.m.lookAt(a.p.clone().add(d)); a.m.position.copy(a.p); }
function updateArrows(dt) {
  for (const a of G.arrows) {
    if (a.stuck > 0) { a.stuck -= dt; if (a.stuck <= 0) a.dead = true; continue; }
    a.life -= dt; if (a.life <= 0) { a.dead = true; continue; }
    const steps = Math.ceil(a.v.length() * dt / .5), sdt = dt / steps;
    for (let s = 0; s < steps && !a.stuck; s++) {
      a.v.y -= (a.grav ?? 9) * sdt; a.p.addScaledVector(a.v, sdt);
      if (a.burn) emit(a.p.x, a.p.y, a.p.z, 1, { color: 0xff8030, speed: .3, life: .35, size: .1, grav: -1 });
      if (a.p.y <= .05) { a.p.y = .05; a.stuck = 3; Snd.play('stepStone', { at: a.p, vol: .2 }); break; }
      const tst = { x: a.p.x, z: a.p.z }; let hitW = false;
      for (const c of world.colliders) { if (c.on === false || c.low) continue; if (c.t === 'b' ? (a.p.x > c.x0 && a.p.x < c.x1 && a.p.z > c.z0 && a.p.z < c.z1) : ((a.p.x - c.x) ** 2 + (a.p.z - c.z) ** 2 < c.r * c.r)) { hitW = true; break; } }
      if (hitW && a.p.y < 3.2) { a.stuck = 3; emit(a.p.x, a.p.y, a.p.z, 5, { color: 0xb0a090, speed: 1.5, life: .4, size: .06 }); break; }
      if (a.visualOnly) continue;
      for (const t of targetsFor(a)) {
        const h = t.height || 1.7, dx = a.p.x - t.x, dz = a.p.z - t.z, r = (t.radius || .45) + .08;
        if (dx * dx + dz * dz < r * r && a.p.y > (t.y || 0) && a.p.y < (t.y || 0) + h) {
          const head = a.p.y > (t.y || 0) + h * .8 && !t.big;
          t.hurt(a.dmg * (head ? 2 : 1), { from: a.owner, arrow: a, head, burn: a.burn, dir: a.v.clone().normalize() });
          a.dead = true; a.m.visible = false; break;
        }
      }
      if (a.dead) break;
    }
    orient(a);
  }
  for (const a of G.arrows) if (a.dead) scene.remove(a.m);
  G.arrows = G.arrows.filter(a => !a.dead);
}
export const hostileTo = (a, b) => b.alive !== false && a.team !== b.team;
function targetsFor(a) {
  const out = [];
  const consider = t => { if (t && t.alive !== false && t.team !== a.team && t !== a.owner) out.push(t); };
  for (const e of G.enemies) consider(e);
  consider(G.player); for (const b of G.bots) consider(b);
  for (const r of G.remotes.values()) consider(r.proxyTarget);
  for (const br of (G.beaconTargets || [])) consider(br);
  return out;
}

// ---------- tribute look ----------
export function dress(actor, region, tribute) {
  // The node names in the converted file are shifted against the meshes, so go by material instead.
  actor.model.traverse(o => {
    if (!o.isMesh || !o.material) return; const mn = o.material.name || '', m = o.material;
    if (mn === 'Arrow_MAT') { o.visible = false; return; }
    if (mn === 'Akai_MAT1') { m.color.set(tribute.cloth); m.color.lerp(new THREE.Color(region.color), .5); m.color.multiplyScalar(2.3); }
    else if (mn === 'Body_MAT1') { m.color.set(tribute.skin); m.color.multiplyScalar(1.25); }
    else if (mn === 'phong1') { m.opacity = 1; m.transparent = true; m.alphaTest = .45; m.depthWrite = true; m.color.set(0x151210); }
  });
}

// ---------- fighters ----------
class Fighter {
  constructor(kind, o = {}) {
    this.actor = new A.Actor(kind); this.root = this.actor.root; scene.add(this.root);
    this.x = o.x || 0; this.z = o.z || 0; this.y = 0; this.ry = o.ry || 0; this.hp = this.max = o.hp || 100; this.alive = true; this.team = o.team || 'x'; this.name = o.name || '';
    this.vx = 0; this.vz = 0; this.radius = .42; this.height = A.SPEC[kind].h; this.dyingT = 0; this.flash = 0; this.kind = kind;
  }
  sync() { this.root.position.set(this.x, this.y, this.z); this.root.rotation.y = this.ry; }
  hitFlash(dt) { if (this.flash > 0) { this.flash -= dt; const k = this.flash > 0 ? 1.8 : 0; this.actor.model.traverse(o => { if (o.isMesh && o.material.emissive) { o.material.emissive.setRGB(k * .5, k * .06, k * .04); } }); } }
  dispose() { scene.remove(this.root); }
}

// ----- the player -----
export class Player extends Fighter {
  constructor(region, tribute, x, z, ry) {
    super('tribute', { x, z, ry, team: region.id, name: tribute.name, hp: 100 + (region.mods.hp || 0) });
    this.region = region; this.tribute = tribute; dress(this.actor, region, tribute);
    this.mods = region.mods; this.speedK = region.mods.speed || 1;
    this.ammoMax = Math.round(90 * (region.mods.ammo || 1)); this.ammo = this.ammoMax; this.pots = region.mods.pots || 1;
    this.stam = 100; this.drawT = 0; this.drawing = false; this.rollT = 0; this.rollDir = { x: 0, z: 1 }; this.shootT = 0; this.invT = 0; this.potT = 0;
    this.aimMode = false; this.walkT = 0; this.stepT = 0; this.speed = 0; this.hurtAnim = 0; this.won = false; this.dead = false; this.ry = ry || 0;
    this.actor.play('idle'); this.lastPos = { x, z };
  }
  get chest() { return new THREE.Vector3(this.x, 1.35, this.z); }
  hurt(d, ctx = {}) {
    if (!this.alive || this.invT > 0 || this.rollT > 0 || G.mode !== 'play') return false;
    if (ctx.from && ctx.from.team === this.team) return false;
    this.hp -= d; this.invT = .45; this.flash = .15; G.shake = Math.max(G.shake, .5); G.hurt = 1;
    Snd.play('hurt', { vol: .9 }); emit(this.x, 1.3, this.z, 14, { color: 0x8a0f16, speed: 3, life: .6, size: .1, grav: 8 });
    hook('playerHurt', d, ctx);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.dead = true; this.actor.play('fall', .1); Snd.play('fall'); hook('playerDied', ctx); }
    return true;
  }
  heal(n) { this.hp = Math.min(this.max, this.hp + n); emit(this.x, 1, this.z, 20, { color: 0x6dff9a, speed: 1.5, life: 1, size: .1, grav: -2, up: 1 }); }
  update(dt, inp, cam) {
    this.invT = Math.max(0, this.invT - dt); this.shootT = Math.max(0, this.shootT - dt); this.potT = Math.max(0, this.potT - dt); this.hitFlash(dt);
    if (!this.alive) { this.actor.update(dt); this.sync(); return; }
    const yaw = cam.yaw, f = fwd(yaw), r = { x: -Math.cos(yaw), z: Math.sin(yaw) };
    let mx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0), mz = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
    if (inp.joy) { mx = inp.joy.x; mz = -inp.joy.y; }
    const len = Math.hypot(mx, mz); if (len > 1) { mx /= len; mz /= len; }
    let wx = f.x * mz + r.x * mx, wz = f.z * mz + r.z * mx;
    // draw / aim
    // Hold the trigger: arrows leave in bursts of three, a short breath between bursts.
    this.fireCd = (this.fireCd || 0) - dt;
    const wantFire = inp.fire && this.ammo > 0 && this.rollT <= 0 && !this.won;
    const rate = this.mods.draw || 1; // Greywater fires faster
    if (wantFire) {
      this.drawing = true; this.drawT = 1;
      if (this.fireCd <= 0) { this.release(cam); this.burst = (this.burst || 0) + 1; this.fireCd = (this.burst >= 3 ? .34 : .09) * rate; if (this.burst >= 3) this.burst = 0; }
    } else { this.drawing = false; this.drawT = 0; this.burst = 0; }
    this.aimMode = this.drawing || inp.aim;
    // roll
    if (inp.rollHit && this.rollT <= 0 && this.stam >= 22 && !this.won) {
      this.rollT = .55 * (this.mods.roll || 1) * .9; this.rollDur = this.rollT; this.stam -= 22 / (this.mods.roll ? 1.25 : 1);
      const rl = Math.hypot(wx, wz); this.rollDir = rl > .1 ? { x: wx / rl, z: wz / rl } : { x: Math.sin(this.ry), z: Math.cos(this.ry) };
      this.ry = Math.atan2(this.rollDir.x, this.rollDir.z); this.actor.play('roll', .08, 1.25); this.drawing = false; this.drawT = 0; Snd.play('swish', { vol: .5 });
    }
    let spd = 0;
    if (this.rollT > 0) { this.rollT -= dt; spd = 8.2 * (this.mods.roll || 1); this.vx = this.rollDir.x * spd; this.vz = this.rollDir.z * spd; }
    else {
      const sprint = inp.sprint && !this.aimMode && this.stam > 4 && len > .2;
      spd = (sprint ? 6.4 : this.aimMode ? 2.4 : 4.0) * this.speedK * (this.potT > 0 ? .4 : 1);
      const tx = wx * spd * (len > 1 ? 1 : len), tz = wz * spd * (len > 1 ? 1 : len);
      this.vx = lerp(this.vx, tx, 1 - Math.exp(-14 * dt)); this.vz = lerp(this.vz, tz, 1 - Math.exp(-14 * dt));
      this.stam = clamp(this.stam + (sprint ? -16 : 20) * dt, 0, 100);
      if (this.aimMode) this.ry = angLerp(this.ry, yaw, 1 - Math.exp(-16 * dt));
      else if (len > .1) this.ry = angLerp(this.ry, Math.atan2(wx, wz), 1 - Math.exp(-12 * dt));
      // animation
      if (this.shootT <= 0) {
        const sp = Math.hypot(this.vx, this.vz);
        if (sp < .3) this.actor.play('idle', .2);
        else if (this.aimMode) {
          const lx = (this.vx * Math.cos(this.ry) - this.vz * Math.sin(this.ry)), lz = (this.vx * Math.sin(this.ry) + this.vz * Math.cos(this.ry));
          // lx is along -right... pick the dominant local axis
          const rr = { x: -Math.cos(this.ry), z: Math.sin(this.ry) }, ff = fwd(this.ry);
          const sf = this.vx * ff.x + this.vz * ff.z, sr = this.vx * rr.x + this.vz * rr.z;
          if (Math.abs(sf) > Math.abs(sr)) this.actor.play(sf > 0 ? 'walk' : 'back', .15, 1); else this.actor.play(sr > 0 ? 'right' : 'left', .15, 1);
          void lx; void lz;
        } else this.actor.play(sprint ? 'run' : 'walk', .18, sprint ? 1 : clamp(sp / 3.2, .6, 1.3));
      }
    }
    this.x += this.vx * dt; this.z += this.vz * dt; resolve(this, .4);
    const sp = Math.hypot(this.vx, this.vz); this.speed = sp;
    if (sp > 1 && this.rollT <= 0) { this.stepT -= dt * sp; if (this.stepT <= 0) { this.stepT = 1.7; Snd.play(world.surface === 'stone' ? 'stepStone' : 'stepGrass', { vol: .35 }); } }
    this.actor.update(dt); this.sync();
  }
  release(cam) {
    const aim = cam.aimTarget(this), o = new THREE.Vector3(this.x + Math.sin(this.ry) * .3, 1.45, this.z + Math.cos(this.ry) * .3);
    const dir = aim.clone().sub(o).normalize(); const sp = .018; dir.x += rand(-sp, sp); dir.y += rand(-sp, sp); dir.z += rand(-sp, sp); dir.normalize();
    const dmg = 12 * (this.mods.dmg || 1), speed = 58;
    this.ammo--; this.shootT = .1; spawnArrow(o, dir, { speed, dmg, owner: this, team: this.team, burn: !!this.mods.burn, grav: 2 });
    this.actor.play('shoot', .03, 3); Snd.play('shot', { vol: .55 }); G.shake = Math.max(G.shake, .05);
    hook('shot', o, dir, { speed, dmg, burn: !!this.mods.burn, grav: 2 });
  }
  drink() { if (this.pots > 0 && this.hp < this.max && this.potT <= 0 && this.alive) { this.pots--; this.potT = 1.6; this.heal(40 * (this.mods.heal || 1)); Snd.play('bell', { vol: .25, rate: 1.6 }); } }
}

// ----- zombies and brutes -----
export class Enemy extends Fighter {
  constructor(kind, x, z, opt = {}) {
    const hp = opt.hp || (kind === 'stitched' ? 220 : 55);
    super(kind, { x, z, hp, team: 'risen' });
    this.speed = opt.speed || (kind === 'stitched' ? 1.7 : rand(1.0, 1.5)); this.dmg = opt.dmg || (kind === 'stitched' ? 26 : 13);
    this.radius = kind === 'stitched' ? .75 : .45; this.reach = kind === 'stitched' ? 2.0 : 1.5; this.big = kind === 'stitched';
    this.state = 'rise'; this.t = 0; this.atkCd = rand(.8, 1.6); this.windup = 0; this.rise = 1.6; this.burnT = 0; this.loot = opt.loot ?? .35;
    this.actor.play('idle'); this.root.position.y = -2; this.sink = 0; this.run = opt.run ?? Math.random() < .35;
    emit(x, .2, z, 18, { color: 0x5a4430, speed: 2.5, life: .8, size: .18, grav: 5, up: 1 }); Snd.play('erupt', { at: { x, z }, vol: .8 });
  }
  hurt(d, ctx = {}) {
    if (!this.alive || this.state === 'rise') return false;
    this.hp -= d; this.flash = .12; this.stagger = this.big ? 0 : .25; if (ctx.burn) this.burnT = 4;
    emit(this.x, 1.2, this.z, ctx.head ? 22 : 10, { color: 0x5a0a10, speed: 3, life: .6, size: .1, grav: 9 });
    Snd.play('hitFlesh', { at: this, vol: .8 }); if (ctx.from === G.player) hook('hit', this, ctx);
    if (this.hp <= 0) this.die(ctx);
    return true;
  }
  die(ctx) {
    this.alive = false; this.state = 'dead'; this.dyingT = 0; this.actor.play('death', .1); Snd.play('zdeath', { at: this, vol: .9 });
    emit(this.x, 1, this.z, 16, { color: 0x6dd0ff, speed: 1.5, life: 1.2, size: .1, grav: -2, up: 1 });
    G.kills += (ctx && ctx.from === G.player) ? 1 : 0; hook('enemyDied', this, ctx);
    if (Math.random() < this.loot) dropLoot(this.x, this.z);
  }
  update(dt, targets) {
    this.hitFlash(dt);
    if (this.state === 'dead') { this.dyingT += dt; if (this.dyingT > 3.2) this.root.position.y = -(this.dyingT - 3.2) * .8; if (this.dyingT > 5) this.gone = true; this.actor.update(dt); return; }
    if (this.burnT > 0) { this.burnT -= dt; this.hp -= 9 * dt; emit(this.x, 1.3, this.z, 1, { color: 0xff7a20, speed: .5, life: .5, size: .15, grav: -3 }); if (this.hp <= 0) this.die({ from: G.player, burn: true }); }
    if (this.state === 'rise') { this.t += dt; this.root.position.y = -2 + Math.min(1, this.t / this.rise) * 2; this.actor.update(dt); if (this.t >= this.rise) { this.state = 'chase'; this.actor.play('walk'); Snd.play('groan', { at: this, vol: .7 }); } this.ry = this.ry; this.root.rotation.y = this.ry; this.root.position.x = this.x; this.root.position.z = this.z; return; }
    // pick nearest living target
    let tg = null, best = 1e9; for (const t of targets) { if (!t.alive) continue; const d = Math.hypot(t.x - this.x, t.z - this.z); if (d < best) { best = d; tg = t; } }
    this.atkCd -= dt; this.stagger = Math.max(0, (this.stagger || 0) - dt);
    if (this.state === 'attack') {
      this.t += dt; const dur = this.actor.duration('attack') / 1.2;
      if (!this.hitDone && this.t > dur * .45) { this.hitDone = true; if (tg && best < this.reach + .6) { tg.hurt(this.dmg, { from: this, melee: true }); } }
      if (this.t >= dur) { this.state = 'chase'; this.atkCd = rand(1.4, 2.2); this.actor.play(this.run ? 'run' : 'walk', .15); }
    } else if (this.stagger > 0) { /* flinch */ }
    else if (tg) {
      const dx = tg.x - this.x, dz = tg.z - this.z; const d = Math.hypot(dx, dz) || 1;
      this.ry = angLerp(this.ry, Math.atan2(dx, dz), 1 - Math.exp(-8 * dt));
      if (d < this.reach && this.atkCd <= 0) { this.state = 'attack'; this.t = 0; this.hitDone = false; this.actor.play('attack', .1, 1.2); Snd.play('groan', { at: this, vol: .7 }); }
      else if (d > this.reach * .8) {
        const sp = this.speed * (this.run && d < 12 ? 1.45 : 1) * (G.waveSpeed || 1);
        this.actor.play(this.run && d < 12 ? 'run' : 'walk', .2, this.run && d < 12 ? .75 : clamp(sp / 2, .6, 1.1));
        const ox0 = this.x, oz0 = this.z; let ux = dx / d, uz = dz / d;
        if (this.detour > 0) { this.detour -= dt; const k = this.side || 1; const nx = -uz * k, nz = ux * k; ux = ux * .35 + nx * .95; uz = uz * .35 + nz * .95; }
        this.x += ux * sp * dt; this.z += uz * sp * dt;
        for (const o of G.enemies) { if (o === this || !o.alive) continue; const ox = this.x - o.x, oz = this.z - o.z, od = Math.hypot(ox, oz); if (od < .8 && od > .001) { this.x += ox / od * .8 * dt * 3; this.z += oz / od * .8 * dt * 3; } }
        resolve(this, this.radius);
        const moved = Math.hypot(this.x - ox0, this.z - oz0); this.stuck = moved < sp * dt * .4 ? (this.stuck || 0) + dt : Math.max(0, (this.stuck || 0) - dt);
        if (this.stuck > .6) { this.stuck = 0; this.detour = 1.4; this.side = Math.random() < .5 ? 1 : -1; }
      } else this.actor.play('idle', .2);
    } else this.actor.play('idle', .2);
    this.actor.update(dt); this.sync();
  }
}

// ----- bosses -----
export class Boss extends Fighter {
  constructor(kind, x, z, o = {}) {
    super(kind, { x, z, hp: o.hp || 1200, team: 'risen', name: o.name }); this.big = true; this.boss = true; this.radius = kind === 'stonehorn' ? 1.5 : .6;
    this.state = 'intro'; this.t = 0; this.cd = 3; this.phase = 1; this.vis = 1; this.dying = false; this.name = o.name || kind;
    if (o.tint) this.actor.model.traverse(m => { if (m.isMesh && m.material.color) m.material.color.multiply(new THREE.Color(o.tint)); });
    if (o.scale) { this.root.scale.setScalar(o.scale); this.height *= o.scale; }
    this.actor.play('idle'); this.light = { x, y: 2.5, z, color: kind === 'abbess' ? 0x9a4bff : 0xff4a2a, power: 40, dist: 20, flicker: .3 }; lamps.push(this.light);
  }
  hurt(d, ctx = {}) {
    if (!this.alive || this.state === 'intro') return false;
    this.hp -= d * (ctx.head ? .75 : 1); this.flash = .1; emit(this.x, 1.5, this.z, 8, { color: this.kind === 'abbess' ? 0xb98aff : 0x8a1010, speed: 3, life: .5, size: .12, grav: 3 });
    Snd.play('hitFlesh', { at: this, vol: .8 }); this.recent = (this.recent || 0) + d; hook('hit', this, ctx);
    if (this.hp <= this.max * .5 && this.phase === 1) { this.phase = 2; hook('bossPhase', this); }
    if (this.hp <= 0) { this.alive = false; this.state = 'dead'; this.dyingT = 0; this.actor.play('death', .1); Snd.play(this.kind === 'abbess' ? 'abbessDeath' : 'reveal'); G.shake = 1.5; emit(this.x, 1.5, this.z, 80, { color: 0xffd0a0, speed: 8, life: 1.6, size: .2, grav: 1 }); G.kills += (ctx.from === G.player ? 1 : 0); hook('bossDied', this); lamps.splice(lamps.indexOf(this.light), 1); }
    return true;
  }
  update(dt, targets) {
    this.hitFlash(dt);
    if (this.state === 'dead') { this.dyingT += dt; this.actor.update(dt); if (this.dyingT > 6) this.root.position.y = -(this.dyingT - 6) * .5; if (this.dyingT > 12) this.gone = true; return; }
    let tg = null, best = 1e9; for (const t of targets) { if (!t.alive) continue; const d = Math.hypot(t.x - this.x, t.z - this.z); if (d < best) { best = d; tg = t; } }
    this.t += dt; this.cd -= dt; const p2 = this.phase === 2;
    if (this.state === 'intro') { if (this.t > 2.8) { this.state = 'idle'; this.t = 0; this.cd = 1.5; } this.actor.update(dt); this.light.x = this.x; this.light.z = this.z; this.sync(); return; }
    if (tg) this.ry = angLerp(this.ry, Math.atan2(tg.x - this.x, tg.z - this.z), 1 - Math.exp(-(this.kind === 'stonehorn' && this.state === 'charge' ? 2 : 5) * dt));
    const dx = tg ? tg.x - this.x : 0, dz = tg ? tg.z - this.z : 0, d = Math.hypot(dx, dz) || 1;
    if (this.kind === 'abbess') this.abbess(dt, tg, d, p2); else this.horn(dt, tg, d, dx, dz, p2);
    this.light.x = this.x; this.light.z = this.z;
    this.root.visible = this.vis > .05; this.actor.update(dt); this.sync();
  }
  abbess(dt, tg, d, p2) {
    const S = this.state;
    if (S === 'idle') {
      this.actor.play('idle', .3);
      if (this.cd <= 0) {
        const r = Math.random();
        if (d < 3.6 && r < .6) { this.go('swipe', Math.random() < .5 ? 'swipe' : 'swipe2'); }
        else if (r < .35) this.go('summon', 'summon'); else if (r < .8) this.go('bolt', 'scream'); else this.go('tele', 'laugh');
      }
    } else if (S === 'swipe') { const dur = this.actor.duration(this.anim) * .8; if (!this.did && this.t > dur * .45) { this.did = true; if (tg && d < 4.4) tg.hurt(28, { from: this, melee: true }); emit(this.x, 1.4, this.z, 10, { color: 0xb98aff, speed: 4, life: .4, size: .15 }); } if (this.t > dur) this.rest(); }
    else if (S === 'bolt') { const dur = this.actor.duration('scream'); if (!this.did && this.t > dur * .35) { this.did = true; Snd.play('abbessScream', { vol: .9 }); const n = p2 ? 3 : 1; for (let i = 0; i < n; i++) fireBolt(this, tg, (i - (n - 1) / 2) * .22); } if (this.t > dur * .9) this.rest(); }
    else if (S === 'summon') { const dur = this.actor.duration('summon'); if (!this.did && this.t > dur * .5) { this.did = true; Snd.play('abbessSummon', { vol: .9 }); hook('abbessSummon', this); G.shake = .8; } if (this.t > dur * .95) this.rest(); }
    else if (S === 'tele') {
      if (this.t < .7) { this.vis = 1 - this.t / .7; } else if (!this.did) { this.did = true; emit(this.x, 1.5, this.z, 30, { color: 0xb98aff, speed: 5, life: .6, size: .2 }); Snd.play('stinger', { vol: .5 }); const a = rand(0, 6.28), rr = rand(5, 9); const cx = tg ? tg.x : this.x, cz = tg ? tg.z : this.z; this.x = cx + Math.sin(a) * rr; this.z = cz + Math.cos(a) * rr; resolve(this, 1); emit(this.x, 1.5, this.z, 30, { color: 0xb98aff, speed: 5, life: .6, size: .2 }); }
      else this.vis = Math.min(1, (this.t - .7) / .5);
      if (this.t > 1.3) { this.vis = 1; this.rest(); }
    }
  }
  horn(dt, tg, d, dx, dz, p2) {
    const S = this.state;
    if (S === 'idle') {
      if (d > 5) { this.actor.play('walk', .3, 1.2); const sp = (p2 ? 3.0 : 2.3); this.x += dx / d * sp * dt; this.z += dz / d * sp * dt; resolve(this, this.radius); } else this.actor.play('idle', .3);
      if (this.cd <= 0) { if (d < 6) this.go('slam', 'attack'); else this.go('roar', 'scream'); }
    } else if (S === 'slam') { const dur = this.actor.duration('attack') * .9; if (!this.did && this.t > dur * .5) { this.did = true; G.shake = 1.2; Snd.play('rumble', { vol: .9 }); emit(this.x + Math.sin(this.ry) * 2.5, .3, this.z + Math.cos(this.ry) * 2.5, 40, { color: 0x6a5a48, speed: 6, life: .8, size: .3, grav: 4, up: 1 }); if (tg && d < 6.4) tg.hurt(p2 ? 42 : 34, { from: this, melee: true }); } if (this.t > dur) this.rest(); }
    else if (S === 'roar') { const dur = this.actor.duration('scream'); if (!this.did && this.t > .3) { this.did = true; Snd.play('abbessScream', { vol: 1, rate: .6 }); G.shake = 1; } if (this.t > dur * .85) { this.state = 'charge'; this.t = 0; this.actor.play('run', .2, 1.8); const f = fwd(this.ry); this.cdir = f; } }
    else if (S === 'charge') { this.x += this.cdir.x * (p2 ? 8.5 : 7) * dt; this.z += this.cdir.z * (p2 ? 8.5 : 7) * dt; const px = this.x, pz = this.z; resolve(this, this.radius); const hitWall = Math.hypot(this.x - px, this.z - pz) > .01;
      emit(this.x, .2, this.z, 2, { color: 0x6a5a48, speed: 2, life: .6, size: .25, grav: 2, up: 1 });
      if (tg && Math.hypot(tg.x - this.x, tg.z - this.z) < 2.6 && !this.didHit) { this.didHit = true; tg.hurt(38, { from: this, melee: true }); }
      if (this.t > 1.5 || hitWall) { this.didHit = false; G.shake = hitWall ? 1.2 : .3; this.state = 'stun'; this.t = 0; this.actor.play('idle', .2); } }
    else if (S === 'stun') { if (this.t > 1.4) this.rest(); }
  }
  go(s, a) { this.state = s; this.anim = a; this.t = 0; this.did = false; this.actor.play(a, .15); if (s === 'tele') Snd.play('abbessLaugh', { vol: .8 }); }
  rest() { this.state = 'idle'; this.t = 0; this.cd = this.kind === 'abbess' ? (this.phase === 2 ? 1.9 : 3.0) : (this.phase === 2 ? 2.0 : 3.0); }
}

function fireBolt(boss, tg, off) {
  const geo = new THREE.SphereGeometry(.35, 12, 10), mat = new THREE.MeshBasicMaterial({ color: 0xc89bff });
  const m = new THREE.Mesh(geo, mat); const s = fireSprite(0xaa66ff, 2.6); m.add(s); scene.add(m);
  const o = new THREE.Vector3(boss.x + Math.sin(boss.ry) * .8, 1.7, boss.z + Math.cos(boss.ry) * .8);
  let dir = tg ? new THREE.Vector3(tg.x - o.x, 1.1 - o.y, tg.z - o.z).normalize() : new THREE.Vector3(Math.sin(boss.ry), 0, Math.cos(boss.ry));
  dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
  m.position.copy(o); G.bolts.push({ m, p: o.clone(), v: dir.multiplyScalar(9), life: 6, from: boss });
}
function updateBolts(dt) {
  for (const b of G.bolts) {
    b.life -= dt; b.p.addScaledVector(b.v, dt); b.m.position.copy(b.p); emit(b.p.x, b.p.y, b.p.z, 2, { color: 0xb98aff, speed: .6, life: .5, size: .12, grav: 0 });
    for (const t of everyone()) { if (t.team === b.from.team) continue; if (Math.hypot(t.x - b.p.x, t.z - b.p.z) < .8 && b.p.y < 2.2) { t.hurt(20, { from: b.from }); b.life = 0; emit(b.p.x, b.p.y, b.p.z, 24, { color: 0xb98aff, speed: 5, life: .6, size: .18 }); } }
    if (b.p.y < 0) b.life = 0;
    if (b.life <= 0) { scene.remove(b.m); b.dead = true; }
  }
  G.bolts = G.bolts.filter(b => !b.dead);
}

// ----- rival tributes (bots, and spared allies) -----
export class Bot extends Fighter {
  constructor(region, tribute, x, z, o = {}) {
    super('tribute', { x, z, team: region.id, name: o.name || tribute.name, hp: o.hp || 100 });
    this.region = region; this.tribute = tribute; dress(this.actor, region, tribute); this.skill = o.skill ?? .6;
    this.state = 'fight'; this.cd = rand(1, 2.5); this.strafe = Math.random() < .5 ? 1 : -1; this.sT = rand(1, 3); this.ally = false; this.canYield = o.canYield ?? false;
    this.actor.play('idle'); this.yieldT = 0; this.owner = o.owner || 'host'; this.remoteId = o.id; this.stepT = 0; this.shootT = 0;
  }
  setAlly(p) { this.ally = true; this.team = p.team; this.state = 'fight'; this.canYield = false; this.hp = this.max; this.alive = true; hook('allyJoined', this); }
  hurt(d, ctx = {}) {
    if (!this.alive) return false; if (ctx.from && ctx.from.team === this.team) return false;
    if (this.state === 'yield') { if (ctx.from === G.player) { this.die(ctx); } return true; }
    this.hp -= d; this.flash = .12; emit(this.x, 1.3, this.z, 10, { color: 0x8a0f16, speed: 3, life: .5, size: .1, grav: 9 }); Snd.play('hitFlesh', { at: this, vol: .8 });
    if (ctx.from === G.player) hook('hit', this, ctx);
    if (this.canYield && this.hp < this.max * .3 && !this.ally) { this.state = 'yield'; this.hp = this.max * .3; this.actor.play('fall', .15); hook('botYield', this); return true; }
    if (this.hp <= 0) this.die(ctx); return true;
  }
  die(ctx) { this.alive = false; this.state = 'dead'; this.dyingT = 0; this.actor.play('fall', .1); Snd.play('fall', { at: this }); if (ctx && ctx.from === G.player) G.kills++; dropLoot(this.x, this.z, true); hook('botDied', this, ctx); }
  update(dt, foes) {
    this.hitFlash(dt);
    if (this.state === 'dead') { this.dyingT += dt; this.actor.update(dt); if (this.dyingT > 6) this.root.position.y = -(this.dyingT - 6) * .4; if (this.dyingT > 9) this.gone = true; return; }
    if (this.state === 'yield') { this.actor.update(dt); this.sync(); return; }
    this.cd -= dt; this.shootT -= dt; this.sT -= dt; if (this.sT < 0) { this.sT = rand(1, 3); this.strafe = -this.strafe; }
    let tg = null, best = 1e9; for (const t of foes) { if (!t.alive || t.team === this.team) continue; if (t.state === 'yield') continue; const d = Math.hypot(t.x - this.x, t.z - this.z); if (d < best && d < 45) { best = d; tg = t; } }
    let mx = 0, mz = 0, moving = false;
    if (this.ally && G.player && G.player.alive) { const p = G.player, dp = Math.hypot(p.x - this.x, p.z - this.z); if (dp > 7 || !tg) { mx = (p.x - this.x) / dp; mz = (p.z - this.z) / dp; if (dp < 3.5) { mx = mz = 0; } else moving = true; } }
    if (tg) {
      const dx = tg.x - this.x, dz = tg.z - this.z, d = best || 1, want = this.ally ? 12 : 13;
      this.ry = angLerp(this.ry, Math.atan2(dx, dz), 1 - Math.exp(-9 * dt));
      if (!this.ally || Math.hypot(mx, mz) < .1) {
        let k = d > want + 3 ? 1 : d < want - 4 ? -1 : 0;
        mx = dx / d * k + (-dz / d) * this.strafe * .7; mz = dz / d * k + (dx / d) * this.strafe * .7; moving = true;
      }
      if (this.cd <= 0 && d < 36 && losClear(this, tg)) {
        this.cd = rand(1.4, 2.6) / (.6 + this.skill); this.shootT = .4;
        const o = new THREE.Vector3(this.x + Math.sin(this.ry) * .3, 1.45, this.z + Math.cos(this.ry) * .3);
        const tv = tg.vx !== undefined ? { x: tg.vx || 0, z: tg.vz || 0 } : { x: 0, z: 0 }, tt = d / 36, sp = (1 - this.skill) * .08 * d;
        const aim = new THREE.Vector3(tg.x + tv.x * tt + rand(-sp, sp), (tg.height || 1.7) * .62 + rand(-sp, sp) * .3, tg.z + tv.z * tt + rand(-sp, sp));
        const dir = aim.sub(o).normalize(); dir.y += d * .004;
        spawnArrow(o, dir, { speed: 36, dmg: 14 + this.skill * 8, owner: this, team: this.team });
        this.actor.play('shoot', .05, 1.6); Snd.play('twang', { at: this, vol: .6 });
        hook('botShot', this, o, dir);
      }
    }
    const l = Math.hypot(mx, mz);
    if (l > .05) { mx /= l; mz /= l; const sp = 3.4; this.vx = mx * sp; this.vz = mz * sp; this.x += this.vx * dt; this.z += this.vz * dt; resolve(this, this.radius); if (!tg) this.ry = angLerp(this.ry, Math.atan2(mx, mz), 1 - Math.exp(-8 * dt)); if (this.shootT <= 0) this.actor.play('walk', .2); }
    else { this.vx = this.vz = 0; if (this.shootT <= 0) this.actor.play('idle', .2); }
    if (this.shootT <= 0 && l > .05 && tg) { const f = fwd(this.ry), sf = mx * f.x + mz * f.z; if (sf < -.5) this.actor.play('back', .2); else if (Math.abs(sf) < .5) this.actor.play((-Math.cos(this.ry) * mx + Math.sin(this.ry) * mz) > 0 ? 'right' : 'left', .2); }
    this.actor.update(dt); this.sync();
  }
}

// ----- a person on the other end of a network connection -----
export class Remote extends Fighter {
  constructor(id, region, tribute, name) {
    super('tribute', { team: region.id, name }); this.id = id; this.region = region; this.tribute = tribute; dress(this.actor, region, tribute);
    this.tx = 0; this.tz = 0; this.tr = 0; this.first = true; this.alive = true; this.actor.play('idle'); this.state = 'live'; this.score = 0;
    this.proxyTarget = { team: region.id, alive: true, x: 0, z: 0, y: 0, height: 1.7, radius: .45, hurt: (d, ctx) => { G.net && G.net.send({ t: 'dmg', to: this.id, d, by: G.player ? G.player.name : '', byRegion: G.player ? G.player.team : '', head: !!ctx.head }); return true; } };
    this.lx = 0; this.lz = 0; this.shootT = 0; this.rollT = 0;
  }
  set(m) { this.tx = m.x; this.tz = m.z; this.tr = m.r; this.hp = m.hp; this.state = m.s; if (this.first) { this.x = m.x; this.z = m.z; this.ry = m.r; this.first = false; } if (m.a === 'roll' && this.rollT <= 0) { this.rollT = .5; this.actor.play('roll', .08, 1.25); } if (m.s === 'dead' && this.alive) { this.alive = false; this.actor.play('fall', .1); } if (m.s === 'live' && !this.alive) { this.alive = true; } }
  hurt() { return false; }
  update(dt) {
    this.hitFlash(dt); this.shootT -= dt; this.rollT -= dt;
    const px = this.x, pz = this.z; this.x = lerp(this.x, this.tx, 1 - Math.exp(-12 * dt)); this.z = lerp(this.z, this.tz, 1 - Math.exp(-12 * dt)); this.ry = angLerp(this.ry, this.tr, 1 - Math.exp(-14 * dt));
    const sp = Math.hypot(this.x - px, this.z - pz) / dt; this.vx = (this.x - px) / dt; this.vz = (this.z - pz) / dt;
    if (this.alive && this.shootT <= 0 && this.rollT <= 0) { if (sp > 4.8) this.actor.play('run', .2); else if (sp > .5) this.actor.play('walk', .2, clamp(sp / 3.2, .6, 1.3)); else this.actor.play('idle', .2); }
    this.proxyTarget.x = this.x; this.proxyTarget.z = this.z; this.proxyTarget.alive = this.alive; this.proxyTarget.team = this.team;
    this.actor.update(dt); this.sync();
  }
}

// ----- loot & supply drops -----
const lootGeo = new THREE.OctahedronGeometry(.18);
export function dropLoot(x, z, big = false) {
  const kind = Math.random() < (big ? .5 : .22) ? 'pot' : 'ammo';
  const m = new THREE.Mesh(lootGeo, new THREE.MeshStandardMaterial({ color: kind === 'pot' ? 0xd33a48 : 0xd8c070, emissive: kind === 'pot' ? 0x801018 : 0x706020, emissiveIntensity: 1.2, roughness: .4, metalness: .5 }));
  m.position.set(x, .5, z); scene.add(m); const s = fireSprite(kind === 'pot' ? 0xff4050 : 0xffd060, .8); s.userData.keep = false; s.position.y = .1; m.add(s); G.pickups.push({ m, kind, x, z, t: 0 });
}
function updatePickups(dt) {
  const p = G.player;
  for (const k of G.pickups) {
    k.t += dt; k.m.position.y = .55 + Math.sin(k.t * 3) * .1; k.m.rotation.y += dt * 2;
    if (p && p.alive && Math.hypot(p.x - k.x, p.z - k.z) < 1.5) {
      k.dead = true; if (k.kind === 'pot') { p.pots++; hook('toast', '+1 Healing Draught'); } else { const n = 20 + Math.floor(Math.random() * 14); p.ammo = Math.min(p.ammoMax, p.ammo + n); hook('toast', `+${n} arrows`); }
      Snd.play('bell', { vol: .2, rate: 1.8 }); emit(k.x, .6, k.z, 14, { color: 0xffe090, speed: 2, life: .6, size: .1, grav: -1 });
    }
    if (k.t > 90) k.dead = true;
  }
  for (const k of G.pickups) if (k.dead) scene.remove(k.m); G.pickups = G.pickups.filter(k => !k.dead);
}
export async function spawnDrop(x, z, id) {
  await A.loadProps(['crate', 'parachute']);
  const g = new THREE.Group(); const crate = A.prop('crate', { h: 1.0 }); const chute = A.prop('parachute', { h: 3.2 }); chute.position.y = 1.9; g.add(crate, chute); g.position.set(x, 55, z); scene.add(g);
  Snd.play('bell', { vol: .8 }); const d = { g, chute, x, z, id, landed: false, open: false, light: { x, y: 3, z, color: 0xffe0a0, power: 18, dist: 10, flicker: .1 } }; lamps.push(d.light); G.drops.push(d); hook('toast', 'A sponsor drop is on its way — listen for the bell');
  return d;
}
function updateDrops(dt) {
  for (const d of G.drops) {
    if (!d.landed) { d.g.position.y -= 5.5 * dt; d.g.rotation.y += dt * .3; if (d.g.position.y <= 0) { d.g.position.y = 0; d.landed = true; Snd.play('fall', { at: d, vol: .7 }); emit(d.x, .2, d.z, 20, { color: 0x6a5a48, speed: 3, life: .8, size: .25, grav: 3 }); } }
    else if (d.chute && d.chute.parent) { d.chute.scale.multiplyScalar(1 - dt * 1.5); d.chute.position.y -= dt * .5; if (d.chute.scale.x < .1) d.g.remove(d.chute); }
  }
  G.drops = G.drops.filter(d => { if (d.gone) { scene.remove(d.g); lamps.splice(lamps.indexOf(d.light), 1); return false; } return true; });
}
export function nearestDrop(p) { for (const d of G.drops) if (d.landed && !d.open && Math.hypot(d.x - p.x, d.z - p.z) < 2.6) return d; return null; }
export function openDrop(d, p) { d.open = true; d.gone = true; p.ammo = Math.min(p.ammoMax, p.ammo + 50); p.pots += 1; p.heal(25); Snd.play('bell', { vol: .6, rate: 1.3 }); emit(d.x, 1, d.z, 40, { color: 0xffe090, speed: 4, life: 1, size: .15, grav: -1, up: 1 }); hook('toast', '+50 arrows · +1 Healing Draught'); hook('dropOpened', d); }

// ---------- world update ----------
export function updateActors(dt) {
  const foesOfRisen = [G.player, ...G.bots, ...G.remotes.values()].filter(f => f && f.alive && f.state !== 'yield');
  for (const e of G.enemies) { if (e.boss) e.update(dt, foesOfRisen); else e.update(dt, foesOfRisen); }
  G.enemies = G.enemies.filter(e => { if (e.gone) { e.dispose(); return false; } return true; });
  const botFoes = [...G.enemies.filter(e => e.alive && e.state !== 'rise'), G.player, ...G.bots, ...[...G.remotes.values()].map(r => r.alive ? r : null)].filter(Boolean);
  for (const b of G.bots) b.update(dt, botFoes);
  G.bots = G.bots.filter(b => { if (b.gone) { b.dispose(); return false; } return true; });
  for (const r of G.remotes.values()) r.update(dt);
  updateArrows(dt); updateBolts(dt); updatePickups(dt); updateDrops(dt);
  G.beaconTargets && G.beaconTargets.forEach(b => b.update && b.update(dt));
}
export function clearActors() {
  for (const e of G.enemies) e.dispose(); for (const b of G.bots) b.dispose(); for (const r of G.remotes.values()) r.dispose();
  for (const a of G.arrows) scene.remove(a.m); for (const b of G.bolts) scene.remove(b.m); for (const k of G.pickups) scene.remove(k.m); for (const d of G.drops) scene.remove(d.g);
  G.enemies = []; G.bots = []; G.remotes = new Map(); G.arrows = []; G.bolts = []; G.pickups = []; G.drops = []; G.beaconTargets = [];
}
