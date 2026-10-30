// 棋譜學習：把棋譜庫裡每一局的布局（前段著手）整理成「局面 → 下一手」統計
// 同一個局面的八種旋轉／鏡像視為相同，所以角上定式在哪個角都查得到
import { Game, BLACK, WHITE, PASS, canonicalKey, symPoint, symInverse } from './go.js';

const DEPTH = { 9: 24, 13: 36, 19: 50 }; // 每局收錄前幾手

export class Book {
  constructor() { this.map = new Map(); this.games = 0; this.positions = 0; this.ids = new Set(); }

  addRecord(rec) {
    if (!rec || !Array.isArray(rec.moves) || !rec.moves.length) return;
    if (rec.id && this.ids.has(rec.id)) return;
    if (rec.id) this.ids.add(rec.id);
    const n = rec.size;
    const depth = DEPTH[n] || 30;
    const winner = rec.result && rec.result.winner;
    let g;
    try { g = new Game({ size: n, komi: rec.komi, rules: rec.rules, handicap: rec.handicap, setup: rec.setup, first: rec.first }); } catch { return; }
    let added = false;
    for (let k = 0; k < rec.moves.length && k < depth; k++) {
      const m = rec.moves[k];
      if (m.c !== g.turn) g.turn = m.c;
      if (m.i !== PASS) {
        const { key, sym } = canonicalKey(g.board, g.turn);
        const cm = symPoint(m.i, n, sym);
        let e = this.map.get(key);
        if (!e) { e = new Map(); this.map.set(key, e); this.positions++; }
        const s = e.get(cm) || { n: 0, w: 0, l: 0 };
        s.n++;
        if (winner === g.turn) s.w++; else if (winner === 3 - g.turn) s.l++;
        e.set(cm, s);
        added = true;
      }
      if (!g.play(m.i).ok) break;
    }
    if (added) this.games++;
  }

  // 目前局面在棋譜庫中的下一手（已轉回實際座標），依出現次數排序
  lookup(game) {
    if (!this.map.size) return [];
    const { key, sym } = canonicalKey(game.board, game.turn);
    const e = this.map.get(key);
    if (!e) return [];
    const inv = symInverse(sym);
    const out = [];
    const seen = new Set();
    for (const [cm, s] of e) {
      const i = symPoint(cm, game.size, inv);
      if (seen.has(i) || !game.isLegal(i)) continue;
      seen.add(i);
      out.push({ i, ...s, rate: s.w + s.l ? s.w / (s.w + s.l) : null });
    }
    return out.sort((a, b) => b.n - a.n);
  }
}

export function buildBook(records) {
  const b = new Book();
  for (const r of records) b.addRecord(r);
  return b;
}

export { BLACK, WHITE };
