// 圍棋規則引擎：棋盤、氣與提子、禁著（自殺、全局同形再現）、停著、數子／數目、SGF 棋譜
export const EMPTY = 0, BLACK = 1, WHITE = 2;
export const PASS = -1;
export const RESIGN = -2;
export const other = (c) => 3 - c;
export const colorName = (c) => (c === BLACK ? '黑' : c === WHITE ? '白' : '');
export const SIZES = [9, 13, 19];
const GTP_COLS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

// ---------------- 座標 ----------------
export const idx = (x, y, n) => y * n + x;
export const xOf = (i, n) => i % n;
export const yOf = (i, n) => (i / n) | 0;
// GTP（KataGo 使用）：欄 A～T（跳過 I），列由下往上 1～19
export function toGtp(i, n) {
  if (i === PASS) return 'pass';
  return GTP_COLS[xOf(i, n)] + String(n - yOf(i, n));
}
export function fromGtp(s, n) {
  s = String(s || '').trim().toUpperCase();
  if (s === 'PASS') return PASS;
  const x = GTP_COLS.indexOf(s[0]), row = parseInt(s.slice(1), 10);
  if (x < 0 || x >= n || !(row >= 1 && row <= n)) return null;
  return idx(x, n - row, n);
}
// SGF：兩個小寫字母（欄、列由上往下）；空字串或 tt 為停著
export function toSgf(i, n) {
  if (i === PASS) return '';
  return String.fromCharCode(97 + xOf(i, n)) + String.fromCharCode(97 + yOf(i, n));
}
export function fromSgf(s, n) {
  if (!s || (s === 'tt' && n <= 19)) return PASS;
  const x = s.charCodeAt(0) - 97, y = s.charCodeAt(1) - 97;
  if (!(x >= 0 && x < n && y >= 0 && y < n)) return null;
  return idx(x, y, n);
}
// 中文顯示：Q16 這種座標大家最熟悉
export const pointName = (i, n) => (i === PASS ? '停一手' : i === RESIGN ? '認輸' : toGtp(i, n));

// 星位
export function starPoints(n) {
  const e = n >= 13 ? 3 : 2, m = (n - 1) / 2, f = n - 1 - e;
  if (n < 9) return [];
  const pts = [[e, e], [f, e], [e, f], [f, f]];
  if (n % 2 === 1) pts.push([m, m]);
  if (n >= 15) pts.push([m, e], [m, f], [e, m], [f, m]);
  return pts.map(([x, y]) => idx(x, y, n));
}

// 讓子位置（固定讓子，依中國／日本慣例）
export function handicapPoints(n, k) {
  if (k < 2) return [];
  const e = n >= 13 ? 3 : 2, m = (n - 1) / 2, f = n - 1 - e;
  const P = (x, y) => idx(x, y, n);
  const corners = [P(f, e), P(e, f), P(f, f), P(e, e)]; // 右上、左下、右下、左上
  const sides = [P(e, m), P(f, m), P(m, e), P(m, f)];
  const center = P(m, m);
  const odd = n % 2 === 1;
  k = Math.min(k, odd ? 9 : 4);
  if (k <= 4) return corners.slice(0, k);
  if (k === 5) return [...corners, center];
  if (k === 6) return [...corners, sides[0], sides[1]];
  if (k === 7) return [...corners, sides[0], sides[1], center];
  if (k === 8) return [...corners, ...sides];
  return [...corners, ...sides, center];
}

// ---------------- 鄰點表與 Zobrist 雜湊 ----------------
const NB = new Map();
export function neighbors(n) {
  if (NB.has(n)) return NB.get(n);
  const list = [];
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = (i / n) | 0, a = [];
    if (x > 0) a.push(i - 1);
    if (x < n - 1) a.push(i + 1);
    if (y > 0) a.push(i - n);
    if (y < n - 1) a.push(i + n);
    list.push(a);
  }
  NB.set(n, list);
  return list;
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0); };
}
const ZOB = (() => {
  const r = mulberry32(20261030);
  const z = new Uint32Array(2 * 3 * 25 * 25);
  for (let i = 0; i < z.length; i++) z[i] = r();
  return z;
})();
const zk = (i, c) => (i * 3 + c) * 2;

