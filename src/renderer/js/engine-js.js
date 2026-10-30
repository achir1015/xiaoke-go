// 小柯 JS 圍棋引擎（備援用）：蒙地卡羅樹搜尋（UCT＋RAVE）＋輕量模擬
// KataGo 無法執行時（或網頁／手機版）使用；也能估計形勢（每點歸屬）與目差
const EMPTY = 0, BLACK = 1, WHITE = 2;
const PASS = -1;

class FastBoard {
  constructor(n) {
    this.n = n;
    const N = n * n;
    this.N = N;
    this.color = new Uint8Array(N);
    this.head = new Int32Array(N);
    this.next = new Int32Array(N);
    this.plib = new Int32Array(N);  // 偽氣（依棋串的頭）
    this.size = new Int32Array(N);
    this.nb = []; this.nbc = new Uint8Array(N);
    this.nbf = new Int32Array(N * 4);
    this.diag = [];
    for (let i = 0; i < N; i++) {
      const x = i % n, y = (i / n) | 0, a = [], d = [];
      if (x > 0) a.push(i - 1);
      if (x < n - 1) a.push(i + 1);
      if (y > 0) a.push(i - n);
      if (y < n - 1) a.push(i + n);
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < n && yy < n) d.push(yy * n + xx); }
      this.nb.push(a); this.diag.push(d);
      this.nbc[i] = a.length;
      for (let k = 0; k < a.length; k++) this.nbf[i * 4 + k] = a[k];
    }
    this.empties = new Int32Array(N); this.epos = new Int32Array(N); this.ecount = 0;
    this.ko = -1;
    this.mark = new Int32Array(N); this.stamp = 1;
    this.libTmp = new Int32Array(8);
    this.reset();
  }

  reset() {
    this.color.fill(0);
    this.ecount = 0;
    for (let i = 0; i < this.N; i++) { this.empties[this.ecount] = i; this.epos[i] = this.ecount++; }
    this.ko = -1;
  }

  copyFrom(b) {
    this.color.set(b.color); this.head.set(b.head); this.next.set(b.next); this.plib.set(b.plib); this.size.set(b.size);
    this.empties.set(b.empties); this.epos.set(b.epos); this.ecount = b.ecount; this.ko = b.ko;
  }

  _removeEmpty(i) { const p = this.epos[i], last = this.empties[--this.ecount]; this.empties[p] = last; this.epos[last] = p; }
  _addEmpty(i) { this.empties[this.ecount] = i; this.epos[i] = this.ecount++; }

  // 棋串的實際氣（最多收集 max 個）
  libs(h, max, out) {
    const st = ++this.stamp; let k = 0, s = h;
    do {
      const base = s * 4, c = this.nbc[s];
      for (let q = 0; q < c; q++) {
        const j = this.nbf[base + q];
        if (this.color[j] === EMPTY && this.mark[j] !== st) { this.mark[j] = st; out[k++] = j; if (k >= max) return k; }
      }
      s = this.next[s];
    } while (s !== h);
    return k;
  }

  isLegal(i, c) {
    if (this.color[i] !== EMPTY || i === this.ko) return false;
    const base = i * 4, cnt = this.nbc[i], opp = 3 - c;
    for (let q = 0; q < cnt; q++) {
      const j = this.nbf[base + q], v = this.color[j];
      if (v === EMPTY) return true;
      const k = this.libs(this.head[j], 2, this.libTmp);
      if (v === c && (k > 1 || this.libTmp[0] !== i)) return true;
      if (v === opp && k === 1) return true;
    }
    return false;
  }

  // 自己的眼（四周都是自己，且斜角不被對方佔太多）
  isEye(i, c) {
    const base = i * 4, cnt = this.nbc[i];
    for (let q = 0; q < cnt; q++) if (this.color[this.nbf[base + q]] !== c) return false;
    let bad = 0; const d = this.diag[i];
    for (const j of d) if (this.color[j] === 3 - c) bad++;
    return d.length < 4 ? bad === 0 : bad < 2;
  }

  play(i, c) {
    if (i === PASS) { this.ko = -1; return 0; }
    const opp = 3 - c;
    this.color[i] = c; this.head[i] = i; this.next[i] = i; this.size[i] = 1;
    this._removeEmpty(i);
    let pl = 0;
    const base = i * 4, cnt = this.nbc[i];
    for (let q = 0; q < cnt; q++) {
      const j = this.nbf[base + q];
      if (this.color[j] === EMPTY) pl++;
      else this.plib[this.head[j]]--;
    }
    this.plib[i] = pl;
    // 與同色相連
    for (let q = 0; q < cnt; q++) {
      const j = this.nbf[base + q];
      if (this.color[j] === c && this.head[j] !== this.head[i]) this._merge(this.head[i], this.head[j]);
    }
    // 提子
    let captured = 0, capPt = -1;
    for (let q = 0; q < cnt; q++) {
      const j = this.nbf[base + q];
      if (this.color[j] === opp && this.plib[this.head[j]] === 0) { const k = this.size[this.head[j]]; if (k === 1) capPt = j; captured += k; this._remove(this.head[j]); }
    }
    this.ko = -1;
    const h = this.head[i];
    if (captured === 1 && this.size[h] === 1 && this.plib[h] === 1) this.ko = capPt;
    return captured;
  }

  _merge(a, b) {
    if (this.size[a] < this.size[b]) { const t = a; a = b; b = t; }
    let s = b;
    do { this.head[s] = a; s = this.next[s]; } while (s !== b);
    const na = this.next[a]; this.next[a] = this.next[b]; this.next[b] = na;
    this.size[a] += this.size[b];
    this.plib[a] += this.plib[b];
  }

  _remove(h) {
    const stones = [];
    let s = h;
    do { stones.push(s); s = this.next[s]; } while (s !== h);
    for (const st of stones) { this.color[st] = EMPTY; this._addEmpty(st); }
    for (const st of stones) {
      const base = st * 4, cnt = this.nbc[st];
      for (let q = 0; q < cnt; q++) { const j = this.nbf[base + q]; if (this.color[j] !== EMPTY) this.plib[this.head[j]]++; }
    }
  }

  // 區域計分（活子＋只被一方圍住的空點）
  areaScore(komi, own) {
    let b = 0, w = 0;
    for (let i = 0; i < this.N; i++) {
      let v = this.color[i];
      if (v === EMPTY) {
        let nbB = false, nbW = false; const base = i * 4, cnt = this.nbc[i];
        for (let q = 0; q < cnt; q++) { const x = this.color[this.nbf[base + q]]; if (x === BLACK) nbB = true; else if (x === WHITE) nbW = true; }
        v = nbB && !nbW ? BLACK : nbW && !nbB ? WHITE : 0;
      }
      if (v === BLACK) { b++; if (own) own[i] += 1; } else if (v === WHITE) { w++; if (own) own[i] -= 1; }
    }
    return b - w - komi;
  }
}

