// audio.js —— 音效与 BGM（FR-15、API-27~API-31）
// 设计要点：① 首次用户交互后才创建 AudioContext（浏览器自动播放策略 + NFR-01f 懒加载）；
//          ② 合成音效，零音频文件成本（NFR-01e）；③ 不可用时全部接口降级为空操作（ERR-06、AC-28）。

let ctx = null;
let sfxGain = null;
let musicGain = null;
let available = false;
let noiseBuffer = null;
let bgmTimer = null;
let bgmVoices = [];
let volumes = { musicOn: true, musicVol: 80, sfxOn: true, sfxVol: 80 };

const SFX = {
  swap: { type: 'sine', from: 460, to: 680, dur: 0.09, gain: 0.22 },
  bounce: { type: 'square', from: 320, to: 190, dur: 0.13, gain: 0.16 },
  clear: { type: 'triangle', from: 620, to: 900, dur: 0.14, gain: 0.2 },
  special: { type: 'sawtooth', from: 240, to: 980, dur: 0.38, gain: 0.2 },
  win: { type: 'sine', arp: [523, 659, 784, 1047], dur: 0.16, gain: 0.22 },
  lose: { type: 'sine', arp: [392, 294], dur: 0.22, gain: 0.2 },
  button: { type: 'sine', from: 880, to: 880, dur: 0.05, gain: 0.14 },
};
const COMBO_BASE = 520;
const COMBO_STEP_HZ = 90;
const BGM_PATTERN = [220, 277, 330, 415, 330, 277];
const BGM_STEP_MS = 460;

/** API-27：首次用户交互后初始化（幂等） */
export function init() {
  if (available) return { ok: true, available: true };
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return { ok: false, available: false };
    ctx = new AC();
    sfxGain = ctx.createGain();
    musicGain = ctx.createGain();
    sfxGain.connect(ctx.destination);
    musicGain.connect(ctx.destination);
    applyVolumes();
    available = true;
    return { ok: true, available: true };
  } catch (e) {
    available = false;
    return { ok: false, available: false };
  }
}

/** API-31：应用设置页音量与开关（实时生效；不写存档，由应用层负责） */
export function setVolumes(patch = {}) {
  volumes = { ...volumes, ...patch };
  if (available) applyVolumes();
  if (!volumes.musicOn) stopBgm();
  return { ok: true };
}

export function getVolumes() {
  return { ...volumes };
}

function applyVolumes() {
  if (!available) return;
  const m = volumes.musicOn ? clamp01(volumes.musicVol / 100) * 0.45 : 0;
  const s = volumes.sfxOn ? clamp01(volumes.sfxVol / 100) * 0.9 : 0;
  musicGain.gain.value = m;
  sfxGain.gain.value = s;
}

function clamp01(x) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

/** API-28：播放音效；不可用时为空操作 */
export function play(name, opts = {}) {
  if (!available || !volumes.sfxOn) return { ok: false };
  try {
    if (name === 'combo') {
      const n = Math.max(1, Math.min(6, opts.combo || 1));
      tone({ type: 'triangle', from: COMBO_BASE + n * COMBO_STEP_HZ, to: COMBO_BASE + n * COMBO_STEP_HZ * 1.5, dur: 0.16, gain: 0.2 });
      return { ok: true };
    }
    const cfg = SFX[name];
    if (!cfg) return { ok: false };
    if (cfg.arp) {
      cfg.arp.forEach((freq, i) => {
        setTimeout(() => tone({ type: cfg.type, from: freq, to: freq, dur: cfg.dur, gain: cfg.gain }), i * cfg.dur * 1000 * 0.9);
      });
    } else {
      tone(cfg);
    }
    if (name === 'clear' || name === 'special') noise(cfg.dur, cfg.gain * 0.5);
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}

function tone({ type = 'sine', from, to, dur = 0.12, gain = 0.2 }) {
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t0);
  if (to && to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(40, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(sfxGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(dur, gain) {
  if (!noiseBuffer) {
    const len = Math.floor(ctx.sampleRate * 0.3);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.buffer = noiseBuffer;
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter); filter.connect(g); g.connect(sfxGain);
  src.start(t0);
  src.stop(t0 + dur);
}

/** API-29：播放/恢复 BGM（懒加载：无音频文件，按需合成循环） */
export function playBgm() {
  if (!available || !volumes.musicOn || bgmTimer) return { ok: false };
  let step = 0;
  const tick = () => {
    try {
      const freq = BGM_PATTERN[step % BGM_PATTERN.length];
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
      osc.connect(g); g.connect(musicGain);
      osc.start(t0); osc.stop(t0 + 0.5);
      bgmVoices.push(osc);
      if (bgmVoices.length > 8) bgmVoices = bgmVoices.slice(-4);
      step++;
    } catch (e) { /* 静默降级 */ }
  };
  tick();
  bgmTimer = setInterval(tick, BGM_STEP_MS);
  return { ok: true };
}

/** API-30：暂停 BGM（幂等） */
export function stopBgm() {
  if (bgmTimer) {
    clearInterval(bgmTimer);
    bgmTimer = null;
  }
  bgmVoices = [];
  return { ok: true };
}

export function isAvailable() {
  return available;
}
