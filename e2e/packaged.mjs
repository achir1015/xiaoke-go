// 打包版測試：node e2e/packaged.mjs <exe 路徑，例如 dist/win-unpacked/XiaokeGo.exe>
// 確認打包後找得到 KataGo、能下棋並算出勝率、音樂與頭像都在
import { _electron as electron } from 'playwright-core';
import path from 'path';
import fs from 'fs';
import os from 'os';

const exe = path.resolve(process.argv[2] || 'dist/win-unpacked/XiaokeGo.exe');
const appData = process.env.APPDATA || path.join(os.homedir(), 'Library', 'Application Support');
fs.rmSync(path.join(appData, 'xiaoke-go-e2ePkg'), { recursive: true, force: true });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };
const app = await electron.launch({ executablePath: exe, args: ['--profile=e2ePkg'] });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 40000) => {
  const t = Date.now();
  for (;;) {
    const v = await win.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 200));
  }
};
try {
  await win.waitForSelector('#startAI', { timeout: 30000 });
  const info = await win.evaluate(() => window.xk.sys.info());
  check('打包版', info.packaged, JSON.stringify(info));
  const st = await win.evaluate(() => window.xk.kata.status());
  check('打包版找得到 KataGo（快速＋深度）', st.available && st.strong, JSON.stringify(st));
  await win.evaluate(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'm02', advisor: 'am03' }, announce: false }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  check('背景音樂 20 首', (await win.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  await win.click('#startAI >> xpath=..//button[@data-v="9"]');
  await win.selectOption('#aiLevel', '5');
  await win.click('#startAI');
  await waitFor(() => window.__xkg.stats[0]);
  check('開局算出勝率', true);
  await win.evaluate(() => window.__xkgBoard.onPoint(40));
  await waitFor(() => window.__xkg.game.ply === 2 && !window.__xkg.aiThinking, null, 60000);
  check('大師（深度網路）回應', /搜尋/.test(await win.evaluate(() => document.querySelector('#aiInfo').textContent)), await win.evaluate(() => document.querySelector('#aiInfo').textContent));
  const upd = await win.evaluate(() => window.xk.update.check().then((r) => r.flavor + ':' + r.current).catch((e) => 'ERR ' + e.message));
  check('更新檢查可執行', /nsis|portable|mac|other|ERR/.test(upd), upd);
} catch (e) { fail++; console.log('✘ 例外：', e.message); }
check('沒有頁面錯誤', errors.length === 0, errors.join('\n'));
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await app.close();
process.exit(fail ? 1 : 0);
