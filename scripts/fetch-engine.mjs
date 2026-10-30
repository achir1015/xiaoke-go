// 下載 KataGo 引擎與神經網路權重到 engine/（GitHub Actions 打包前執行；本機已有檔案就跳過）
// KataGo：https://github.com/lightvector/KataGo（MIT 授權）；權重：https://katagotraining.org
// 用法：node scripts/fetch-engine.mjs
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = path.join(ROOT, 'engine');
const VER = 'v1.18.1';
const BIN = {
  win32: [['bin', `katago-${VER}-eigenavx2-windows-x64.zip`], ['bin-compat', `katago-${VER}-eigen-windows-x64.zip`]],
};
const MODELS = [
  ['fast.txt.gz', 'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b10c128-s1141046784-d204142634.txt.gz', 14_000_000],
  ['strong.bin.gz', 'https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b18c384nbt-s9996604416-d4316597426.bin.gz', 90_000_000],
];

async function download(url, file) {
  for (let i = 1; i <= 4; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'xiaoke-go-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (e) {
      console.log(`  第 ${i} 次下載失敗：${e.message}`);
      if (i === 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}

fs.mkdirSync(path.join(ENGINE, 'models'), { recursive: true });
if (process.platform === 'darwin') {
  // macOS 沒有官方執行檔：從原始碼編譯（arch 可用 KATAGO_ARCH=x86_64／arm64 指定，預設本機）
  const arch = process.env.KATAGO_ARCH || (process.arch === 'arm64' ? 'arm64' : 'x86_64');
  const have = fs.existsSync(path.join(ENGINE, 'bin', 'katago')) && execFileSync('file', [path.join(ENGINE, 'bin', 'katago')]).toString().includes(arch);
  if (have) console.log(`已存在 bin（${arch}）`);
  else { fs.rmSync(path.join(ENGINE, 'bin'), { recursive: true, force: true }); fs.rmSync(path.join(ENGINE, 'bin-compat'), { recursive: true, force: true }); execFileSync('bash', [path.join(ROOT, 'scripts', 'build-katago-mac.sh'), arch], { stdio: 'inherit' }); }
}
const list = BIN[process.platform] || [];
if (!list.length && process.platform !== 'darwin') { console.log(`這個平台（${process.platform}）沒有內建 KataGo，程式會使用小柯 JS 引擎。`); process.exit(0); }
for (const [dir, zip] of list) {
  const out = path.join(ENGINE, dir);
  if (fs.existsSync(path.join(out, 'katago.exe'))) { console.log(`已存在 ${dir}`); continue; }
  const tmp = path.join(os.tmpdir(), zip);
  console.log(`下載 ${zip}`);
  await download(`https://github.com/lightvector/KataGo/releases/download/${VER}/${zip}`, tmp);
  const x = path.join(os.tmpdir(), 'kg-' + dir);
  fs.rmSync(x, { recursive: true, force: true });
  fs.mkdirSync(x, { recursive: true });
  execFileSync('tar', ['-xf', tmp, '-C', x]);
  fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(x)) if (/\.(exe|dll|pem)$/i.test(f)) fs.copyFileSync(path.join(x, f), path.join(out, f));
}
for (const [name, url, min] of MODELS) {
  const f = path.join(ENGINE, 'models', name);
  if (fs.existsSync(f) && fs.statSync(f).size > min) { console.log(`已存在 ${name}`); continue; }
  console.log(`下載 ${name}`);
  await download(url, f);
}
console.log('KataGo 引擎就緒：', ENGINE);
