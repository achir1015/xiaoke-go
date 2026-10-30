// 圍棋教學：動畫小棋盤＋語音講解＋練習題
import { $$, h, sleep } from './util.js';
import { Board, BLACK, WHITE, EMPTY, fromGtp, toGtp, starPoints, scorePosition } from './go.js';
import { LESSONS, pts } from './lessons.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const c of kids) el.append(c);
  return el;
};
const COLS = 'ABCDEFGHJKLMNOPQRST';

// ---------------- 小棋盤（SVG） ----------------
class MiniBoard {
  constructor(host, onClick) {
    this.host = host;
    this.onClick = onClick;
    this.stones = new Map(); // i → { el, c }
    this.layout(9);
  }

  layout(n) {
    this.n = n;
    this.host.innerHTML = '';
    const cell = this.cell = n === 9 ? 56 : n === 13 ? 40 : 28;
    const o = this.o = 40;
    const W = o * 2 + cell * (n - 1);
    this.svg = svg('svg', { viewBox: `0 0 ${W} ${W}`, class: 'gb-svg' });
    const defs = svg('defs');
    defs.innerHTML = '<radialGradient id="gbB" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6a6a72"/><stop offset="0.45" stop-color="#1c1c20"/><stop offset="1" stop-color="#050506"/></radialGradient>'
      + '<radialGradient id="gbW" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#eeece4"/><stop offset="1" stop-color="#c8c4b8"/></radialGradient>';
    this.svg.append(defs, svg('rect', { x: 2, y: 2, width: W - 4, height: W - 4, rx: 14, class: 'gb-bg' }));
    const grid = svg('g', { class: 'gb-grid' });
    const X = (k) => o + k * cell;
    for (let k = 0; k < n; k++) {
      grid.append(svg('line', { x1: X(0), y1: X(k), x2: X(n - 1), y2: X(k) }), svg('line', { x1: X(k), y1: X(0), x2: X(k), y2: X(n - 1) }));
      grid.append(svg('text', { x: X(k), y: o - 18, class: 'gb-coord' }, document.createTextNode(COLS[k])));
      grid.append(svg('text', { x: o - 22, y: X(k) + 5, class: 'gb-coord' }, document.createTextNode(String(n - k))));
    }
    for (const p of starPoints(n)) grid.append(svg('circle', { cx: X(p % n), cy: X((p / n) | 0), r: 4, class: 'gb-star' }));
    this.zones = svg('g'); this.layer = svg('g'); this.marks = svg('g'); this.top = svg('g');
    this.svg.append(grid, this.zones, this.layer, this.marks, this.top);
    this.svg.addEventListener('click', (e) => {
      const pt = this.svg.createSVGPoint();
      pt.x = e.clientX; pt.y = e.clientY;
      const p = pt.matrixTransform(this.svg.getScreenCTM().inverse());
      const x = Math.round((p.x - o) / cell), y = Math.round((p.y - o) / cell);
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      if (Math.hypot(p.x - X(x), p.y - X(y)) > cell * 0.48) return;
      this.onClick && this.onClick(y * n + x);
    });
    this.host.append(this.svg);
    this.stones.clear();
  }

  xy(i) { return [this.o + (i % this.n) * this.cell, this.o + ((i / this.n) | 0) * this.cell]; }

  stoneEl(c) {
    const r = this.cell * 0.46;
    const g = svg('g', { class: 'gs' });
    g.append(svg('circle', { r, cx: 2, cy: 3, class: 'gs-shadow' }), svg('circle', { r, fill: c === BLACK ? 'url(#gbB)' : 'url(#gbW)', class: c === BLACK ? 'gs-b' : 'gs-w' }));
    return g;
  }

