// 線上版測試：把 docs/（首頁、iPad 安裝頁）＋ mobile/www（線上版）組成和 GitHub Pages 一樣的網站，用 Edge 開來測
// 用法：node scripts/build-mobile.mjs && node e2e/web.mjs [截圖資料夾]；SITE=https://achir1015.github.io/xiaoke-go 改測正式網站
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outDir = process.argv[2] || 'e2e/out';
fs.mkdirSync(outDir, { recursive: true });
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) { pass++; console.log('✔', name); } else { fail++; console.log('✘', name, extra); } };

// 本機網站：/xiaoke-go/ → docs，/xiaoke-go/online/ → mobile/www（路徑和 Pages 相同，測得到子目錄問題）
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.plist': 'application/xml', '.wasm': 'application/wasm' };
let server = null, SITE = process.env.SITE;
if (!SITE) {
  server = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    if (!u.startsWith('/xiaoke-go/')) { res.writeHead(404).end(); return; }
    u = u.slice('/xiaoke-go/'.length);
    let f = u.startsWith('online/') ? path.join('mobile/www', u.slice(7)) : path.join('docs', u);
    if (!f.startsWith('mobile') && !f.startsWith('docs')) { res.writeHead(403).end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  }).listen(0);
  SITE = `http://127.0.0.1:${server.address().port}/xiaoke-go`;
}

const browser = await chromium.launch({ channel: 'msedge', headless: process.env.HEADED ? false : true, args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-unsafe-swiftshader'] });

async function run(label, ctxOpts, body) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|api\.github\.com|ERR_INTERNET|status of 40[34]/.test(m.text())) errors.push(m.text()); });
  const waitFor = async (fn, arg, ms = 30000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error('等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  const clickPoint = async (i) => {
    const p = await page.evaluate((i) => {
      const b = window.__xkgBoard;
      const v = new b.camera.position.constructor(b.X(i), 1.45, b.Z(i)).project(b.camera);
      const r = b.renderer.domElement.getBoundingClientRect();
      return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
    }, i);
    if (ctxOpts.hasTouch) await page.touchscreen.tap(p.x, p.y);
    else { await page.mouse.move(p.x, p.y); await page.waitForTimeout(80); await page.mouse.click(p.x, p.y); }
  };
  try { await body({ page, waitFor, clickPoint }); }
  catch (e) { fail++; console.log('✘ 例外：', e.message); await page.screenshot({ path: path.join(outDir, `web-fail-${label}.png`) }).catch(() => {}); }
  check(`${label}：沒有頁面錯誤`, errors.length === 0, errors.join('\n'));
  await ctx.close();
}