// ---------------- 棋盤 ----------------
export class Board {
  constructor(n = 19, cells = null) {
    this.n = n;
    this.cells = cells ? Uint8Array.from(cells) : new Uint8Array(n * n);
    this.nb = neighbors(n);
    this.h1 = 0; this.h2 = 0;
    for (let i = 0; i < this.cells.length; i++) if (this.cells[i]) this._xor(i, this.cells[i]);
  }
  _xor(i, c) { const k = zk(i, c); this.h1 = (this.h1 ^ ZOB[k]) >>> 0; this.h2 = (this.h2 ^ ZOB[k + 1]) >>> 0; }
  get hash() { return this.h1.toString(36) + ':' + this.h2.toString(36); }
  clone() { const b = new Board(this.n); b.cells.set(this.cells); b.h1 = this.h1; b.h2 = this.h2; return b; }
  get(i) { return this.cells[i]; }
  set(i, c) { if (this.cells[i]) this._xor(i, this.cells[i]); this.cells[i] = c; if (c) this._xor(i, c); }

  // 一塊棋：{ stones, libs(Set) }
  group(i) {
    const c = this.cells[i];
    if (!c) return null;
    const stones = [i], libs = new Set(), seen = new Uint8Array(this.cells.length);
    seen[i] = 1;
    for (let k = 0; k < stones.length; k++) {
      for (const j of this.nb[stones[k]]) {
        const v = this.cells[j];
        if (v === EMPTY) libs.add(j);
        else if (v === c && !seen[j]) { seen[j] = 1; stones.push(j); }
      }
    }
    return { color: c, stones, libs };
  }
  libertyCount(i) { const g = this.group(i); return g ? g.libs.size : 0; }

  // 試下：回傳 { captured:[...], suicide } ；不檢查打劫（由 Game 檢查全局同形）
  place(i, c) {
    if (this.cells[i] !== EMPTY) return null;
    this.set(i, c);
    const opp = other(c), captured = [];
    for (const j of this.nb[i]) {
      if (this.cells[j] === opp) {
        const g = this.group(j);
        if (g.libs.size === 0) for (const s of g.stones) { if (this.cells[s]) { captured.push(s); this.set(s, EMPTY); } }
      }
    }
    const mine = this.group(i);
    if (mine.libs.size === 0) { // 自殺：還原
      for (const s of captured) this.set(s, opp);
      this.set(i, EMPTY);
      return { captured: [], suicide: true };
    }
    return { captured, suicide: false };
  }

  // 是否為某色的「真眼候選」（四周都是自己的子或邊）：AI 隨機下時避免填自己的眼
  isEyeish(i, c) {
    if (this.cells[i] !== EMPTY) return false;
    for (const j of this.nb[i]) if (this.cells[j] !== c) return false;
    return true;
  }

  stones(c) { let k = 0; for (const v of this.cells) if (v === c) k++; return k; }
}

// ---------------- 數子／數目 ----------------
// dead：死子集合（index）；回傳 { owner(Int8Array: 1 黑地/子、2 白地/子、0 公氣), black, white, ... }
export function scorePosition(board, { komi = 7.5, rules = 'chinese', dead = new Set(), captures = { 1: 0, 2: 0 }, neutral = null } = {}) {
  const n = board.n, N = n * n, nb = board.nb;
  const cells = Uint8Array.from(board.cells);
  const deadBy = { 1: 0, 2: 0 }; // 被提走的死子：依顏色
  for (const i of dead) if (cells[i]) { deadBy[cells[i]]++; cells[i] = EMPTY; }
  const owner = new Int8Array(N);
  const seen = new Uint8Array(N);
  let terrB = 0, terrW = 0, dame = 0;
  for (let i = 0; i < N; i++) {
    if (cells[i] !== EMPTY || seen[i]) continue;
    const region = [i]; seen[i] = 1;
    let touchB = false, touchW = false;
    for (let k = 0; k < region.length; k++) {
      for (const j of nb[region[k]]) {
        const v = cells[j];
        if (v === EMPTY) { if (!seen[j]) { seen[j] = 1; region.push(j); } }
        else if (v === BLACK) touchB = true; else touchW = true;
      }
    }
    const who = touchB && !touchW ? BLACK : touchW && !touchB ? WHITE : 0;
    for (const p of region) {
      // 雙活的眼或判斷不明的點（ownership 接近 0）不算地
      const o = neutral && neutral[p] ? 0 : who;
      owner[p] = o;
      if (o === BLACK) terrB++; else if (o === WHITE) terrW++; else dame++;
    }
  }
  let stonesB = 0, stonesW = 0;
  for (let i = 0; i < N; i++) { if (cells[i] === BLACK) { stonesB++; owner[i] = BLACK; } else if (cells[i] === WHITE) { stonesW++; owner[i] = WHITE; } }
  let black, white;
  if (rules === 'japanese') {
    // 數目法：地＋提子（含死子）
    black = terrB + (captures[BLACK] || 0) + deadBy[WHITE];
    white = terrW + (captures[WHITE] || 0) + deadBy[BLACK] + komi;
  } else {
    // 數子法：活子＋地
    black = stonesB + terrB;
    white = stonesW + terrW + komi;
  }
  const diff = black - white;
  return { owner, black, white, diff, winner: diff > 0 ? BLACK : diff < 0 ? WHITE : 0, terrB, terrW, stonesB, stonesW, dame, deadB: deadBy[BLACK], deadW: deadBy[WHITE], komi, rules };
}