  // 同步棋盤：新棋子掉落、被提的淡出
  sync(board, animate = true) {
    for (const [i, s] of this.stones) {
      if (board.cells[i] !== s.c) {
        this.stones.delete(i);
        if (animate) { s.el.classList.add('gone'); setTimeout(() => s.el.remove(), 450); } else s.el.remove();
      }
    }
    for (let i = 0; i < board.cells.length; i++) {
      const c = board.cells[i];
      if (!c || this.stones.has(i)) continue;
      const el = this.stoneEl(c);
      const [x, y] = this.xy(i);
      el.setAttribute('transform', `translate(${x} ${y})`);
      if (animate) el.classList.add('drop');
      this.layer.append(el);
      this.stones.set(i, { el, c });
    }
  }

  clearMarks() { this.marks.innerHTML = ''; this.top.innerHTML = ''; this.zones.innerHTML = ''; }

  libs(list) {
    for (const i of list) { const [x, y] = this.xy(i); this.marks.append(svg('circle', { cx: x, cy: y, r: this.cell * 0.17, class: 'gm-lib' })); }
  }

  mark(i, text) {
    const [x, y] = this.xy(i);
    const onStone = this.stones.get(i);
    const t = svg('text', { x, y: y + this.cell * 0.15, class: 'gm-text' + (onStone && onStone.c === BLACK ? ' light' : ''), 'font-size': text.length > 1 ? this.cell * 0.32 : this.cell * 0.44 }, document.createTextNode(text));
    this.top.append(t);
  }

  stars() {
    for (const p of starPoints(this.n)) { const [x, y] = this.xy(p); this.marks.append(svg('circle', { cx: x, cy: y, r: this.cell * 0.3, class: 'gm-star' })); }
  }

  territory(owner) {
    const s = this.cell * 0.36;
    for (let i = 0; i < owner.length; i++) {
      if (!owner[i] || this.stones.has(i)) continue;
      const [x, y] = this.xy(i);
      this.zones.append(svg('rect', { x: x - s / 2, y: y - s / 2, width: s, height: s, class: owner[i] === BLACK ? 'gz-b' : 'gz-w' }));
    }
  }

  last(i) {
    if (i == null || i < 0) return;
    const [x, y] = this.xy(i);
    const s = this.stones.get(i);
    this.top.append(svg('circle', { cx: x, cy: y, r: this.cell * 0.16, class: 'gm-last' + (s && s.c === BLACK ? ' light' : '') }));
  }

  flash(i, cls) {
    const [x, y] = this.xy(i);
    const c = svg('circle', { cx: x, cy: y, r: this.cell * 0.5, class: cls });
    this.top.append(c);
    setTimeout(() => c.remove(), 900);
  }
}

// ---------------- 語音 ----------------
class Narrator {
  constructor() {
    this.on = true;
    this.rate = 1;
    this.voice = null;
    this.onReady = null;
    this.pick();
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', () => { this.pick(); if (this.onReady) this.onReady(); });
      let n = 0;
      const poll = () => { if (this.voice || ++n > 30) { if (this.onReady) this.onReady(); return; } this.pick(); setTimeout(poll, 200); };
      poll();
    }
  }
  pick() {
    if (!('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices();
    const pref = [/Yating/i, /Hanhan/i, /Mei-?Jia/i, /Zhiwei/i];
    this.voice = pref.map((re) => vs.find((v) => re.test(v.name))).find(Boolean)
      || vs.find((v) => /zh[-_]TW/i.test(v.lang)) || vs.find((v) => /zh[-_]HK/i.test(v.lang)) || vs.find((v) => /^zh/i.test(v.lang)) || null;
  }
  get native() { return window.xk && window.xk.tts && window.xk.tts.available() ? window.xk.tts : null; }
  get available() { if (this.native) return true; if (!this.voice) this.pick(); return 'speechSynthesis' in window && !!this.voice; }
  get voiceName() { return this.native ? this.native.voiceName() : this.voice ? this.voice.name : ''; }
  stop() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); }
  pause() { if (this.native) this.native.stop(); else if ('speechSynthesis' in window) speechSynthesis.pause(); }
  resume() { if (!this.native && 'speechSynthesis' in window) speechSynthesis.resume(); }
  speak(text) {
    const plain = String(text).replace(/[「」（）()]/g, ' ').replace(/([A-T])(\d{1,2})/g, '$1 $2');
    const est = 700 + plain.length * 210 / this.rate;
    if (!this.on || !this.available) return sleep(Math.min(9000, 900 + plain.length * 95));
    if (this.native) { this.native.stop(); return this.native.speak(plain, this.rate); }
    return new Promise((resolve) => {
      this.stop();
      const u = new SpeechSynthesisUtterance(plain);
      u.voice = this.voice; u.lang = this.voice.lang; u.rate = this.rate; u.pitch = 1;
      let done = false;
      const fin = () => { if (!done) { done = true; clearTimeout(t); resolve(); } };
      const t = setTimeout(fin, est * 2 + 4000);
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    });
  }
}

