// AI 介面：優先使用 KataGo（勝率、目差、形勢），不能用時改用小柯 JS 引擎
import { BLACK, WHITE, PASS, fromGtp, toGtp } from './go.js';

// 難度：sample＝依直覺（策略網路）抽樣，越低越隨性；visits＝搜尋次數
export const LEVELS = [
  { name: '入門', desc: '約 20 級．適合剛學會規則', sample: { temp: 1.5, rand: 0.3, top: 30 }, visits: 1, js: { playouts: 300, timeMs: 400 } },
  { name: '初級', desc: '約 12 級．會吃子、做眼', sample: { temp: 1.0, rand: 0.12, top: 15 }, visits: 1, js: { playouts: 1200, timeMs: 800 } },
  { name: '中級', desc: '約 5 級．懂布局與死活', sample: { temp: 0.5, rand: 0.03, top: 8 }, visits: 1, js: { playouts: 3000, timeMs: 1500 } },
  { name: '高級', desc: '業餘初段', visits: 24, js: { playouts: 7000, timeMs: 2500 } },
  { name: '專家', desc: '業餘 5 段', visits: 200, js: { playouts: 14000, timeMs: 3500 } },
  { name: '大師', desc: '職業級（深度網路，每手約 5 秒）', visits: 60, strong: true, maxTime: 6, js: { playouts: 30000, timeMs: 6000 } },
];

let seq = 0;
const nextId = (p) => `${p}-${Date.now().toString(36)}-${++seq}`;

export class AIEngine {
  constructor() {
    this.kata = (window.xk && window.xk.kata) || null;
    this.status = { available: false };
    this.useKata = false;
    this.worker = null;
    this.wseq = 0;
    this.wpending = new Map();
    this.updates = new Map();
    if (this.kata && this.kata.onUpdate) this.kata.onUpdate((u) => { const f = this.updates.get(u.id); if (f) f(u); });
  }

  async init() {
    if (this.kata) {
      try { this.status = await this.kata.status(); } catch { this.status = { available: false }; }
      this.useKata = !!this.status.available;
      if (this.useKata) this.kata.warmup().then((ok) => { if (!ok) { this.useKata = false; this.status.error = '引擎啟動失敗'; } });
    }
    return this.useKata;
  }

  get name() { return this.useKata ? 'KataGo' : '小柯 JS 引擎'; }
  get strongAvailable() { return this.useKata && !!this.status.strong; }

