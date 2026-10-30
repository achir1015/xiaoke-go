// 單機端對端測試：首頁、真人對 AI（KataGo）、勝率數據、軍師、提示、形勢、代打、換軍師、停一手數子、認輸、棋譜庫、覆盤速算、教學、功能說明、AI 對 AI
// 用法：node e2e/smoke.mjs [截圖資料夾]；W、H 環境變數可指定視窗大小
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-go-e2eSmoke'), { recursive: true, force: true });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke', '--autoplay-policy=no-user-gesture-required'] });
const win = await app.firstWindow();
if (process.env.W) await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.unmaximize(); b.setContentSize(w, h); }, [Number(process.env.W), Number(process.env.H || 720)]);
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 150));
  }
};
const S = (expr, arg) => win.evaluate(expr, arg);
const myTurn = (ms) => waitFor(() => document.querySelector('#turnBanner').textContent.startsWith('輪到您下棋') && !window.__xkg.animating && !window.__xkg.aiThinking, null, ms);
// 用真實滑鼠點棋盤上的交叉點（投影 3D 座標到螢幕）
const clickPoint = async (i) => {
  const p = await win.evaluate((i) => {
    const b = window.__xkgBoard;
    const V = b.camera.position.constructor;
    const v = new V(b.X(i), 1.45, b.Z(i)).project(b.camera);
    const r = b.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }, i);
  await win.mouse.move(p.x, p.y);
  await win.waitForTimeout(80);
  await win.mouse.click(p.x, p.y);
};
const emptyPoint = () => S(() => { const g = window.__xkg.game; const n = g.size; const c = (n - 1) / 2; const order = [...Array(n * n).keys()].sort((a, b) => Math.hypot(a % n - c, (a / n | 0) - c) - Math.hypot(b % n - c, (b / n | 0) - c)); return order.find((i) => g.isLegal(i) && g.board.nb[i].some((j) => !g.board.cells[j])); });