// ---------------- 教學畫面 ----------------
export class Guide {
  constructor(root, { onBack, settings, save }) {
    this.root = root;
    this.onBack = onBack;
    this.save = save;
    this.narr = new Narrator();
    this.narr.on = settings.guideVoice !== false;
    this.narr.rate = settings.guideRate || 1;
    this.narr.onReady = () => this.renderVoice();
    this.lesson = 0;
    this.token = 0;
    this.paused = false;
    this.practice = null;
    this.autoNext = true;
    this.build();
  }

  build() {
    const r = this.root;
    r.innerHTML = '';
    this.list = h('div', { class: 'gd-list' });
    this.caption = h('div', { class: 'gd-caption' }, '');
    this.boardHost = h('div', { class: 'gd-board' });
    this.board = new MiniBoard(this.boardHost, (i) => this.onBoardClick(i));
    this.btnPlay = h('button', { class: 'primary', id: 'gdPlay', onclick: () => this.togglePlay() }, '⏸ 暫停');
    this.btnVoice = h('button', { id: 'gdVoice', onclick: () => this.toggleVoice() });
    this.rateSel = h('select', { id: 'gdRate', onchange: () => { this.narr.rate = Number(this.rateSel.value); this.save({ guideRate: this.narr.rate }); } },
      [[0.8, '慢'], [1, '一般'], [1.2, '快']].map(([v, l]) => h('option', { value: v, selected: v === this.narr.rate }, `語速：${l}`)));
    this.status = h('div', { class: 'gd-status muted small' });
    r.append(
      h('div', { class: 'gd-head' }, h('button', { class: 'ghost', onclick: () => this.close() }, '⟵ 首頁'), h('h2', {}, '📖 圍棋教學'), h('span', { class: 'muted small' }, '動畫＋語音講解，每課最後有練習')),
      h('div', { class: 'gd-body' },
        this.list,
        h('div', { class: 'gd-main' },
          this.caption,
          this.boardHost,
          h('div', { class: 'gd-ctrl' },
            h('button', { onclick: () => this.go(this.lesson - 1) }, '⏮ 上一課'),
            h('button', { onclick: () => this.go(this.lesson) }, '↺ 重播'),
            this.btnPlay,
            h('button', { onclick: () => this.go(this.lesson + 1) }, '下一課 ⏭'),
            this.btnVoice, this.rateSel),
          this.status)));
    this.renderVoice();
    this.renderList();
  }

  get lessons() { return LESSONS; }

  open(i = 0) { this.go(i); }

  close() {
    this.token++;
    this.narr.stop();
    this.onBack && this.onBack();
  }

  renderList() {
    this.list.innerHTML = '';
    this.lessons.forEach((l, i) => this.list.append(h('button', { class: 'gd-item' + (i === this.lesson ? ' on' : ''), onclick: () => this.go(i) }, h('span', { class: 'n' }, String(i + 1)), l.title)));
  }