// 依形勢（ownership：正值黑、負值白，-1～1）判斷死子
export function deadFromOwnership(board, own, th = 0.35) {
  const dead = new Set();
  if (!own) return dead;
  for (let i = 0; i < board.cells.length; i++) {
    const c = board.cells[i];
    if (c === BLACK && own[i] < -th) dead.add(i);
    else if (c === WHITE && own[i] > th) dead.add(i);
  }
  // 同一塊棋一起算：塊中過半判死就整塊死
  const done = new Set(), out = new Set();
  for (const i of dead) {
    if (done.has(i)) continue;
    const g = board.group(i);
    g.stones.forEach((s) => done.add(s));
    const k = g.stones.filter((s) => dead.has(s)).length;
    if (k * 2 >= g.stones.length) g.stones.forEach((s) => out.add(s));
  }
  return out;
}

export function resultText(r) {
  if (!r) return '';
  if (r.type === 'resign') return `${colorName(r.winner)}中盤勝（${colorName(other(r.winner))}認輸）`;
  if (r.type === 'timeout') return `${colorName(r.winner)}勝（${colorName(other(r.winner))}超時）`;
  if (r.type === 'void') return '無勝負（全局同形循環）';
  if (r.type === 'draw' || r.winner === 0) return '和棋';
  const m = Math.abs(r.diff);
  const unit = r.rules === 'japanese' ? '目' : '子';
  // 數子法：差距以「子」表示（半子＝0.5）
  return `${colorName(r.winner)}勝 ${fmtNum(m)} ${unit}`;
}
export const fmtNum = (x) => (Number.isInteger(x) ? String(x) : x.toFixed(1).replace(/\.0$/, ''));
export function sgfResult(r) {
  if (!r) return '';
  if (r.type === 'resign') return (r.winner === BLACK ? 'B' : 'W') + '+R';
  if (r.type === 'timeout') return (r.winner === BLACK ? 'B' : 'W') + '+T';
  if (r.type === 'void') return 'Void';
  if (r.winner === 0) return '0';
  return (r.winner === BLACK ? 'B' : 'W') + '+' + fmtNum(Math.abs(r.diff));
}

// ---------------- 對局 ----------------
export class Game {
  // opts: { size, komi, rules, handicap, setup: { black:[], white:[] }, first }
  constructor(opts = {}) {
    this.size = opts.size || 19;
    this.komi = opts.komi ?? 7.5;
    this.rules = opts.rules || 'chinese';
    this.handicap = opts.handicap || 0;
    this.board = new Board(this.size);
    this.setup = { black: [], white: [] };
    if (opts.setup) this.setup = { black: [...(opts.setup.black || [])], white: [...(opts.setup.white || [])] };
    else if (this.handicap >= 2) this.setup.black = handicapPoints(this.size, this.handicap);
    for (const i of this.setup.black) this.board.set(i, BLACK);
    for (const i of this.setup.white) this.board.set(i, WHITE);
    this.firstTurn = opts.first || (this.setup.black.length && !this.setup.white.length ? WHITE : BLACK);
    this.turn = this.firstTurn;
    this.moves = [];          // { c, i, cap:[...] }
    this.captures = { 1: 0, 2: 0 }; // 依提子方
    this.hist = [this.board.hash]; // 每手之後的局面雜湊（全局同形）
    this.passes = 0;
    this.result = null;
    this.snaps = [];
  }

  get n() { return this.size; }
  get ply() { return this.moves.length; }
  get lastMove() { return this.moves[this.moves.length - 1] || null; }

