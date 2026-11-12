// App Store 截圖：用 Chrome 開 mobile/www，模擬 App Store 版的 iPhone／iPad／Mac 外殼
// 用法：node scripts/build-mobile.mjs && node e2e/shots-store.mjs [輸出資料夾]
// 尺寸：iPhone 6.3 吋 1206×2622（直）、iPad 13 吋 2752×2064（橫）、Mac 2880×1800
import { chromium } from 'playwright-core';
import http from 'http';
import fs from 'fs';
import path from 'path';

const outRoot = process.argv[2] || 'e2e/out/store';
const WWW = path.resolve('mobile/www');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const PORT = 8857;
const server = http.createServer((req, res) => {
  const p = path.join(WWW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
  if (!p.startsWith(WWW) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(PORT);

const DEVICES = {
  iphone: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, shim: { store: true },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' },
  ipad: { viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 2, hasTouch: true, shim: { store: true },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
  mac: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, shim: { store: true, mac: true },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)' },
};
// 19 路布局：我執黑依序下這些點（被佔了就跳過），AI 執白回應
const OPENING = [72, 288, 300, 60, 186, 174, 66, 294, 180, 129, 243, 222];

const browser = await chromium.launch({ channel: 'chrome' });
let fail = 0;
for (const [name, dev] of Object.entries(DEVICES)) {
  const dir = path.join(outRoot, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const { shim, ...opts } = dev;
  const phone = name === 'iphone';
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((sh) => {
    window.XiaokeIOS = sh;
    window.webkit = { messageHandlers: { xkg: { postMessage: () => Promise.resolve({ status: 'ok' }) } } };
    // 截圖不念說明（無頭瀏覽器沒有語音）
    window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
    const fake = { name: 'Mei-Jia', lang: 'zh-TW', localService: true, default: true, voiceURI: 'Mei-Jia' };
    Object.defineProperty(speechSynthesis, 'getVoices', { value: () => [fake] });
    speechSynthesis.speak = (u) => { setTimeout(() => u.onend && u.onend(), 6000); };
    speechSynthesis.cancel = () => {};
  }, shim);
  const page = await ctx.newPage();
  const waitFor = async (fn, arg, ms = 60000) => {
    const t = Date.now();
    for (;;) {
      const v = await page.evaluate(fn, arg).catch(() => false);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(name + ' 等待逾時：' + fn);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  let n = 0;
  const shot = async (label) => { n++; await page.screenshot({ path: path.join(dir, `${String(n).padStart(2, '0')}-${label}.png`) }); };
  const myTurn = () => waitFor(() => /輪到您下棋/.test(document.querySelector('#turnBanner').textContent) && !window.__xkg.animating && !window.__xkg.aiThinking, null, 90000);
  const tab = (t) => page.evaluate((t) => {
    const el = document.querySelector(`.tab[data-tab="${t}"]`);
    if (document.body.classList.contains('is-mobile')) { document.body.classList.remove('sheet-open'); el.click(); if (!document.body.classList.contains('sheet-open')) el.click(); } else el.click();
  }, t);
  const home = async () => {
    await page.evaluate(() => { document.body.classList.remove('sheet-open'); document.querySelector('#btnHome').click(); });
    await page.waitForTimeout(500);
    await page.evaluate(() => { const b = document.querySelector('.modal-btns .primary'); if (b) b.click(); });
    await waitFor(() => document.querySelector('#scr-home').classList.contains('on'));
  };
  try {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.evaluate(async (phone) => {
      window.__xkg.settings = await window.xk.settings.set({ playerName: '小柯', music: { autoplay: false }, announce: false, view: phone ? 'top' : 'tilt', panelTab: 'data', profile: { avatar: 'm03', advisor: 'af07' } });
    }, phone);
    await page.reload();
    await page.waitForSelector('#startAI', { timeout: 30000 });
    await page.evaluate(() => document.querySelectorAll('.modal-back').forEach((b) => b.remove()));
    await page.waitForTimeout(1200);
    // 1. 首頁
    await shot('home');
    // 2. 19 路對 AI 中局（勝率、候選著法）
    await page.evaluate(() => {
      const card = document.querySelector('#startAI').parentElement;
      card.querySelector('button[data-v="19"]').click(); card.querySelector('button[data-v="black"]').click();
      const lv = document.querySelector('#aiLevel'); lv.value = '2'; lv.dispatchEvent(new Event('change'));
      document.querySelector('#startAI').click();
    });
    await myTurn();
    await page.waitForTimeout(2500);
    for (const i of OPENING) {
      const ok = await page.evaluate((i) => { const g = window.__xkg.game; if (!g.isLegal(i)) return false; window.__xkgBoard.onPoint(i); return true; }, i);
      if (ok) await myTurn();
    }
    await waitFor(() => window.__xkg.stats[window.__xkg.game.ply]);
    await page.waitForTimeout(2500);
    await shot('game');
    // 3. 數據（勝率曲線、候選著法）
    await tab('data');
    await page.waitForTimeout(800);
    await shot('data');
    // 4. 軍師
    await tab('advisor');
    await page.evaluate(() => document.querySelector('.adv-quick button').click());
    await waitFor(() => [...document.querySelectorAll('.adv-msg.ai')].some((e) => /建議下/.test(e.textContent)));
    await page.waitForTimeout(1200);
    await shot('advisor');
    // 5. 圍棋教學（提子）
    await home();
    await page.evaluate(() => document.querySelector('#btnGuide').click());
    await waitFor(() => document.querySelector('#scr-guide').classList.contains('on') && window.__guide);
    await page.evaluate(() => window.__guide.go(2));
    await page.waitForTimeout(7000);
    await shot('guide');
    // 6. AI 對 AI（13 路）
    await page.evaluate(() => document.querySelector('#scr-guide .gd-head button').click());
    await waitFor(() => document.querySelector('#scr-home').classList.contains('on'));
    await page.evaluate(() => {
      const card = document.querySelector('#startAivai').parentElement;
      card.querySelector('button[data-v="13"]').click();
      const f = card.querySelector('button[data-v="fast"]'); if (f) f.click();
      document.querySelector('#startAivai').click();
    });
    await waitFor(() => window.__xkg.mode === 'aivai' && window.__xkg.game.ply >= 36, null, 240000);
    await page.evaluate(() => document.querySelector('#btnPause') && document.querySelector('#btnPause').click());
    await waitFor(() => !window.__xkg.animating && !window.__xkg.aiThinking);
    await page.waitForTimeout(1500);
    await shot('aivai');
    console.log(`✔ ${name}：${n} 張 → ${dir}`);
  } catch (e) {
    fail++;
    console.log(`✘ ${name}：`, e.message);
    await page.screenshot({ path: path.join(dir, 'fail.png') }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