  renderVoice() {
    const ok = this.narr.available;
    this.btnVoice.textContent = !ok ? '🔇 無語音' : this.narr.on ? '🔊 語音講解：開' : '🔈 語音講解：關';
    this.btnVoice.disabled = !ok;
    this.btnVoice.title = ok ? `使用語音：${this.narr.voiceName}` : '這台裝置沒有中文語音，講解會以文字顯示';
  }

  toggleVoice() {
    this.narr.on = !this.narr.on;
    if (!this.narr.on) this.narr.stop();
    this.save({ guideVoice: this.narr.on });
    this.renderVoice();
  }

  togglePlay() {
    this.paused = !this.paused;
    this.btnPlay.textContent = this.paused ? '▶ 繼續' : '⏸ 暫停';
    if (this.paused) this.narr.pause(); else { this.narr.resume(); if (this.resumeGate) this.resumeGate(); }
  }

  async gate(tok) {
    while (this.paused && tok === this.token) await new Promise((r) => { this.resumeGate = r; setTimeout(r, 300); });
    return tok === this.token;
  }

  go(i) {
    if (i < 0 || i >= this.lessons.length) return;
    this.lesson = i;
    this.renderList();
    this.paused = false;
    this.btnPlay.textContent = '⏸ 暫停';
    this.run(++this.token);
  }

  P(s) { return fromGtp(s, this.n); }

  async run(tok) {
    this.narr.stop();
    this.practice = null;
    const lesson = this.lessons[this.lesson];
    this.status.textContent = `第 ${this.lesson + 1} 課：${lesson.title}（共 ${lesson.steps.length} 步）`;
    this.n = 9;
    this.b = new Board(9);
    this.board.layout(9);
    for (let k = 0; k < lesson.steps.length; k++) {
      if (!(await this.gate(tok))) return;
      const st = lesson.steps[k];
      if (st.setup) {
        const n = st.setup.size || 9;
        if (n !== this.n || !this.board.svg) { this.n = n; this.board.layout(n); }
        this.b = new Board(n);
        for (const i of pts(st.setup.B, (s) => this.P(s))) this.b.set(i, BLACK);
        for (const i of pts(st.setup.W, (s) => this.P(s))) this.b.set(i, WHITE);
        this.board.sync(this.b, false);
        this.board.sync(this.b, false);
      }
      this.board.clearMarks();
      this.caption.textContent = st.say;
      this.caption.classList.toggle('practice', !!st.practice);
      const talk = this.narr.speak(st.say);
      let last = -1;
      for (const mv of st.place || []) {
        await sleep(st.place.length > 6 ? 380 : 700);
        if (tok !== this.token) return;
        const [c, s] = mv.split(' ');
        last = this.P(s);
        this.b.place(last, c === 'B' ? BLACK : WHITE);
        this.board.sync(this.b);
        this.board.clearMarks();
        this.board.last(last);
      }
      this.decorate(st);
      if (last >= 0) this.board.last(last);
      if (st.practice) {
        const ok = await this.runPractice(tok, st.practice);
        if (!ok) return;
      } else {
        await talk;
        if (tok !== this.token) return;
        await sleep(st.pause || 800);
      }
    }
    if (tok !== this.token) return;
    const next = this.lesson + 1 < this.lessons.length;
    this.caption.textContent = next ? `「${lesson.title}」講解完畢，接著學「${this.lessons[this.lesson + 1].title}」。` : '圍棋教學全部看完了，快去和小柯 AI 下一盤吧！';
    await this.narr.speak(next ? '這一課講解完畢。' : '教學全部看完了，祝您下棋愉快！');
    if (next && this.autoNext && tok === this.token) { await sleep(900); if (tok === this.token) this.go(this.lesson + 1); }
  }