  jsWorker() {
    if (!this.worker) {
      this.worker = new Worker(new URL('./engine-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => { const p = this.wpending.get(e.data.id); if (!p) return; this.wpending.delete(e.data.id); e.data.ok ? p.resolve(e.data.r) : p.reject(new Error(e.data.e)); };
    }
    return this.worker;
  }
  jsSearch(opts) {
    const id = ++this.wseq;
    return new Promise((resolve, reject) => { this.wpending.set(id, { resolve, reject }); this.jsWorker().postMessage({ id, opts }); });
  }

  rulesOf(game) {
    return game.rules === 'japanese'
      ? { ko: 'POSITIONAL', scoring: 'TERRITORY', tax: 'SEKI', suicide: false, hasButton: false, whiteHandicapBonus: '0' }
      : { ko: 'POSITIONAL', scoring: 'AREA', tax: 'NONE', suicide: false, hasButton: false, whiteHandicapBonus: '0' };
  }

  // KataGo 回應 → 統一格式（勝率、目差一律以黑方為準）
  normKata(r, n, toMove) {
    if (!r) return null;
    const moves = (r.moveInfos || []).map((m) => ({
      i: fromGtp(m.move, n), winrate: m.winrate, scoreLead: m.scoreLead, visits: m.visits, prior: m.prior, order: m.order,
      pv: (m.pv || []).map((p) => fromGtp(p, n)).filter((x) => x != null),
    })).filter((m) => m.i != null).sort((a, b) => a.order - b.order);
    return {
      engine: 'KataGo', toMove,
      winrate: r.rootInfo ? r.rootInfo.winrate : 0.5,
      scoreLead: r.rootInfo ? r.rootInfo.scoreLead : 0,
      visits: r.rootInfo ? r.rootInfo.visits : 0,
      moves, ownership: r.ownership || null, policy: r.policy || null,
    };
  }

  // 分析局面：opts { visits, strong, ownership, policy, id, onUpdate, timeMs, maxTime }
  async analyze(game, opts = {}) {
    const n = game.size, toMove = game.turn;
    if (this.useKata) {
      const id = opts.id || nextId('a');
      const req = { id, ...game.kataPayload(), rules: this.rulesOf(game), maxVisits: opts.visits || 100, includeOwnership: !!opts.ownership, includePolicy: !!opts.policy };
      if (opts.maxTime) req.overrideSettings = { maxTime: opts.maxTime };
      if (opts.onUpdate) { req.reportDuringSearchEvery = 0.4; this.updates.set(id, (u) => opts.onUpdate(this.normKata(u, n, toMove))); }
      try {
        const r = await this.kata.analyze(opts.strong ? 'strong' : 'fast', req);
        return this.normKata(r, n, toMove);
      } catch (e) {
        if (/已結束|找不到|spawn|ENOENT/.test(String(e.message))) { this.useKata = false; this.status.error = e.message; return this.analyze(game, opts); }
        throw e;
      } finally { this.updates.delete(id); }
    }
    const r = await this.jsSearch({
      n, cells: game.board.cells, toMove, komi: game.komi, legal: game.legalMoves(),
      playouts: opts.playouts || Math.max(800, (opts.visits || 100) * 25), timeMs: opts.timeMs || 1500,
      allowPass: game.ply > n * n * 0.4 || !!game.passes,
    });
    return { engine: '小柯 JS 引擎', toMove, winrate: r.winrate, scoreLead: r.scoreLead, visits: r.visits, moves: r.moves, ownership: r.ownership, policy: null };
  }

  cancel(id) { if (this.useKata && id) this.kata.terminate(id).catch(() => {}); }

  // 依難度選一手：回傳 { move, a(分析), source }
  async genMove(game, levelIdx) {
    const lv = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, levelIdx))];
    const n = game.size, me = game.turn;
    if (!this.useKata) {
      const a = await this.analyze(game, { playouts: lv.js.playouts, timeMs: lv.js.timeMs });
      const best = a.moves[0];
      return { move: best ? best.i : PASS, a, source: `模擬 ${a.visits} 局` };
    }
    if (lv.sample) {
      const a = await this.analyze(game, { visits: 1, policy: true });
      const move = this.samplePolicy(game, a, lv.sample);
      return { move, a, source: '直覺下法' };
    }
    const a = await this.analyze(game, { visits: lv.visits, strong: !!lv.strong && this.strongAvailable, maxTime: lv.maxTime, ownership: false });
    const best = a.moves.find((m) => m.i === PASS || game.isLegal(m.i));
    return { move: best ? best.i : PASS, a, source: `搜尋 ${a.visits} 次` };
  }

  // 依策略網路抽樣（低難度）
  samplePolicy(game, a, { temp, rand, top }) {
    const n = game.size, N = n * n;
    const pol = a.policy;
    if (!pol) return a.moves[0] ? a.moves[0].i : PASS;
    // 策略網路認為停一手最好（終局）就停
    let bestI = -1, bestP = -1;
    for (let i = 0; i <= N; i++) if (pol[i] > bestP) { bestP = pol[i]; bestI = i; }
    if (bestI === N) return PASS;
    const cand = [];
    for (let i = 0; i < N; i++) if (pol[i] > 0 && game.board.cells[i] === 0) cand.push([i, pol[i]]);
    cand.sort((x, y) => y[1] - x[1]);
    const pool = cand.slice(0, top).filter(([i]) => !this.fillsOwnEye(game, i) && game.isLegal(i));
    if (!pool.length) return a.moves[0] ? a.moves[0].i : PASS;
    if (Math.random() < rand) return pool[Math.floor(Math.random() * pool.length)][0];
    const w = pool.map(([, p]) => Math.pow(p, 1 / temp));
    let s = w.reduce((x, y) => x + y, 0) * Math.random();
    for (let k = 0; k < pool.length; k++) { s -= w[k]; if (s <= 0) return pool[k][0]; }
    return pool[0][0];
  }

  fillsOwnEye(game, i) {
    const c = game.turn;
    return game.board.nb[i].every((j) => game.board.cells[j] === c);
  }

  // 整局速算：每一手的勝率與目差（覆盤）；onProgress(done, total)
  async analyzeGame(game, { visits = 24, onProgress } = {}) {
    const total = game.ply + 1;
    const out = new Array(total).fill(null);
    if (this.useKata) {
      const id = nextId('g');
      const turns = Array.from({ length: total }, (_, k) => k);
      let done = 0;
      this.updates.set(id, (u) => {
        if (u && typeof u.turnNumber === 'number' && !u.isDuringSearch) {
          out[u.turnNumber] = { winrate: u.rootInfo.winrate, scoreLead: u.rootInfo.scoreLead, best: (u.moveInfos || [])[0] ? fromGtp(u.moveInfos[0].move, game.size) : null };
          done++; onProgress && onProgress(done, total);
        }
      });
      try {
        const res = await this.kata.analyze('fast', { id, ...game.kataPayload(), rules: this.rulesOf(game), maxVisits: visits, analyzeTurns: turns });
        for (const u of res || []) if (u && typeof u.turnNumber === 'number' && !out[u.turnNumber]) out[u.turnNumber] = { winrate: u.rootInfo.winrate, scoreLead: u.rootInfo.scoreLead, best: (u.moveInfos || [])[0] ? fromGtp(u.moveInfos[0].move, game.size) : null };
      } finally { this.updates.delete(id); }
      return out;
    }
    const { Game } = await import('./go.js');
    const rec = game.toRecord();
    for (let k = 0; k < total; k++) {
      const g = Game.replay(rec, k);
      const r = await this.analyze(g, { playouts: 1500, timeMs: 350 });
      out[k] = { winrate: r.winrate, scoreLead: r.scoreLead, best: r.moves[0] ? r.moves[0].i : null };
      onProgress && onProgress(k + 1, total);
    }
    return out;
  }
}

// 勝率（以某方為準）
export const wrFor = (wrBlack, color) => (color === BLACK ? wrBlack : 1 - wrBlack);
export const leadFor = (leadBlack, color) => (color === BLACK ? leadBlack : -leadBlack);
export { toGtp, WHITE };
