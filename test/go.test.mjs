import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, Board, BLACK, WHITE, PASS, EMPTY, idx, toGtp, fromGtp, toSgf, fromSgf, recordToSgf, parseSgf, handicapPoints, starPoints, scorePosition, deadFromOwnership, canonicalKey, symPoint, resultText } from '../src/renderer/js/go.js';

const P = (s, n = 9) => fromGtp(s, n);
const play = (g, list) => { for (const s of list) { const r = g.play(s === 'pass' ? PASS : P(s, g.size)); assert.ok(r.ok, `${s}: ${r.why}`); } };

test('座標轉換', () => {
  assert.equal(toGtp(idx(0, 0, 19), 19), 'A19');
  assert.equal(toGtp(idx(8, 18, 19), 19), 'J1'); // 跳過 I
  assert.equal(fromGtp('Q16', 19), idx(15, 3, 19));
  assert.equal(fromGtp('pass', 19), PASS);
  assert.equal(toSgf(idx(3, 15, 19), 19), 'dp');
  assert.equal(fromSgf('dp', 19), idx(3, 15, 19));
  assert.equal(fromSgf('', 19), PASS);
  assert.equal(fromSgf('tt', 19), PASS);
});

test('星位與讓子', () => {
  assert.equal(starPoints(19).length, 9);
  assert.equal(starPoints(13).length, 5);
  assert.equal(starPoints(9).length, 5);
  assert.equal(handicapPoints(19, 2).length, 2);
  assert.equal(handicapPoints(19, 9).length, 9);
  assert.equal(new Set(handicapPoints(19, 9)).size, 9);
  const g = new Game({ size: 19, handicap: 4 });
  assert.equal(g.turn, WHITE);
  assert.equal(g.board.stones(BLACK), 4);
});

test('提子與叫吃', () => {
  const g = new Game({ size: 9 });
  play(g, ['E5', 'D5', 'A1', 'F5', 'A2', 'E4']);
  const r = g.play(P('B1'));
  assert.ok(r.ok);
  const r2 = g.play(P('E6')); // 白提黑 E5
  assert.ok(r2.ok);
  assert.deepEqual(r2.captured, [P('E5')]);
  assert.equal(g.board.get(P('E5')), EMPTY);
  assert.equal(g.captures[WHITE], 1);
});

test('叫吃偵測', () => {
  const g = new Game({ size: 9 });
  play(g, ['E5', 'D5', 'A1', 'F5', 'A2']);
  const r = g.play(P('E6'));
  assert.ok(r.atari);
});

test('禁止自殺', () => {
  const g = new Game({ size: 9 });
  play(g, ['B1', 'J9', 'A2']);
  // 白下 A1 自殺
  assert.match(g.whyIllegal(P('A1')), /禁著/);
  // 若能提子就不是自殺
  const g2 = new Game({ size: 9 });
  play(g2, ['A2', 'A3', 'B1', 'B2', 'J9', 'C1', 'J8']);
  const r2 = g2.play(P('A1'));
  assert.ok(r2.ok, r2.why);
  assert.equal(r2.captured.length, 2);
});

test('打劫不能立刻提回', () => {
  const g = new Game({ size: 9 });
  // 經典劫：黑 D5 E4 E6 F5? 用 C/D 形
  play(g, ['D5', 'E5', 'C4', 'F4', 'D3', 'E3', 'J9', 'D4', 'E4']);
  // 黑 E4 提白 D4，形成劫
  const last = g.lastMove;
  assert.equal(last.cap.length, 1);
  assert.match(g.whyIllegal(P('D4')), /打劫/);
  play(g, ['A9', 'A8']); // 找劫材、應劫
  assert.equal(g.whyIllegal(P('D4')), null);
});

test('悔棋還原', () => {
  const g = new Game({ size: 9 });
  play(g, ['E5', 'D5', 'A1', 'F5', 'A2', 'E4', 'B1', 'E6']);
  assert.equal(g.captures[WHITE], 1);
  g.undo();
  assert.equal(g.captures[WHITE], 0);
  assert.equal(g.board.get(P('E5')), BLACK);
  assert.equal(g.turn, WHITE);
  const h = g.board.hash;
  g.play(P('E6')); g.undo();
  assert.equal(g.board.hash, h);
});

test('雙方停著', () => {
  const g = new Game({ size: 9 });
  const r1 = g.play(PASS);
  assert.ok(r1.pass && !r1.bothPassed);
  const r2 = g.play(PASS);
  assert.ok(r2.bothPassed);
});

