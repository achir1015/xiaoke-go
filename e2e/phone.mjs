// 實機測試：透過 adb 連到手機上小柯圍棋（除錯版 APK）的 WebView，用 DevTools 協定檢查功能；落子用 adb 真的觸控螢幕
// 用法：python android/build.py debug install，手機解鎖後執行 node e2e/phone.mjs [手機序號]
import { chromium } from 'playwright-core';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ADB = process.env.ADB || 'E:/小米觸控音箱/tools/android-sdk/platform-tools/adb.exe';
const SERIAL = process.argv[2] || process.env.ANDROID_SERIAL || 'R5CY236CQ3B';
const outDir = process.argv[3] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
const adb = (...a) => execFileSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
const shotPhone = (name) => fs.writeFileSync(path.join(outDir, name), execFileSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

// 安全守則：只有本 App 在前景、螢幕沒鎖時才操作
const focus = adb('shell', 'dumpsys', 'window');
if (/isKeyguardShowing=true/.test(focus)) { console.log('手機鎖著，請先解鎖'); process.exit(2); }
const fm = focus.match(/mCurrentFocus=[^\r\n]*/g) || [];
if (!fm.some((f) => f.includes('com.achir.xiaokego'))) { console.log('前景不是小柯圍棋：', fm.join(' ')); process.exit(2); }
const sock = /@?(webview_devtools_remote_\d+)/.exec(adb('shell', 'cat', '/proc/net/unix'));
if (!sock) { console.log('找不到 WebView 偵錯通道（要用 python android/build.py debug 建置）'); process.exit(2); }
execFileSync(ADB, ['-s', SERIAL, 'forward', 'tcp:9335', 'localabstract:' + sock[1]]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9335');
const page = browser.contexts()[0].pages().find((p) => p.url().includes('appassets')) || browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const waitFor = async (fn, arg, ms = 30000) => {
  const t = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg).catch(() => false);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
    await new Promise((r) => setTimeout(r, 250));
  }
};
// 棋盤交叉點在手機螢幕上的實際像素位置，用 adb 點下去
const tapPoint = async (i) => {
  const p = await page.evaluate((i) => {
    const b = window.__xkgBoard;
    const V = b.camera.position.constructor;
    const v = new V(b.X(i), 1.45, b.Z(i)).project(b.camera);
    const r = b.renderer.domElement.getBoundingClientRect();
    const top = (screen.height - innerHeight) * devicePixelRatio; // 上方瀏海那一條不畫網頁
    return { x: (r.left + (v.x + 1) / 2 * r.width) * devicePixelRatio, y: top + (r.top + (1 - v.y) / 2 * r.height) * devicePixelRatio };
  }, i);
  adb('shell', 'input', 'tap', String(Math.round(p.x)), String(Math.round(p.y)));
};
const tapEl = async (sel) => {
  const p = await page.evaluate((sel) => { document.querySelector(sel).scrollIntoView({ block: 'center' }); const r = document.querySelector(sel).getBoundingClientRect(); const top = (screen.height - innerHeight) * devicePixelRatio; return { x: (r.left + r.width / 2) * devicePixelRatio, y: top + (r.top + r.height / 2) * devicePixelRatio }; }, sel);
  adb('shell', 'input', 'tap', String(Math.round(p.x)), String(Math.round(p.y)));
};

