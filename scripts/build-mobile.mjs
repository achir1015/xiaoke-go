// 產生手機版（Android／iPhone／iPad）與線上版用的網頁：mobile/www
// 和桌面版同一份程式；把 node_modules 的函式庫複製到 vendor/、打包 Claude SDK、調整 index.html 路徑。
// 用法：node scripts/build-mobile.mjs
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'mobile', 'www');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const copy = (from, to) => fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });

// 1. 網頁本體
copy('src/renderer', '.');
fs.rmSync(path.join(OUT, 'package.json'), { force: true });
// 2. 素材（音樂）
copy('assets/music', 'assets/music');
copy('assets/portraits', 'assets/portraits');
fs.rmSync(path.join(OUT, 'assets/portraits/_sheet.html'), { force: true });
fs.copyFileSync(path.join(ROOT, 'build/icon.png'), path.join(OUT, 'assets/icon.png'));
// 3. 函式庫
fs.copyFileSync(path.join(ROOT, 'node_modules/three/build/three.module.js'), path.join(OUT, 'vendor/three.module.js'));
fs.copyFileSync(path.join(ROOT, 'node_modules/peerjs/dist/peerjs.min.js'), path.join(OUT, 'vendor/peerjs.min.js'));
await build({ entryPoints: [path.join(ROOT, 'mobile/anthropic-entry.mjs')], bundle: true, format: 'esm', platform: 'browser', minify: true, outfile: path.join(OUT, 'vendor/anthropic.js'), logLevel: 'warning' });
// 4. 版本號
fs.writeFileSync(path.join(OUT, 'js/version.js'), `window.XKG_VERSION = ${JSON.stringify(pkg.version)};\n`);
fs.writeFileSync(path.join(OUT, 'version.json'), JSON.stringify({ version: pkg.version }) + '\n'); // 線上版檢查更新用
// 線上版「加到主畫面」：圖示與 Web App 資訊（App 版用不到也無妨）
fs.writeFileSync(path.join(OUT, 'manifest.webmanifest'), JSON.stringify({
  name: '小柯機器人圍棋競賽', short_name: '小柯圍棋', start_url: './', scope: './', display: 'fullscreen', orientation: 'any',
  background_color: '#1b1410', theme_color: '#1b1410', lang: 'zh-Hant',
  icons: [{ src: 'assets/icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' }],
}, null, 1));
// 5. index.html：路徑改到 vendor/，重算 importmap 的 CSP 雜湊
let html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const sub = (a, b) => { if (!html.includes(a)) throw new Error('index.html 找不到：' + a); html = html.replace(a, b); };
sub('../../node_modules/three/build/three.module.js', './vendor/three.module.js');
sub('../../node_modules/peerjs/dist/peerjs.min.js', 'vendor/peerjs.min.js');
sub('<script src="js/xk-mobile.js"></script>', '<script src="js/version.js"></script>\n<script src="js/xk-mobile.js"></script>');
html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="assets/icon.png">\n<link rel="apple-touch-icon" href="assets/icon.png">\n<meta name="theme-color" content="#1b1410">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="小柯圍棋">');
const im = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
const hash = crypto.createHash('sha256').update(im, 'utf8').digest('base64');
html = html.replace(/'sha256-[^']*'/, `'sha256-${hash}'`);
fs.writeFileSync(path.join(OUT, 'index.html'), html);

let n = 0, bytes = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(OUT);
console.log(`手機版網頁 v${pkg.version}：${n} 個檔案、${(bytes / 1048576).toFixed(1)} MB → ${OUT}`);
