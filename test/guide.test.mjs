import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS, pts } from '../src/renderer/js/lessons.js';
import { Board, BLACK, WHITE, fromGtp, scorePosition } from '../src/renderer/js/go.js';

// 依課程步驟模擬棋盤，確認每一步都合法
function walk(lesson, onStep) {
  let n = 9, b = new Board(9);
  for (const [k, st] of lesson.steps.entries()) {
    if (st.setup) {
      n = st.setup.size || 9;
      b = new Board(n);
      for (const i of pts(st.setup.B, (s) => fromGtp(s, n))) { assert.ok(i != null && i >= 0, `${lesson.title} 第 ${k + 1} 步座標 ${st.setup.B}`); b.set(i, BLACK); }
      for (const i of pts(st.setup.W, (s) => fromGtp(s, n))) { assert.ok(i != null && i >= 0, `${lesson.title} 第 ${k + 1} 步座標 ${st.setup.W}`); b.set(i, WHITE); }
    }
    const caps = [];
    for (const mv of st.place || []) {
      const [c, s] = mv.split(' ');
      const i = fromGtp(s, n);
      assert.ok(i != null && i >= 0, `${lesson.title}：${mv}`);
      const r = b.place(i, c === 'B' ? BLACK : WHITE);
      assert.ok(r && !r.suicide, `${lesson.title} 第 ${k + 1} 步 ${mv} 不合法`);
      caps.push(r.captured.length);
    }
    onStep && onStep(st, b, n, caps, k);
  }
}

test('每一課的擺子與落子都合法', () => {
  for (const l of LESSONS) {
    assert.ok(l.steps.length >= 3, l.title);
    walk(l, (st, b, n) => {
      for (const s of st.libs || []) assert.ok(b.get(fromGtp(s, n)), `${l.title}：${s} 要有棋子`);
      for (const s of Object.keys(st.marks || {})) assert.ok(fromGtp(s, n) >= 0, `${l.title}：標記 ${s}`);
      assert.ok(st.say && st.say.length > 6, `${l.title} 缺少解說`);
    });
  }
});

test('練習題都有正確答案', () => {
  for (const l of LESSONS) {
    walk(l, (st, b, n) => {
      const pr = st.practice;
      if (!pr) return;
      const c = pr.color === 'W' ? WHITE : BLACK;
      if (pr.goal === 'capture') {
        let found = 0;
        for (let i = 0; i < n * n; i++) { if (b.get(i)) continue; const t = b.clone(); const r = t.place(i, c); if (r && !r.suicide && r.captured.length) found++; }
        assert.ok(found >= 1, `${l.title}：找不到能提子的點`);
        return;
      }
      if (typeof pr.goal === 'string' && pr.goal.startsWith('libs:')) {
        const g = b.group(fromGtp(pr.goal.slice(5), n));
        assert.ok(g && g.libs.size > 0, l.title);
        return;
      }
      for (const s of pr.goal) {
        const i = fromGtp(s, n);
        assert.ok(i >= 0 && !b.get(i), `${l.title}：答案 ${s} 要是空點`);
        if (!pr.pick) { const r = b.clone().place(i, c); assert.ok(r && !r.suicide, `${l.title}：答案 ${s} 要能下`); }
      }
    });
  }
});

test('提子、征子、倒撲課程的提子數正確', () => {
  const byTitle = Object.fromEntries(LESSONS.map((l) => [l.title, l]));
  const capsOf = (title) => { const out = []; walk(byTitle[title], (st, b, n, caps) => out.push(...caps)); return out; };
  assert.deepEqual(capsOf('提子').filter(Boolean), [1, 1, 2]);
  const ladder = capsOf('征子');
  assert.equal(ladder[ladder.length - 1], 12);
  assert.deepEqual(capsOf('倒撲'), [0, 1, 5]);
  assert.deepEqual(capsOf('禁著點（不能自殺）').filter(Boolean), [4]);
});

test('終局課程的數子數字與解說一致', () => {
  const l = LESSONS.find((x) => x.title === '終局與勝負');
  walk(l, (st, b) => {
    if (!st.terr) return;
    const s = scorePosition(b, { komi: 7.5 });
    assert.equal(s.stonesB, 10); assert.equal(s.terrB, 35); assert.equal(s.black, 45);
    assert.equal(s.stonesW, 10); assert.equal(s.terrW, 26); assert.equal(s.white, 43.5);
    assert.ok(st.say.includes('35') && st.say.includes('26'));
  });
  // 金角銀邊：角 7 子圍 9 點、邊 11 子圍 9 點
  const b2 = LESSONS.find((x) => x.title === '布局：金角銀邊');
  const terr = [];
  walk(b2, (st, b) => { if (st.terr) terr.push(scorePosition(b, { komi: 0 }).terrB); });
  assert.deepEqual(terr, [9, 9]);
});