  // 是否合法：回傳 null 或錯誤原因
  whyIllegal(i, c = this.turn) {
    if (this.result) return '對局已經結束';
    if (i === PASS) return null;
    if (!(i >= 0 && i < this.size * this.size)) return '不在棋盤上';
    if (this.board.cells[i] !== EMPTY) return '這個交叉點已經有棋子了';
    const b = this.board.clone();
    const r = b.place(i, c);
    if (r.suicide) return '禁著點：下在這裡自己會沒有氣（不能自殺）';
    if (this.hist.includes(b.hash)) {
      return r.captured.length === 1 ? '打劫：剛被提的劫不能馬上提回，請先在別處下一手（找劫材）' : '全局同形再現：這手會讓棋盤回到以前出現過的樣子';
    }
    return null;
  }
  isLegal(i, c = this.turn) { return this.whyIllegal(i, c) === null; }

  legalMoves(c = this.turn) {
    const out = [];
    for (let i = 0; i < this.size * this.size; i++) if (this.board.cells[i] === EMPTY && this.isLegal(i, c)) out.push(i);
    return out;
  }

  // 下一手：回傳 { ok, captured, atari, ko, pass, why }
  play(i) {
    const why = this.whyIllegal(i);
    if (why) return { ok: false, why };
    const c = this.turn;
    this.snaps.push({ cells: Uint8Array.from(this.board.cells), captures: { ...this.captures }, passes: this.passes, h1: this.board.h1, h2: this.board.h2 });
    let captured = [];
    if (i === PASS) this.passes++;
    else {
      captured = this.board.place(i, c).captured;
      this.captures[c] += captured.length;
      this.passes = 0;
    }
    this.moves.push({ c, i, cap: captured });
    this.hist.push(this.board.hash);
    this.turn = other(c);
    // 叫吃：下完後對方有棋只剩一氣
    let atari = false, ko = false;
    if (i !== PASS) {
      for (const j of this.board.nb[i]) if (this.board.cells[j] === other(c) && this.board.libertyCount(j) === 1) { atari = true; break; }
      // 單提一子且自己這顆只剩一氣：形成劫
      if (captured.length === 1) { const g = this.board.group(i); ko = g.stones.length === 1 && g.libs.size === 1; }
    }
    return { ok: true, c, i, captured, atari, ko, pass: i === PASS, bothPassed: this.passes >= 2 };
  }

  undo() {
    if (!this.moves.length) return false;
    const s = this.snaps.pop();
    this.moves.pop();
    this.hist.pop();
    this.board.cells.set(s.cells);
    this.board.h1 = s.h1; this.board.h2 = s.h2;
    this.captures = s.captures;
    this.passes = s.passes;
    this.turn = other(this.turn);
    this.result = null;
    return true;
  }

  resign(color) { this.result = { type: 'resign', winner: other(color) }; }
  setScored(sc) { this.result = { type: 'score', winner: sc.winner, diff: sc.diff, rules: this.rules, black: sc.black, white: sc.white }; }

  score(dead, neutral) { return scorePosition(this.board, { komi: this.komi, rules: this.rules, dead, captures: this.captures, neutral }); }

  // KataGo 分析用：初始子與著手
  kataPayload() {
    const n = this.size;
    return {
      boardXSize: n, boardYSize: n, komi: this.komi,
      initialStones: [...this.setup.black.map((i) => ['B', toGtp(i, n)]), ...this.setup.white.map((i) => ['W', toGtp(i, n)])],
      initialPlayer: this.firstTurn === BLACK ? 'B' : 'W',
      moves: this.moves.map((m) => [m.c === BLACK ? 'B' : 'W', toGtp(m.i, n)]),
    };
  }

  // 從頭重播到第 ply 手
  static replay(rec, ply = Infinity) {
    const g = new Game({ size: rec.size, komi: rec.komi, rules: rec.rules, handicap: rec.handicap, setup: rec.setup, first: rec.first });
    const mv = rec.moves || [];
    for (let k = 0; k < mv.length && k < ply; k++) {
      const m = mv[k];
      const i = typeof m === 'number' ? m : m.i;
      if (typeof m === 'object' && m.c && m.c !== g.turn) { g.turn = m.c; } // 棋譜裡連下（如 SGF 置子）時順從記錄
      const r = g.play(i);
      if (!r.ok) break;
    }
    if (ply >= mv.length && rec.result) g.result = rec.result;
    return g;
  }

  toRecord(meta = {}) {
    return {
      v: 1,
      size: this.size, komi: this.komi, rules: this.rules, handicap: this.handicap,
      setup: this.setup, first: this.firstTurn,
      moves: this.moves.map((m) => ({ c: m.c, i: m.i })),
      result: this.result,
      date: new Date().toISOString(),
      ...meta,
    };
  }
}