try {
  const info = await page.evaluate(() => ({
    android: !!window.XiaokeAndroid, mobile: document.documentElement.classList.contains('mobile'),
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio, ver: JSON.parse(window.XiaokeAndroid.appInfo()).version,
    webgl: !!document.createElement('canvas').getContext('webgl2'),
  }));
  console.log('  ', JSON.stringify(info));
  check('在 Android App 裡執行（原生橋接、手機版面）', info.android && info.mobile);
  check('WebGL2（3D 棋盤）可用', info.webgl);
  check('直立畫面', info.h > info.w);
  await page.reload();
  await waitFor(() => window.__xkg && window.__xkgBoard && document.querySelector('#startAI'));
  await page.evaluate(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'm03', advisor: 'af07' } }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  await page.waitForTimeout(800);
  shotPhone('p1-home.png');
  check('20 首背景音樂', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  check('半身照 70 張', (await page.evaluate(() => fetch('assets/portraits/portraits.json').then((r) => r.json()).then((l) => l.length))) === 70);
  check('首頁顯示小柯 JS 引擎', /JS 引擎/.test(await page.evaluate(() => document.querySelector('#engineStatus').textContent)));
  const tts = await page.evaluate(() => window.xk.tts && window.xk.tts.available());
  check('原生中文語音可用（教學、播報）', !!tts, String(tts));

  // 真人對 AI：9 路、初級
  await page.evaluate(() => { document.querySelector('#startAI').parentElement.querySelector('button[data-v="9"]').click(); document.querySelector('#aiLevel').value = '1'; document.querySelector('#aiLevel').dispatchEvent(new Event('change')); });
  await tapEl('#startAI');
  await waitFor(() => window.__xkg.mode === 'ai' && /輪到您/.test(document.querySelector('#turnBanner').textContent));
  await page.waitForTimeout(3500); // 對陣畫面
  shotPhone('p2-game.png');
  check('棋盤佔滿中間', await page.evaluate(() => document.querySelector('#boardWrap').getBoundingClientRect().height > innerHeight * 0.45));
  await tapPoint(40);
  await waitFor(() => window.__xkg.game.ply >= 1, null, 8000);
  check('手指點天元落子', await page.evaluate(() => window.__xkg.game.board.cells[40] === 1));
  await waitFor(() => window.__xkg.game.ply >= 2 && !window.__xkg.aiThinking && !window.__xkg.animating, null, 40000);
  check('AI（JS 引擎）回應', true);
  await waitFor(() => window.__xkg.stats[2], null, 30000);
  check('勝率數據', await page.evaluate(() => /黑 \d/.test(document.querySelector('.wr-bt').textContent)));
  await page.waitForTimeout(500);
  shotPhone('p3-after-move.png');
  // 底部抽屜：數據
  await tapEl('.tab[data-tab="data"]');
  await page.waitForTimeout(600);
  check('數據抽屜打開', await page.evaluate(() => document.body.classList.contains('sheet-open')));
  shotPhone('p4-data.png');
  await tapEl('.tab[data-tab="data"]');
  await page.waitForTimeout(400);
  // 音量（直立滑桿點一下打開）
  await tapEl('#miniMusic');
  await page.waitForTimeout(400);
  check('音樂直立滑桿', await page.evaluate(() => document.querySelector('.music-vol').classList.contains('open')));
  shotPhone('p5-volume.png');
  await page.evaluate(() => document.body.click());
  // 返回首頁 → 教學
  await page.evaluate(() => { window.__xkgBack(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = document.querySelector('.modal-btns button.primary'); if (b) b.click(); });
  await waitFor(() => window.__xkg.screen === 'home');
  await tapEl('#btnGuide');
  await waitFor(() => window.__guide && document.querySelector('.gd-caption').textContent.length > 5);
  await page.waitForTimeout(2500);
  shotPhone('p6-guide.png');
  check('教學畫面', await page.evaluate(() => document.querySelectorAll('.gd-item').length >= 12));
  await page.evaluate(() => window.__xkgBack());
  await tapEl('#btnHelp');
  await waitFor(() => document.querySelectorAll('.help-card').length === 12);
  shotPhone('p7-help.png');
  check('功能說明', true);
  await page.evaluate(() => window.__xkgBack());
} catch (e) {
  fail++;
  console.log('✘ 例外：', e.message);
  shotPhone('fail-phone.png');
}
check('沒有頁面錯誤', errors.length === 0, errors.join('\n'));
console.log(`\n通過 ${pass}，失敗 ${fail}`);
await browser.close();
process.exit(fail ? 1 : 0);
