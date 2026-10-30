// 用真實視窗（最大化、不模擬尺寸）截圖首頁、19 路對局、教學：node e2e/real-window.mjs
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(import.meta.url);
const app = await electron.launch({ executablePath: require('electron'), args: ['.', '--profile=e2eSmoke'] });
const win = await app.firstWindow();
await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.show(); w.maximize(); });
await win.waitForSelector('#startAI');
// Electron 擷取視窗實際畫面（playwright 截圖在縮放時會失真）
const capture = async (name) => { const b64 = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64')); fs.writeFileSync(`e2e/out/${name}.png`, Buffer.from(b64, 'base64')); };
await win.evaluate(async () => { window.__xkg.settings = await window.xk.settings.set({ music: { autoplay: false }, profile: { avatar: 'f05', advisor: 'af02' }, announce: false }); document.querySelectorAll('.modal-back').forEach((b) => b.remove()); });
await win.waitForTimeout(800);
const wb = await app.evaluate(({ BrowserWindow, screen }) => { const w = BrowserWindow.getAllWindows()[0]; return { content: w.getContentSize(), zoom: w.webContents.getZoomFactor(), scale: screen.getPrimaryDisplay().scaleFactor }; });
console.log(JSON.stringify(wb));
await capture('real-home');
await win.click('#startAI >> xpath=..//button[@data-v="19"]');
await win.selectOption('#aiLevel', '3');
await win.click('#startAI');
await win.waitForTimeout(4500);
for (const i of [72, 288, 60]) { await win.evaluate((i) => window.__xkgBoard.onPoint(i), i); await win.waitForFunction ? await win.waitForTimeout(6000) : null; }
const lay = await win.evaluate(() => { const r = document.querySelector('.right').getBoundingClientRect(); const l = document.querySelector('.left').getBoundingClientRect(); return { left: [Math.round(l.left), Math.round(l.right)], right: [Math.round(r.left), Math.round(r.right)], inner: [innerWidth, innerHeight] }; });
console.log('版面', JSON.stringify(lay));
await capture('real-game');
await win.click('#btnHome');
await win.click('.modal-btns button.primary').catch(() => {});
await win.click('#btnGuide');
await win.waitForTimeout(2500);
await capture('real-guide');
await app.close();
