// 音效（WebAudio 即時合成：棋子落在榧木盤的清脆聲、提子、叫吃、停一手、勝負）
let ctx = null;
let enabled = true;
const ac = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

let master = null;
let volume = 0.8;
const out = () => {
  const c = ac();
  if (!master) { master = c.createGain(); master.gain.value = volume; master.connect(c.destination); }
  return master;
};

export function setSfx(on) { enabled = !!on; }
// 落子音效音量 0～1
export function setSfxVolume(v) {
  volume = Math.max(0, Math.min(1, Number(v) || 0));
  if (master) master.gain.value = volume;
}
export const sfxVolume = () => volume;

function tone(freq, dur, { type = 'sine', gain = 0.3, attack = 0.002, decay = dur, when = 0, slide = 0 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(g).connect(out());
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, { gain = 0.3, freq = 2000, q = 1, when = 0 } = {}) {
  const c = ac();
  const t = c.currentTime + when;
  const n = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(out());
  src.start(t);
}

export const sfx = {
  // 落子：石頭敲在木盤上的「啪」一聲（高頻敲擊＋木頭共鳴）
  move() {
    if (!enabled) return;
    noise(0.035, { gain: 0.9, freq: 3800, q: 1.6 });
    noise(0.09, { gain: 0.45, freq: 900, q: 3.5 });
    tone(310, 0.12, { gain: 0.22, slide: 0.85 });
    tone(2300, 0.03, { gain: 0.05 });
  },
  // 提子：落子後再加上棋子互碰的喀啦聲
  capture(k = 1) {
    if (!enabled) return;
    this.move();
    const n = Math.min(6, 1 + Math.floor(k / 2));
    for (let i = 0; i < n; i++) {
      noise(0.03, { gain: 0.35, freq: 4200 + Math.random() * 1500, q: 4, when: 0.12 + i * 0.055 + Math.random() * 0.02 });
      tone(1800 + Math.random() * 900, 0.03, { gain: 0.04, when: 0.12 + i * 0.055 });
    }
  },
  atari() {
    if (!enabled) return;
    tone(880, 0.22, { type: 'triangle', gain: 0.12, when: 0.1 });
    tone(1175, 0.3, { type: 'triangle', gain: 0.1, when: 0.2 });
  },
  pass() {
    if (!enabled) return;
    tone(660, 0.18, { type: 'sine', gain: 0.12 });
    tone(495, 0.26, { type: 'sine', gain: 0.1, when: 0.14 });
  },
  select() {
    if (!enabled) return;
    tone(1400, 0.05, { gain: 0.06 });
  },
  illegal() {
    if (!enabled) return;
    tone(220, 0.15, { type: 'square', gain: 0.05, slide: 0.8 });
  },
  win() {
    if (!enabled) return;
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.5, { type: 'triangle', gain: 0.16, when: i * 0.13 }));
  },
  lose() {
    if (!enabled) return;
    [440, 392, 349, 262].forEach((f, i) => tone(f, 0.55, { type: 'triangle', gain: 0.14, when: i * 0.17 }));
  },
  turn() {
    if (!enabled) return;
    tone(988, 0.12, { type: 'sine', gain: 0.12 });
    tone(1319, 0.2, { type: 'sine', gain: 0.1, when: 0.1 });
  },
  resume() { try { ac().resume(); } catch {} },
};