// ---------- 電腦瀏覽器 ----------
await run('電腦', { viewport: { width: 1440, height: 860 } }, async ({ page, waitFor, clickPoint }) => {
  await page.goto(SITE + '/');
  check('網站首頁有「立即線上玩」', await page.locator('a.play[href="online/"]').count() === 1);
  check('網站首頁有 iPad／iPhone 安裝連結', await page.locator('a[href="ios/"]').count() === 1);
  await page.screenshot({ path: path.join(outDir, 'web-0-landing.png') });
  await page.click('a.play');
  await page.waitForSelector('#startAI', { timeout: 30000 });
  await page.evaluate(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'm02', advisor: 'am03' }, announce: false }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  const info = await page.evaluate(() => ({ cls: document.documentElement.className, ver: window.XKG_VERSION, plat: window.__xkg.info.platform }));
  check('以網頁模式執行（電腦版面）', /webapp/.test(info.cls) && !/mobile/.test(info.cls) && info.plat === 'web', JSON.stringify(info));
  check('有 Web App 資訊（可安裝／加入主畫面）', await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()).then((j) => j.short_name === '小柯圍棋')));
  check('20 首背景音樂', (await page.evaluate(() => window.xk.music.list().then((l) => l.length))) === 20);
  check('半身照 70 張', (await page.evaluate(() => fetch('assets/portraits/portraits.json').then((r) => r.json()).then((l) => l.length))) === 70);
  check('音樂檔讀得到', await page.evaluate(() => window.xk.music.list().then((l) => fetch(l[0].url, { method: 'HEAD' })).then((r) => r.ok)));
  await waitFor(() => /JS 引擎/.test(document.querySelector('#engineStatus').textContent));
  check('首頁顯示小柯 JS 引擎', true);
  const upd = await page.evaluate(() => window.xk.update.check());
  check('檢查更新（網站版本號）', upd.flavor === 'web' && upd.latest === upd.current && !upd.newer, JSON.stringify(upd));
  check('瀏覽器語音可用', await page.evaluate(() => 'speechSynthesis' in window));
  await page.screenshot({ path: path.join(outDir, 'web-1-home.png') });

  // 真人對 AI：19 路、初級
  await page.click('#startAI >> xpath=..//button[@data-v="19"]');
  await page.click('#startAI >> xpath=..//button[@data-v="black"]');
  await page.selectOption('#aiLevel', '1');
  await page.click('#startAI');
  await waitFor(() => window.__xkg.mode === 'ai' && /輪到您/.test(document.querySelector('#turnBanner').textContent) && !window.__xkg.animating);
  await page.waitForTimeout(2500);
  await clickPoint(3 * 19 + 15);
  await waitFor(() => window.__xkg.game.ply >= 1, null, 8000);
  check('滑鼠點棋盤落子（19 路）', await page.evaluate(() => window.__xkg.game.board.cells[3 * 19 + 15] === 1));
  await waitFor(() => window.__xkg.game.ply >= 2 && !window.__xkg.aiThinking && !window.__xkg.animating, null, 40000);
  check('AI 回應', true);
  await waitFor(() => window.__xkg.stats[2], null, 30000);
  check('即時勝率', await page.evaluate(() => /黑 \d/.test(document.querySelector('.wr-bt').textContent)));
  await page.screenshot({ path: path.join(outDir, 'web-2-game.png') });
  // 棋譜存在瀏覽器（IndexedDB），重新整理後還在
  await page.evaluate(() => window.xk.games.save({ id: 'webtest-1', date: new Date().toISOString(), mode: 'ai', size: 9, komi: 7.5, rules: 'chinese', black: '棋友', white: '小柯', moves: [40, 30], result: 'B+R' }));
  await page.reload();
  await page.waitForSelector('#startAI', { timeout: 30000 });
  check('棋譜存在瀏覽器，重新整理後還在', await page.evaluate(() => window.xk.games.list().then((l) => l.some((g) => g.id === 'webtest-1'))));
  check('設定存在瀏覽器', await page.evaluate(() => window.__xkg.settings.profile && window.__xkg.settings.profile.avatar === 'm02'));
  // 教學、功能說明
  await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
  await page.click('#btnGuide');
  await waitFor(() => document.querySelectorAll('.gd-item').length >= 12);
  check('動畫教學 12 課', true);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'web-3-guide.png') });
  await page.click('#scr-guide .gd-head button');
  await page.click('#btnHelp');
  await waitFor(() => document.querySelectorAll('.help-card').length === 12);
  check('功能說明 12 張', true);
});

// ---------- 手機瀏覽器（iPhone 尺寸、觸控） ----------
await run('手機', {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
}, async ({ page, waitFor, clickPoint }) => {
  await page.goto(SITE + '/online/');
  await page.waitForSelector('#startAI', { timeout: 30000 });
  await page.evaluate(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'f04', advisor: 'af02' }, announce: false }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
  check('手機直立版面', await page.evaluate(() => document.documentElement.classList.contains('mobile')));
  await page.screenshot({ path: path.join(outDir, 'web-4-phone-home.png') });
  await page.evaluate(() => { document.querySelector('#startAI').parentElement.querySelector('button[data-v="9"]').click(); document.querySelector('#aiLevel').value = '0'; document.querySelector('#aiLevel').dispatchEvent(new Event('change')); });
  await page.tap('#startAI');
  await waitFor(() => window.__xkg.mode === 'ai' && /輪到您/.test(document.querySelector('#turnBanner').textContent) && !window.__xkg.animating);
  await page.waitForTimeout(3000);
  check('棋盤佔滿中間', await page.evaluate(() => document.querySelector('#boardWrap').getBoundingClientRect().height > innerHeight * 0.45));
  await clickPoint(40);
  await waitFor(() => window.__xkg.game.ply >= 1, null, 8000);
  check('手指點天元落子', await page.evaluate(() => window.__xkg.game.board.cells[40] === 1));
  await waitFor(() => window.__xkg.game.ply >= 2 && !window.__xkg.aiThinking && !window.__xkg.animating, null, 40000);
  check('AI 回應', true);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'web-5-phone-game.png') });
  await page.tap('.tab[data-tab="data"]');
  await page.waitForTimeout(600);
  check('數據抽屜', await page.evaluate(() => document.body.classList.contains('sheet-open')));
  await page.screenshot({ path: path.join(outDir, 'web-6-phone-data.png') });
});

await browser.close();
if (server) server.close();
console.log(`\n通過 ${pass}，失敗 ${fail}`);
process.exit(fail ? 1 : 0);