test('數子法與數目法', () => {
  // 9 路：黑佔左邊 4 列（含界線 D），白佔右邊（E 線）
  const b = new Board(9);
  for (let y = 0; y < 9; y++) { b.set(idx(3, y, 9), BLACK); b.set(idx(4, y, 9), WHITE); }
  const s = scorePosition(b, { komi: 7.5, rules: 'chinese' });
  assert.equal(s.stonesB, 9); assert.equal(s.terrB, 27);
  assert.equal(s.stonesW, 9); assert.equal(s.terrW, 36);
  assert.equal(s.black, 36); assert.equal(s.white, 45 + 7.5);
  assert.equal(s.winner, WHITE);
  const j = scorePosition(b, { komi: 6.5, rules: 'japanese', captures: { 1: 2, 2: 0 } });
  assert.equal(j.black, 27 + 2); assert.equal(j.white, 36 + 6.5);
  // 白地裡的黑死子：數子法拿掉後算白地
  b.set(idx(7, 4, 9), BLACK);
  const s2 = scorePosition(b, { komi: 7.5, rules: 'chinese', dead: new Set([idx(7, 4, 9)]) });
  assert.equal(s2.terrW, 36);
  const j2 = scorePosition(b, { komi: 6.5, rules: 'japanese', dead: new Set([idx(7, 4, 9)]) });
  assert.equal(j2.white, 36 + 1 + 6.5);
  assert.match(resultText({ type: 'score', winner: WHITE, diff: -16.5, rules: 'chinese' }), /白勝 16.5 子/);
});

test('形勢判斷死子：整塊一起', () => {
  const b = new Board(9);
  b.set(idx(6, 6, 9), BLACK); b.set(idx(7, 6, 9), BLACK);
  const own = new Float32Array(81).fill(-0.9);
  own[idx(7, 6, 9)] = -0.2; // 其中一顆判斷不明
  const dead = deadFromOwnership(b, own);
  assert.equal(dead.size, 2);
});

test('SGF 往返（含讓子、停著、變化圖）', () => {
  const g = new Game({ size: 19, handicap: 2, komi: 0.5 });
  for (const s of ['Q3', 'C16', 'R16']) g.play(fromGtp(s, 19));
  g.play(PASS);
  const rec = g.toRecord({ black: '小柯', white: '測試]員' });
  rec.result = { type: 'resign', winner: WHITE };
  const sgf = recordToSgf(rec);
  const [r] = parseSgf(sgf);
  assert.equal(r.size, 19); assert.equal(r.handicap, 2); assert.equal(r.komi, 0.5);
  assert.equal(r.setup.black.length, 2);
  assert.equal(r.moves.length, 4);
  assert.equal(r.moves[3].i, PASS);
  assert.equal(r.white, '測試]員');
  assert.deepEqual(r.result, { type: 'resign', winner: WHITE });
  const g2 = Game.replay(r);
  assert.equal(g2.board.hash, g.board.hash);
  // 變化圖：只取主線
  const v = parseSgf('(;GM[1]SZ[9];B[ee](;W[cc];B[gg])(;W[gc];B[cg]))');
  assert.equal(v.length, 1);
  assert.deepEqual(v[0].moves.map((m) => toSgf(m.i, 9)), ['ee', 'cc', 'gg']);
  // 多局合集
  assert.equal(parseSgf('(;SZ[9];B[aa])(;SZ[13];B[bb];W[cc])').length, 2);
});

test('對稱正規化：八個方向同一個鍵', () => {
  const n = 19;
  const base = new Board(n);
  base.set(fromGtp('Q16', n), BLACK); base.set(fromGtp('D4', n), WHITE); base.set(fromGtp('R14', n), BLACK);
  const k0 = canonicalKey(base, WHITE).key;
  for (let s = 1; s < 8; s++) {
    const b = new Board(n);
    for (let i = 0; i < n * n; i++) if (base.cells[i]) b.set(symPoint(i, n, s), base.cells[i]);
    assert.equal(canonicalKey(b, WHITE).key, k0);
  }
  assert.notEqual(canonicalKey(base, BLACK).key, k0);
});

test('棋譜學習：旋轉後的同一個定式查得到', async () => {
  const { Book } = await import('../src/renderer/js/book.js');
  const { symPoint: sp } = await import('../src/renderer/js/go.js');
  const b = new Book();
  const mk = (list) => ({ size: 19, komi: 7.5, rules: 'chinese', moves: list.map((s, k) => ({ c: k % 2 ? WHITE : BLACK, i: fromGtp(s, 19) })), result: { type: 'resign', winner: BLACK } });
  b.addRecord(mk(['Q16', 'R14', 'P17']));
  b.addRecord(mk(['Q16', 'R14', 'R13']));
  // 另一個角：D4 開局，白 C6（Q16/R14 的鏡像）
  const g = new Game({ size: 19 });
  g.play(fromGtp('D4', 19)); g.play(fromGtp('C6', 19));
  const hits = b.lookup(g);
  assert.equal(hits.length, 2);
  assert.ok(hits.every((h) => g.isLegal(h.i)));
  const names = hits.map((h) => toGtp(h.i, 19)).sort();
  assert.deepEqual(names, ['C7', 'E3'].sort());
  assert.equal(b.games, 2);
  void sp;
});