try {
  await win.waitForSelector('#startAI', { timeout: 20000 });
  await S(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'm01', advisor: 'am01' }, announce: false }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  await win.waitForTimeout(400);
  check('首頁三種參賽方式', (await win.locator('.mode-card').count()) === 3);
  const nTracks = await S(() => window.xk.music.list().then((l) => l.length));
  check('內建 20 首背景音樂', nTracks === 20, String(nTracks));
  const nPort = await S(() => fetch('../../assets/portraits/portraits.json').then((r) => r.json()).then((l) => [l.filter((p) => p.group === 'hero').length, l.filter((p) => p.group === 'beauty').length, l.filter((p) => p.group === 'advisor').length].join(',')));
  check('半身照：男 20、女 20、軍師 30', nPort === '20,20,30', nPort);
  const kst = await S(() => window.xk.kata.status());
  check('KataGo 引擎檔案存在（快速＋深度網路）', kst.available && kst.strong, JSON.stringify(kst));
  await waitFor(() => /KataGo/.test(document.querySelector('#engineStatus').textContent), null, 40000);
  check('首頁顯示 KataGo 已就緒', true);
  await win.screenshot({ path: path.join(outDir, '1-home.png') });

  // ---------- 真人對 AI（9 路、入門、執黑） ----------
  await win.click('#startAI >> xpath=..//button[@data-v="9"]');
  await win.click('#startAI >> xpath=..//button[@data-v="black"]');
  await win.selectOption('#aiLevel', '0');
  await win.click('#startAI');
  await myTurn();
  check('開局提示「輪到您下棋」', true);
  await waitFor(() => window.__xkg.stats[0], null, 30000);
  const wr0 = await S(() => window.__xkg.stats[0].wr);
  check('開局就有 KataGo 勝率', wr0 > 0.2 && wr0 < 0.8, String(wr0));
  await win.screenshot({ path: path.join(outDir, '2-board.png') });

  // 真實滑鼠落子
  await clickPoint(await S(() => window.__xkg.game.size * 4 + 4)); // 天元
  await waitFor(() => window.__xkg.game.ply >= 1);
  check('滑鼠點天元落子', await S(() => window.__xkg.game.board.cells[40] === 1));
  await myTurn(40000);
  check('AI 已回應', await S(() => window.__xkg.game.ply === 2));
  // 下在有子的位置：說明原因
  await clickPoint(40);
  await waitFor(() => [...document.querySelectorAll('.toast.why')].some((t) => t.textContent.includes('已經有棋子')), null, 5000);
  check('下在有子處會說明原因', true);

  // 數據分頁
  await waitFor(() => window.__xkg.stats[2] && document.querySelector('#dpTable').rows.length > 2, null, 30000);
  check('數據分頁：勝率與候選著法表', await S(() => document.querySelector('#dpWrB').textContent.includes('%')));
  check('左側小勝率條', await S(() => /黑 \d/.test(document.querySelector('.wr-bt').textContent)));

  // 提示
  await win.click('#btnHint');
  await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('提示')), null, 30000);
  check('提示顯示建議位置與勝率', await S(() => window.__xkgBoard.hintRing.visible));

  // 形勢判斷
  await win.click('#btnEstimate');
  await waitFor(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('形勢判斷')), null, 30000);
  check('形勢判斷', await S(() => !!window.__xkgBoard.overlayState.ownership));
  await win.click('#btnEstimate');

  // 軍師（離線）
  await win.click('.tab[data-tab="advisor"]');
  await win.click('.adv-quick button');
  await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => e.textContent.includes('建議下')), null, 40000);
  check('AI 軍師（離線）給出建議', true);
  await win.screenshot({ path: path.join(outDir, '3-advisor.png') });

  // 換軍師
  await win.click('#pBlack .padv-change');
  await win.waitForSelector('.pf-advgrid');
  await win.click('.pf-advgrid .pf-item[data-id="af15"]');
  await win.click('.modal-btns button.primary');
  await waitFor(() => window.__xkg.players[1].advisor === 'af15');
  check('中途換 AI 軍師', await S(() => document.querySelector('#pBlack .padvname').textContent.includes(window.__xkg.players ? '' : '')));

  // 軍師代打 → 交還主位
  await win.click('#btnProxy');
  await waitFor(() => window.__xkg.game.ply >= 4, null, 60000);
  check('軍師代打會自動下棋', true);
  await win.click('#btnProxy');
  await myTurn(60000);
  check('交還主位後換回自己下', await S(() => !window.__xkg.proxy[1]));

  // 悔棋
  const before = await S(() => window.__xkg.game.ply);
  await win.click('#btnUndo');
  await waitFor((b) => window.__xkg.game.ply === b - 2, before, 5000);
  check('悔棋退回兩手', true);
  await myTurn(40000);

  // 認輸 → 存檔
  await win.click('#btnResign');
  await win.click('.modal-btns button.primary');
  await waitFor(() => document.querySelector('.modal h3') && /輸|結束/.test(document.querySelector('.modal h3').textContent), null, 10000);
  check('認輸後顯示結果', await S(() => window.__xkg.game.result.type === 'resign'));
  await win.screenshot({ path: path.join(outDir, '4-resign.png') });
  await win.click('.modal-btns button:not(.primary)');

  // ---------- 本機兩人對弈：雙方停一手 → 數子 ----------
  await win.click('#btnHome');
  await win.waitForSelector('#btnLocal');
  await win.click('#btnLocal >> xpath=..//button[@data-v="9"]');
  await win.click('#btnLocal');
  await waitFor(() => window.__xkg.mode === 'local' && /輪到黑方/.test(document.querySelector('#turnBanner').textContent));
  for (const p of [20, 60, 22, 58, 24, 56]) { await S((i) => window.__xkgBoard.onPoint(i), p); await waitFor((n) => window.__xkg.game.ply === n && !window.__xkg.animating, [20, 60, 22, 58, 24, 56].indexOf(p) + 1); }
  await win.click('#btnPass');
  await waitFor(() => window.__xkg.game.ply === 7 && !window.__xkg.animating);
  await win.click('#btnPass');
  await waitFor(() => document.querySelector('#btnScoreOk'), null, 30000);
  check('雙方停一手進入數子', await S(() => !!window.__xkg.scoring && document.querySelector('.sp-res').textContent.length > 0));
  await win.screenshot({ path: path.join(outDir, '5-scoring.png') });
  // 點棋子切換死活
  const d0 = await S(() => window.__xkg.scoring.dead.size);
  await S(() => window.__xkgBoard.onPoint(60));
  check('點棋子可以切換死活', await S((d) => window.__xkg.scoring.dead.size !== d, d0));
  await win.click('#btnScoreOk');
  await waitFor(() => window.__xkg.game.result && window.__xkg.game.result.type === 'score', null, 5000);
  check('確認後判定勝負', await S(() => /勝|和/.test(document.querySelector('.modal p').textContent)));
  await win.click('.modal-btns button:not(.primary)');

  // ---------- 棋譜庫、重播、覆盤速算 ----------
  await win.click('#btnHome');
  await win.click('text=📜 棋譜庫');
  await win.waitForSelector('.rec-table');
  check('棋譜庫收錄對局', (await win.locator('.rec-table tbody tr').count()) >= 2);
  await win.locator('.rec-table tbody tr').last().locator('text=重播').click();
  await waitFor(() => window.__xkg.mode === 'replay');
  await win.click('#rpLast');
  await win.click('#rpAnalyze');
  await waitFor(() => !window.__xkg.replay.busy && window.__xkg.stats.filter(Boolean).length >= window.__xkg.replay.full.ply, null, 90000);
  check('覆盤速算算出每一手的勝率', await S(() => document.querySelector('#dpMistakes').textContent.includes('疑問手')));
  await win.click('#rpNums');
  await win.screenshot({ path: path.join(outDir, '6-replay.png') });

  // ---------- 教學 ----------
  await win.click('#btnHome');
  await win.click('#btnGuide');
  await waitFor(() => document.querySelector('.gd-caption').textContent.length > 5);
  check('教學開始講解', await S(() => document.querySelectorAll('.gd-item').length >= 12));
  await S(() => { window.__guide.narr.on = false; window.__guide.go(2); });
  await waitFor(() => window.__guide.practice, null, 60000);
  check('提子課出現練習題', true);
  await S(() => window.__guide.onBoardClick(window.__guide.b.n * 3 + 5)); // F6 = x5,y3
  await waitFor(() => document.querySelector('.gd-caption').textContent.includes('答對'), null, 10000);
  check('練習答對有回饋', true);
  await win.screenshot({ path: path.join(outDir, '7-guide.png') });
  await win.click('#scr-guide .gd-head button');

  // ---------- 功能說明 ----------
  await win.click('#btnHelp');
  await win.waitForSelector('.help-card');
  check('功能說明 12 項（文字＋語音）', (await win.locator('.help-card').count()) === 12);
  await win.screenshot({ path: path.join(outDir, '8-help.png') });
  await win.click('#scr-help .gd-head button');

  // ---------- AI 對 AI ----------
  await win.click('#startAivai >> xpath=..//button[@data-v="9"]');
  await win.click('#startAivai >> xpath=..//button[@data-v="fast"]');
  await win.selectOption('#aivaiB', '3');
  await win.selectOption('#aivaiW', '1');
  await win.click('#startAivai');
  await waitFor(() => window.__xkg.game && window.__xkg.game.ply >= 8, null, 90000);
  check('AI 對 AI 自動對弈', true);
  await win.screenshot({ path: path.join(outDir, '9-aivai.png') });
  await win.click('#btnPause');
  check('AI 對 AI 可暫停', await S(() => window.__xkg.paused));
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  console.log('  狀態：', await win.evaluate(() => JSON.stringify({ mode: window.__xkg.mode, ply: window.__xkg.game && window.__xkg.game.ply, anim: window.__xkg.animating, ait: window.__xkg.aiThinking, sc: !!window.__xkg.scoring, banner: document.querySelector('#turnBanner').textContent })).catch(() => ''));
  await win.screenshot({ path: path.join(outDir, 'fail.png') }).catch(() => {});
}
const errs = errors.filter((e) => !/peerjs|WebSocket|net::ERR/.test(e));
check('沒有主控台錯誤', errs.length === 0, errs.slice(0, 5).join('\n'));
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await app.close();
process.exit(fail ? 1 : 0);
