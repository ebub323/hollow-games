// Your own horror sounds from the Unity project, played through WebAudio with simple distance falloff.
const FILES = {
  menu: 'MenuMusic.mp3', boss: 'BossMusic.mp3', lane: 'AmbienceLane.mp3', cemetery: 'AmbienceCemetery.mp3', fire: 'FireLoop.mp3',
  abbessLaugh: 'AbbessLaugh.mp3', abbessScream: 'AbbessScream.mp3', abbessReveal: 'AbbessReveal.mp3', abbessDeath: 'AbbessDeath.mp3', abbessSummon: 'AbbessSummon.mp3',
  hitFlesh: ['ArrowHitFlesh_01.mp3', 'ArrowHitFlesh_02.mp3'], hurt: ['TributeHurt_01.mp3', 'TributeHurt_02.mp3'],
  stinger: 'WaveStinger.mp3', cannon: 'Cannon.mp3', bell: 'SponsorBell.mp3', fall: 'BodyFall.mp3', reveal: 'BossReveal.mp3', announcer: 'Announcer.mp3',
  rumble: 'GraveRumble.mp3', erupt: 'GraveErupt.mp3', twang: 'BowTwang.mp3', swish: 'ArrowSwish.mp3',
  zdeath: ['ZombieDeath_01.mp3', 'ZombieDeath_02.mp3'], groan: ['ZombieGroan_01.mp3', 'ZombieGroan_02.mp3', 'ZombieGroan_03.mp3', 'ZombieGroan_04.mp3', 'ZombieGroan_05.mp3'],
  stepGrass: ['footstep_grass_000.ogg', 'footstep_grass_001.ogg', 'footstep_grass_002.ogg'], stepStone: ['footstep_concrete_000.ogg', 'footstep_concrete_001.ogg', 'footstep_concrete_002.ogg'],
  creak: 'creak1.ogg', shot: ['BowTwang.mp3', 'ArrowSwish.mp3'],
};
const VKEY = 'hollow-audio';
const vol0 = (() => { try { return { master: .9, music: .6, sfx: 1, ...JSON.parse(localStorage.getItem(VKEY)) }; } catch (e) { return { master: .9, music: .6, sfx: 1 }; } })();
export const Snd = {
  vol: vol0,
  setVol(k, v) { this.vol[k] = v; try { localStorage.setItem(VKEY, JSON.stringify(this.vol)); } catch (e) { } this.applyVol(); },
  applyVol() { if (!this.ctx) return; this.master.gain.value = this.muted ? 0 : this.vol.master; this.sfxBus.gain.value = this.vol.sfx; this.musBus.gain.value = this.vol.music; },
  ctx: null, master: null, buffers: {}, music: null, musicName: '', muted: false, listener: { x: 0, z: 0 },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return;
    this.ctx = new C(); this.master = this.ctx.createGain(); this.master.connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain(); this.sfxBus.connect(this.master);
    this.musBus = this.ctx.createGain(); this.musBus.connect(this.master); this.applyVol();
    if (this.pendingMusic) this.setMusic(this.pendingMusic);
  },
  async buf(url) {
    if (this.buffers[url]) return this.buffers[url];
    const p = fetch('audio/' + url).then(r => r.arrayBuffer()).then(a => this.ctx.decodeAudioData(a)).catch(() => null);
    this.buffers[url] = p; return p;
  },
  async play(name, { vol = 1, at = null, rate = 1, range = 22 } = {}) {
    if (!this.ctx || this.muted) return;
    const f = FILES[name]; if (!f) return; const url = Array.isArray(f) ? f[Math.floor(Math.random() * f.length)] : f;
    let v = vol;
    if (at) { const d = Math.hypot(at.x - this.listener.x, at.z - this.listener.z); v *= Math.max(0, 1 - d / range) ** 1.5; if (v < .02) return; }
    const b = await this.buf(url); if (!b) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; s.playbackRate.value = rate * (0.94 + Math.random() * .12);
    g.gain.value = v; s.connect(g); g.connect(this.sfxBus); s.start();
  },
  async setMusic(name, vol = 1) {
    this.pendingMusic = name; if (!this.ctx) return;
    if (this.musicName === name) return; this.musicName = name;
    if (this.music) { const old = this.music; old.g.gain.cancelScheduledValues(this.ctx.currentTime); old.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5); setTimeout(() => { try { old.s.stop(); } catch (e) { } }, 1700); this.music = null; }
    if (!name) return;
    const b = await this.buf(FILES[name]); if (!b || this.musicName !== name) return;
    const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; s.loop = true; g.gain.value = 0;
    s.connect(g); g.connect(this.musBus); s.start(); g.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + 2);
    this.music = { s, g };
  },
  toggle() { this.muted = !this.muted; this.applyVol(); },
};
