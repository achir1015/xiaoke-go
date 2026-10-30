// 遠端對弈端對端測試：本機配對伺服器＋兩個程式實例（房主 A、來賓 B）
// 項目：建房加入、黑白分配、輪流落子、聊天、軍師代打與交還、換軍師同步、悔棋同意、停一手數子雙方確認、再來一局
// 用法：node e2e/net.mjs [截圖資料夾]
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const { PeerServer } = require('peer');
const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const PORT = 9151;
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
for (const p of ['e2eA', 'e2eB']) fs.rmSync(path.join(appData, 'xiaoke-go-' + p), { recursive: true, force: true });
const server = PeerServer({ port: PORT, path: '/' });

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

async function launch(profile, name) {
  const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=' + profile, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const win = await app.firstWindow();
  const errors = [];
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  win.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
  await win.waitForSelector('#btnHost', { timeout: 20000 });
  await win.evaluate(async ({ port, name }) => {
    window.__xkg.settings = await window.xk.settings.set({ playerName: name, announce: false, server: { mode: 'custom', host: '127.0.0.1', port, path: '/', secure: false }, music: { autoplay: false }, profile: name === '小明' ? { avatar: 'm05', advisor: 'am01' } : { avatar: 'f02', advisor: 'af03' } });
    document.querySelectorAll('.modal-back').forEach((b) => b.remove());
  }, { port: PORT, name });
  const waitFor = async (fn, arg, ms = 25000) => {
    const t = Date.now();
    for (;;) {
      const v = await win.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(profile + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  return { app, win, errors, waitFor };
}

const A = await launch('e2eA', '小明');
const B = await launch('e2eB', '阿華');
const banner = (X) => X.win.evaluate(() => document.querySelector('#turnBanner').textContent);
const point = (X, i) => X.win.evaluate((i) => window.__xkgBoard.onPoint(i), i);
const ply = (X) => X.win.evaluate(() => window.__xkg.game.ply);
const settle = (X, n) => X.waitFor((n) => window.__xkg.game.ply === n && !window.__xkg.animating, n);

try {
  await A.win.click('#btnHost >> xpath=../..//button[@data-v="9"]');
  await A.win.selectOption('#hostSide', 'black');
  await A.win.click('#btnHost');
  const code = (await A.waitFor(() => document.querySelector('.room-code')?.textContent)).replace(/\s/g, '');
  check('建立房間取得 6 位數房號', /^\d{6}$/.test(code), code);
  await B.win.fill('#joinCode', code);
  await B.win.click('#btnJoin');
  await A.waitFor(() => window.__xkg.netStarted);
  await B.waitFor(() => window.__xkg.netStarted);
  check('雙方進入對局（9 路）', (await B.win.evaluate(() => window.__xkg.game.size)) === 9);
  check('A 執黑、B 執白', (await A.win.evaluate(() => window.__xkg.mySide)) === 1 && (await B.win.evaluate(() => window.__xkg.mySide)) === 2);
  check('A 提示輪到您下棋', (await banner(A)).startsWith('輪到您下棋'), await banner(A));
  check('B 提示換您觀棋', (await banner(B)).startsWith('換您觀棋'), await banner(B));
  check('雙方頭像互通', (await B.win.evaluate(() => window.__xkg.players[1].avatar + '/' + window.__xkg.players[2].avatar)) === 'm05/f02');

  await point(B, 40);
  await B.win.waitForTimeout(400);
  check('非自己回合不能下', (await ply(B)) === 0);
  await point(A, 40);
  await settle(B, 1);
  check('B 收到 A 的天元', await B.win.evaluate(() => window.__xkg.game.board.cells[40] === 1));
  await point(B, 20);
  await settle(A, 2);
  check('A 收到 B 的著手', await A.win.evaluate(() => window.__xkg.game.board.cells[20] === 2));

  // 聊天
  await B.win.click('.tab[data-tab="chat"]');
  await B.win.fill('#chatInput', '請多指教');
  await B.win.click('#chatSend');
  await A.waitFor(() => [...document.querySelectorAll('.chat-msg.opp')].some((e) => e.textContent.includes('請多指教')));
  check('文字聊天', true);

  // A 換軍師 → B 看到
  await A.win.click('#pBlack .padv-change');
  await A.win.waitForSelector('.pf-advgrid');
  await A.win.click('.pf-advgrid .pf-item[data-id="am12"]');
  await A.win.click('.modal-btns button.primary');
  await B.waitFor(() => window.__xkg.players[1].advisor === 'am12');
  check('中途換軍師雙方同步', true);

  // A 軍師代打：A 的回合由軍師自動下，B 看到代打
  await A.win.click('#btnProxy');
  await B.waitFor(() => window.__xkg.proxy[1]);
  check('B 看到對方軍師代打', /代打/.test(await banner(B)) || (await B.win.evaluate(() => document.querySelector('#pBlack').classList.contains('proxy'))));
  await settle(B, 3);
  check('軍師代打的著手傳到對方', true);
  await A.win.screenshot({ path: path.join(outDir, 'net-A-proxy.png') });
  await A.win.click('#btnProxy');
  await B.waitFor(() => !window.__xkg.proxy[1]);
  check('交還主位雙方同步', true);

  // B 下一手，A 下一手，B 請求悔棋
  await point(B, 60);
  await settle(A, 4);
  const empty = await A.win.evaluate(() => { const g = window.__xkg.game; return [10, 12, 14, 16, 28, 30, 32, 34].find((i) => g.isLegal(i)); });
  await point(A, empty);
  await settle(B, 5);
  await B.win.click('#btnUndo');
  await A.win.waitForSelector('.modal-btns button.primary');
  await A.win.click('.modal-btns button.primary');
  await B.waitFor(() => window.__xkg.game.ply === 3 && !window.__xkg.animating);
  await A.waitFor(() => window.__xkg.game.ply === 3);
  check('悔棋需對方同意且雙方同步', (await banner(B)).startsWith('輪到您下棋'), await banner(B));

  // 停一手 → 數子：房主判斷、雙方確認
  await B.win.click('#btnPass');
  await settle(A, 4);
  await A.win.click('#btnPass');
  await A.waitFor(() => document.querySelector('#btnScoreOk'), null, 40000);
  await B.waitFor(() => document.querySelector('#btnScoreOk'), null, 40000);
  check('雙方都進入數子', true);
  await A.win.screenshot({ path: path.join(outDir, 'net-A-score.png') });
  await A.win.click('#btnScoreOk');
  await B.waitFor(() => /對方已確認|確認/.test(document.body.textContent));
  await B.win.click('#btnScoreOk');
  await A.waitFor(() => window.__xkg.game.result && window.__xkg.game.result.type === 'score');
  await B.waitFor(() => window.__xkg.game.result && window.__xkg.game.result.type === 'score');
  check('雙方確認後同一個結果', (await A.win.evaluate(() => window.__xkg.game.result.diff)) === (await B.win.evaluate(() => window.__xkg.game.result.diff)));
  await A.win.click('.modal-btns button');
  await B.win.click('.modal-btns button');

  // 再來一局（黑白交換）
  await B.win.click('#btnNew');
  await A.win.waitForSelector('.modal-btns button.primary');
  await A.win.click('.modal-btns button.primary');
  await A.waitFor(() => window.__xkg.game && window.__xkg.game.ply === 0 && !window.__xkg.game.result && window.__xkg.mySide === 2);
  await B.waitFor(() => window.__xkg.game && window.__xkg.game.ply === 0 && window.__xkg.mySide === 1);
  check('再來一局黑白交換', true);
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  await A.win.screenshot({ path: path.join(outDir, 'net-fail-A.png') }).catch(() => {});
  await B.win.screenshot({ path: path.join(outDir, 'net-fail-B.png') }).catch(() => {});
}
for (const [n, X] of [['A', A], ['B', B]]) {
  const errs = X.errors.filter((e) => !/WebSocket|net::ERR|peerjs|Could not connect/i.test(e));
  check(`${n} 沒有主控台錯誤`, errs.length === 0, errs.slice(0, 4).join('\n'));
}
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await A.app.close();
await B.app.close();
server.close && server.close();
process.exit(fail ? 1 : 0);