  decorate(st) {
    if (st.stars) this.board.stars();
    for (const s of st.libs || []) { const g = this.b.group(this.P(s)); if (g) this.board.libs([...g.libs]); }
    if (st.terr) this.board.territory(scorePosition(this.b, { komi: 0 }).owner);
    for (const [s, t] of Object.entries(st.marks || {})) this.board.mark(this.P(s), t);
  }

  // 練習：點棋盤作答，錯了說明原因
  runPractice(tok, pr) {
    const color = pr.color === 'W' ? WHITE : BLACK;
    const goalSet = new Set();
    if (Array.isArray(pr.goal)) pr.goal.forEach((s) => goalSet.add(this.P(s)));
    else if (typeof pr.goal === 'string' && pr.goal.startsWith('libs:')) { const g = this.b.group(this.P(pr.goal.slice(5))); if (g) g.libs.forEach((i) => goalSet.add(i)); }
    this.status.textContent = pr.pick ? '練習中：在棋盤上點選答案（點錯會告訴您原因）' : `練習中：輪到${color === BLACK ? '黑' : '白'}棋，請在棋盤上落子`;
    return new Promise((resolve) => {
      const correct = async (i, captured) => {
        this.practice = null;
        this.board.clearMarks();
        this.board.flash(i, 'gm-good');
        if (!pr.pick) { this.board.sync(this.b); this.board.last(i); }
        const msg = captured ? `答對了！提掉 ${captured} 顆子。` : '答對了！做得好。';
        this.caption.textContent = msg;
        await this.narr.speak(msg);
        this.status.textContent = '';
        await sleep(600);
        resolve(tok === this.token);
      };
      this.practice = {
        click: async (i) => {
          if (tok !== this.token) return;
          if (pr.pick) {
            if (goalSet.has(i)) { await correct(i, 0); return; }
            this.board.flash(i, 'gm-wrong');
            const why = pr.ko ? (this.b.cells[i] ? '這裡已經有棋子了。' : '這一點可以下喔。找找看剛剛被提走的那個位置。') : this.b.cells[i] ? '這裡有棋子，氣是旁邊的空交叉點。' : '這一點沒有和黑棋相鄰，不是它的氣。';
            this.caption.textContent = `✕ ${why}\n再試一次，或按「看答案」。`;
            this.narr.speak(why);
            return;
          }
          if (this.b.cells[i] !== EMPTY) { this.board.flash(i, 'gm-wrong'); this.say('這裡已經有棋子了，要下在空的交叉點。'); return; }
          const t = this.b.clone();
          const r = t.place(i, color);
          if (!r || r.suicide) { this.board.flash(i, 'gm-wrong'); this.say('這一點是禁著點：下了自己會沒有氣。'); return; }
          const ok = pr.goal === 'capture' ? r.captured.length > 0 : goalSet.has(i);
          if (ok) { this.b = t; await correct(i, r.captured.length); return; }
          this.board.flash(i, 'gm-wrong');
          this.say(pr.goal === 'capture' ? `下在 ${toGtp(i, this.n)} 還提不到子，數數看白棋還剩哪一口氣？` : '這一手可以下，但不是這題要的答案，再想想看。');
        },
      };
      const show = h('button', { class: 'gd-answer', onclick: () => {
        if (!this.practice) return;
        let ans = [...goalSet];
        if (pr.goal === 'capture') for (let i = 0; i < this.b.cells.length; i++) { if (this.b.cells[i]) continue; const r = this.b.clone().place(i, color); if (r && !r.suicide && r.captured.length) ans.push(i); }
        this.board.libs(ans);
        this.caption.textContent = '綠點就是答案，點它試試看。';
        show.remove();
      } }, '看答案');
      this.status.append(' ', show);
    });
  }

  say(text) {
    this.caption.textContent = `✕ ${text}\n再試一次，或按「看答案」。`;
    this.narr.speak(text);
  }

  onBoardClick(i) { if (this.practice) this.practice.click(i); }
}

export { toGtp };