// ---------------- SGF ----------------
const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/]/g, '\\]');
export function recordToSgf(rec) {
  const n = rec.size;
  const p = ['FF[4]', 'GM[1]', 'CA[UTF-8]', 'AP[小柯機器人圍棋競賽]', `SZ[${n}]`, `KM[${rec.komi}]`, `RU[${rec.rules === 'japanese' ? 'Japanese' : 'Chinese'}]`];
  if (rec.handicap) p.push(`HA[${rec.handicap}]`);
  if (rec.black) p.push(`PB[${esc(rec.black)}]`);
  if (rec.white) p.push(`PW[${esc(rec.white)}]`);
  if (rec.date) p.push(`DT[${String(rec.date).slice(0, 10)}]`);
  if (rec.result) p.push(`RE[${sgfResult(rec.result)}]`);
  if (rec.event) p.push(`EV[${esc(rec.event)}]`);
  const setup = rec.setup || { black: [], white: [] };
  if (setup.black.length) p.push('AB' + setup.black.map((i) => `[${toSgf(i, n)}]`).join(''));
  if (setup.white.length) p.push('AW' + setup.white.map((i) => `[${toSgf(i, n)}]`).join(''));
  if (rec.first === WHITE && !setup.black.length) p.push('PL[W]');
  const body = (rec.moves || []).map((m) => `;${m.c === BLACK ? 'B' : 'W'}[${toSgf(m.i, n)}]`).join('');
  return `(;${p.join('')}${body})\n`;
}

// 解析 SGF（可含多局）；只取主分支。回傳 record 陣列
export function parseSgf(text) {
  const out = [];
  const s = String(text);
  let pos = 0;
  const games = [];
  // 切出每一局的最外層括號
  while (pos < s.length) {
    const start = s.indexOf('(', pos);
    if (start < 0) break;
    let depth = 0, i = start, inVal = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inVal) { if (ch === '\\') i++; else if (ch === ']') inVal = false; continue; }
      if (ch === '[') inVal = true;
      else if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
    }
    games.push(s.slice(start, i + 1));
    pos = i + 1;
  }
  for (const gtext of games) {
    try { const r = parseOne(gtext); if (r) out.push(r); } catch { /* 跳過壞掉的一局 */ }
  }
  return out;
}

function parseOne(t) {
  // 只走主線：遇到變化分支「(」時進入第一個分支，之後的兄弟分支跳過
  const nodes = [];
  let i = 0, depth = 0, skipDepth = -1, cur = null;
  const n = t.length;
  const done = []; // done[d]：同一層已經走過一個分支（之後的兄弟分支都是變化圖）
  while (i < n) {
    const ch = t[i];
    if (ch === '(') {
      depth++;
      if (skipDepth < 0 && done[depth]) skipDepth = depth;
      if (skipDepth < 0) done[depth + 1] = false;
      i++; continue;
    }
    if (ch === ')') {
      if (skipDepth === depth) skipDepth = -1;
      else if (skipDepth < 0) done[depth] = true;
      depth--; i++; continue;
    }
    if (ch === ';') { if (skipDepth < 0) { cur = {}; nodes.push(cur); } i++; continue; }
    if (/[A-Za-z]/.test(ch)) {
      let id = '';
      while (i < n && /[A-Za-z]/.test(t[i])) { if (/[A-Z]/.test(t[i])) id += t[i]; i++; }
      const vals = [];
      while (true) {
        while (i < n && /\s/.test(t[i])) i++;
        if (t[i] !== '[') break;
        i++;
        let v = '';
        while (i < n && t[i] !== ']') { if (t[i] === '\\') { i++; if (t[i] === '\n' || t[i] === '\r') { i++; continue; } } v += t[i]; i++; }
        i++;
        vals.push(v);
      }
      if (skipDepth < 0 && cur) (cur[id] ||= []).push(...vals);
      continue;
    }
    i++;
  }
  if (!nodes.length) return null;
  const root = nodes[0];
  const size = parseInt((root.SZ || ['19'])[0], 10) || 19;
  if (size < 2 || size > 25) return null;
  const rec = {
    v: 1, size, komi: parseFloat((root.KM || ['7.5'])[0]) || 0,
    rules: /japan|korea/i.test((root.RU || [''])[0]) ? 'japanese' : 'chinese',
    handicap: parseInt((root.HA || ['0'])[0], 10) || 0,
    setup: { black: [], white: [] }, moves: [], first: BLACK,
    black: (root.PB || [''])[0].slice(0, 40), white: (root.PW || [''])[0].slice(0, 40),
    date: (root.DT || [''])[0], event: (root.EV || root.GN || [''])[0].slice(0, 60),
    sgfResult: (root.RE || [''])[0],
  };
  const expand = (v) => {
    // 支援壓縮座標 aa:cc
    if (v.includes(':')) {
      const [a, b] = v.split(':');
      const x0 = a.charCodeAt(0) - 97, y0 = a.charCodeAt(1) - 97, x1 = b.charCodeAt(0) - 97, y1 = b.charCodeAt(1) - 97;
      const r = [];
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) r.push(idx(x, y, size));
      return r;
    }
    const p = fromSgf(v, size);
    return p == null || p === PASS ? [] : [p];
  };
  for (const v of root.AB || []) rec.setup.black.push(...expand(v));
  for (const v of root.AW || []) rec.setup.white.push(...expand(v));
  if (root.PL) rec.first = /w/i.test(root.PL[0]) ? WHITE : BLACK;
  else if (rec.setup.black.length && !rec.setup.white.length) rec.first = WHITE;
  for (const nd of nodes) {
    for (const k of ['B', 'W']) {
      if (!nd[k]) continue;
      const p = fromSgf(nd[k][0], size);
      if (p == null) continue;
      rec.moves.push({ c: k === 'B' ? BLACK : WHITE, i: p });
    }
  }
  if (rec.moves.length) rec.first = rec.moves[0].c;
  rec.result = parseSgfResult(rec.sgfResult);
  return rec;
}