// ---------------- 模擬 ----------------
function playout(b, toMove, rng, maxMoves, amaf) {
  let c = toMove, passes = 0, moves = 0, last = -1;
  const tmp = new Int32Array(4);
  while (passes < 2 && moves < maxMoves) {
    let mv = PASS;
    // 1) 吃掉或救出最後一手旁邊只剩一氣的棋
    if (last >= 0) {
      const nbs = b.nb[last];
      for (let q = 0; q < nbs.length && mv === PASS; q++) {
        const j = nbs[q];
        if (b.color[j] === EMPTY) continue;
        const k = b.libs(b.head[j], 2, tmp);
        if (k === 1 && b.isLegal(tmp[0], c) && rng() < 0.9) {
          if (b.color[j] !== c) mv = tmp[0];
          else { // 長出去後至少有兩氣才逃
            const save = tmp[0];
            let empt = 0; for (const t of b.nb[save]) if (b.color[t] === EMPTY) empt++;
            if (empt >= 2) mv = save;
          }
        }
      }
    }
    // 2) 隨機（不填自己的眼）
    if (mv === PASS) {
      let cnt = b.ecount;
      while (cnt > 0) {
        const r = (rng() * cnt) | 0;
        const i = b.empties[r];
        if (!b.isEye(i, c) && b.isLegal(i, c)) { mv = i; break; }
        // 換到尾端，不再抽到
        cnt--;
        const t = b.empties[cnt]; b.empties[cnt] = i; b.empties[r] = t; b.epos[t] = r; b.epos[i] = cnt;
      }
    }
    if (mv === PASS) passes++;
    else { passes = 0; b.play(mv, c); if (amaf && amaf[mv] === 0) amaf[mv] = c; }
    last = mv;
    c = 3 - c;
    moves++;
  }
}