export function parseSgfResult(re) {
  re = String(re || '').trim();
  const m = /^([BW])\+(.*)$/i.exec(re);
  if (m) {
    const winner = /b/i.test(m[1]) ? BLACK : WHITE;
    const rest = m[2];
    if (/^r/i.test(rest)) return { type: 'resign', winner };
    if (/^t/i.test(rest)) return { type: 'timeout', winner };
    const d = parseFloat(rest);
    return { type: 'score', winner, diff: winner === BLACK ? (d || 0) : -(d || 0), rules: 'chinese' };
  }
  if (/^(0|draw|jigo)/i.test(re)) return { type: 'draw', winner: 0, diff: 0 };
  if (/^void/i.test(re)) return { type: 'void', winner: 0 };
  return null;
}

// ---------------- 對稱（棋譜學習：同一個定式的八種方向視為相同） ----------------
export function symPoint(i, n, s) {
  if (i < 0) return i;
  let x = i % n, y = (i / n) | 0;
  if (s & 1) x = n - 1 - x;
  if (s & 2) y = n - 1 - y;
  if (s & 4) [x, y] = [y, x];
  return y * n + x;
}
// 反向對稱
export function symInverse(s) { return s & 4 ? ((s & 1) << 1) | ((s & 2) >> 1) | 4 : s; }

// 局面的對稱正規化雜湊：回傳 { key, sym }（sym 是把實際局面轉成正規形的變換）
export function canonicalKey(board, toMove) {
  const n = board.n;
  let best = null, bestSym = 0;
  for (let s = 0; s < 8; s++) {
    let h1 = 0, h2 = 0;
    for (let i = 0; i < board.cells.length; i++) {
      const c = board.cells[i];
      if (!c) continue;
      const k = zk(symPoint(i, n, s), c);
      h1 = (h1 ^ ZOB[k]) >>> 0; h2 = (h2 ^ ZOB[k + 1]) >>> 0;
    }
    const key = `${n}${toMove === BLACK ? 'b' : 'w'}${h1.toString(36)}${h2.toString(36)}`;
    if (best === null || key < best) { best = key; bestSym = s; }
  }
  return { key: best, sym: bestSym };
}

// 文字棋盤（給 AI 軍師看）
export function boardText(board, last = -1) {
  const n = board.n;
  const cols = GTP_COLS.slice(0, n).split('');
  const lines = ['   ' + cols.join(' ')];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const i = idx(x, y, n), c = board.cells[i];
      row.push(c === BLACK ? (i === last ? 'X' : 'x') : c === WHITE ? (i === last ? 'O' : 'o') : '.');
    }
    lines.push(String(n - y).padStart(2, ' ') + ' ' + row.join(' '));
  }
  return lines.join('\n');
}