// ---------------- 搜尋樹 ----------------
class Node {
  constructor(move, color, parent) {
    this.move = move; this.color = color; this.parent = parent; // color：下這手的一方
    this.children = null;
    this.n = 0; this.w = 0;     // 從「下這手的一方」角度
    this.rn = 0; this.rw = 0;   // RAVE
  }
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 開局偏好：三、四線與角
function prior(n, i, stones) {
  if (i === PASS) return 0;
  const x = i % n, y = (i / n) | 0;
  const d = Math.min(x, y, n - 1 - x, n - 1 - y);
  if (stones < n) return d === 2 || d === 3 ? 0.6 : d <= 1 ? 0.2 : 0.45;
  return d === 0 ? 0.35 : 0.5;
}

// opts: { n, cells, toMove, komi, legal:[...], playouts, timeMs, seed, lastMove, allowPass }
export function search(opts) {
  const { n, toMove } = opts;
  const komi = opts.komi ?? 7.5;
  const rng = mulberry(opts.seed || ((Math.random() * 1e9) | 0));
  const root = new FastBoard(n);
  for (let i = 0; i < n * n; i++) if (opts.cells[i]) root.play(i, opts.cells[i]);
  root.ko = -1;
  const legal = (opts.legal || []).filter((i) => i >= 0 && !root.isEye(i, toMove));
  const stones = n * n - root.ecount;
  const work = new FastBoard(n);
  const own = new Float32Array(n * n);
  const maxMoves = n * n * 3;
  const amaf = new Uint8Array(n * n);
  const rootNode = new Node(PASS, 3 - toMove, null);
  const expand = (node, board, c) => {
    const list = node === rootNode ? legal : [];
    if (node !== rootNode) for (let k = 0; k < board.ecount; k++) { const i = board.empties[k]; if (!board.isEye(i, c) && board.isLegal(i, c)) list.push(i); }
    node.children = list.map((m) => { const ch = new Node(m, c, node); const p = prior(n, m, stones); ch.n = 2; ch.w = 2 * p; return ch; });
    if (!node.children.length || (node === rootNode && opts.allowPass)) node.children.push(Object.assign(new Node(PASS, c, node), { n: 2, w: node.children.length ? 0.4 : 1 }));
  };
  expand(rootNode, root, toMove);
  const deadline = performance.now() + (opts.timeMs || 1000);
  const maxPlayouts = opts.playouts || 5000;
  let sims = 0, scoreSum = 0;
  const RAVE_K = 600;
  while (sims < maxPlayouts && (sims % 64 || performance.now() < deadline)) {
    work.copyFrom(root);
    let node = rootNode, c = toMove;
    amaf.fill(0);
    // 選擇
    while (node.children && node.children.length) {
      let best = null, bv = -1;
      const lnN = Math.log(node.n + 1);
      for (const ch of node.children) {
        const q = ch.w / ch.n;
        const beta = ch.rn / (ch.rn + ch.n + ch.rn * ch.n / RAVE_K + 1e-9);
        const r = ch.rn ? ch.rw / ch.rn : q;
        const v = (1 - beta) * q + beta * r + 0.35 * Math.sqrt(lnN / ch.n);
        if (v > bv) { bv = v; best = ch; }
      }
      node = best;
      if (node.move !== PASS) { if (!work.isLegal(node.move, c)) { node.n += 1; break; } work.play(node.move, c); if (!amaf[node.move]) amaf[node.move] = c; }
      else work.play(PASS, c);
      c = 3 - c;
      if (node.n >= 8 && !node.children) expand(node, work, c);
    }
    playout(work, c, rng, maxMoves, amaf);
    const sc = work.areaScore(komi, own);
    scoreSum += sc;
    const winner = sc > 0 ? BLACK : WHITE;
    // 回傳
    for (let x = node; x; x = x.parent) {
      x.n++; if (x.color === winner) x.w++;
      if (x.children) for (const ch of x.children) {
        if (ch.move >= 0 && amaf[ch.move] === ch.color) { ch.rn++; if (ch.color === winner) ch.rw++; }
      }
    }
    sims++;
  }
  const kids = (rootNode.children || []).slice().sort((a, b) => b.n - a.n);
  const wrBlack = (ch) => (ch.color === BLACK ? ch.w / ch.n : 1 - ch.w / ch.n);
  const ownership = Array.from(own, (v) => v / Math.max(1, sims));
  const lead = scoreSum / Math.max(1, sims);
  const moves = kids.slice(0, 12).map((ch, k) => ({ i: ch.move, visits: ch.n - 2, winrate: wrBlack(ch), scoreLead: lead, order: k, prior: 0, pv: [ch.move] }));
  const rootWr = moves.length ? moves[0].winrate : 0.5;
  return { sims, moves, winrate: rootWr, scoreLead: lead, ownership, visits: sims };
}
