'use strict';
// KataGo 圍棋引擎（JSON 分析模式）：每行一個 JSON 請求／回應
// 快速網路（b10）負責對局與即時勝率；深度網路（b18）負責「大師」與深度分析，用到時才啟動
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const readline = require('readline');

const MODELS = {
  fast: { file: 'fast.txt.gz', label: 'KataGo b10' },
  strong: { file: 'strong.bin.gz', label: 'KataGo b18' },
};

function exeName() { return process.platform === 'win32' ? 'katago.exe' : 'katago'; }

class KataProc {
  constructor(home, kind, logDir) {
    this.home = home;
    this.kind = kind;
    this.logDir = logDir;
    this.proc = null;
    this.pending = new Map(); // id → { resolve, reject, onUpdate }
    this.ready = null;
    this.error = '';
    this.seq = 0;
    this.binDir = 'bin'; // 舊電腦（沒有 AVX2 指令）改用相容版 bin-compat
  }

  get bin() { return path.join(this.home, this.binDir, exeName()); }
  get model() { return path.join(this.home, 'models', MODELS[this.kind].file); }
  available() { return fs.existsSync(this.bin) && fs.existsSync(this.model); }

  config() {
    const cpus = (os.cpus() || []).length || 4;
    const per = this.kind === 'fast' ? Math.max(2, Math.min(12, Math.floor(cpus / 2))) : Math.max(2, Math.min(16, cpus));
    const cfg = [
      `logDir = ${this.logDir.replace(/\\/g, '/')}`,
      'logAllRequests = false',
      'logAllResponses = false',
      'logSearchInfo = false',
      'reportAnalysisWinratesAs = BLACK',
      'numAnalysisThreads = 2',
      `numSearchThreadsPerAnalysisThread = ${per}`,
      'nnMaxBatchSize = 16',
      'nnCacheSizePowerOfTwo = 20',
      'nnMutexPoolSizePowerOfTwo = 14',
      'nnRandomize = true',
      'maxVisits = 400',
      'analysisPVLen = 12',
      'ignorePreRootHistory = false',
    ].join('\n');
    const file = path.join(this.logDir, `analysis-${this.kind}.cfg`);
    fs.mkdirSync(this.logDir, { recursive: true });
    fs.writeFileSync(file, cfg, 'utf8');
    return file;
  }

  start() {
    if (this.ready) return this.ready;
    this.ready = this.spawnOnce().catch((e) => {
      const compat = path.join(this.home, 'bin-compat', exeName());
      if (this.binDir === 'bin' && fs.existsSync(compat)) { this.binDir = 'bin-compat'; this.ready = null; return this.start(); }
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  spawnOnce() {
    return new Promise((resolve, reject) => {
      if (!this.available()) { this.error = '找不到 KataGo 引擎檔案'; reject(new Error(this.error)); return; }
      let cfg;
      try { cfg = this.config(); } catch (e) { reject(e); return; }
      const p = spawn(this.bin, ['analysis', '-model', this.model, '-config', cfg], { cwd: path.dirname(this.bin), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.proc = p;
      let started = false, errText = '';
      const t = setTimeout(() => { if (!started) { started = true; resolve(); } }, 30000);
      // 引擎在 stderr 印出「Started, ready to begin handling requests」表示可以開始
      readline.createInterface({ input: p.stderr }).on('line', (line) => {
        errText = (errText + '\n' + line).slice(-2000);
        if (!started && /ready to begin handling requests/i.test(line)) { started = true; clearTimeout(t); resolve(); }
      });
      readline.createInterface({ input: p.stdout }).on('line', (line) => this.onLine(line));
      p.on('error', (e) => { this.error = String(e.message || e); if (!started) { started = true; clearTimeout(t); reject(e); } });
      p.on('exit', (code) => {
        const msg = `KataGo 已結束（代碼 ${code}）` + (errText ? '：' + errText.split('\n').filter(Boolean).slice(-2).join(' ') : '');
        this.error = msg;
        this.proc = null;
        if (started) this.ready = null;
        if (!started) { started = true; clearTimeout(t); reject(new Error(msg)); }
        for (const [, q] of this.pending) q.reject(new Error(msg));
        this.pending.clear();
      });
    });
  }

  onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    const q = this.pending.get(m.id);
    if (!q) return;
    if (m.error) { this.pending.delete(m.id); q.reject(new Error(m.error)); return; }
    if (m.isDuringSearch) { if (q.onUpdate) q.onUpdate(m); return; }
    // analyzeTurns：每一手各回一筆
    if (q.turns) {
      q.results.push(m);
      if (q.onUpdate) q.onUpdate(m);
      if (q.results.length >= q.turns) { this.pending.delete(m.id); q.resolve(q.results); }
      return;
    }
    if (m.noResults) { this.pending.delete(m.id); q.resolve(null); return; }
    this.pending.delete(m.id);
    q.resolve(m);
  }

  async query(req, onUpdate) {
    await this.start();
    const id = req.id || `${this.kind}-${++this.seq}`;
    const body = { ...req, id };
    return new Promise((resolve, reject) => {
      const turns = Array.isArray(req.analyzeTurns) ? req.analyzeTurns.length : 0;
      this.pending.set(id, { resolve, reject, onUpdate, turns, results: [] });
      try { this.proc.stdin.write(JSON.stringify(body) + '\n'); } catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  terminate(id) {
    const q = this.pending.get(id);
    if (!q || !this.proc) return;
    try { this.proc.stdin.write(JSON.stringify({ id: 'term-' + id, action: 'terminate', terminateId: id }) + '\n'); } catch {}
  }

  stop() {
    if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch {} }
    this.proc = null;
    this.ready = null;
  }
}

class Kata {
  constructor(home, logDir) {
    this.home = home;
    this.procs = { fast: new KataProc(home, 'fast', logDir), strong: new KataProc(home, 'strong', logDir) };
  }

  status() {
    return {
      available: this.procs.fast.available(),
      strong: this.procs.strong.available(),
      running: !!this.procs.fast.proc,
      error: this.procs.fast.error,
      labels: { fast: MODELS.fast.label, strong: MODELS.strong.label },
      home: this.home,
    };
  }

  // 只允許分析用欄位，避免任意設定
  sanitize(req) {
    const keep = ['id', 'moves', 'initialStones', 'initialPlayer', 'rules', 'komi', 'boardXSize', 'boardYSize', 'analyzeTurns', 'maxVisits', 'rootPolicyTemperature', 'rootFpuReductionMax', 'includeOwnership', 'includePolicy', 'includePVVisits', 'reportDuringSearchEvery', 'priority', 'avoidMoves', 'allowMoves', 'overrideSettings'];
    const out = {};
    for (const k of keep) if (k in req) out[k] = req[k];
    if (out.overrideSettings) {
      const ok = ['maxTime', 'wideRootNoise', 'playoutDoublingAdvantage', 'chosenMoveTemperature', 'rootNumSymmetriesToSample', 'humanSLProfile'];
      out.overrideSettings = Object.fromEntries(Object.entries(out.overrideSettings).filter(([k]) => ok.includes(k)));
    }
    out.maxVisits = Math.max(1, Math.min(100000, Number(out.maxVisits) || 100));
    return out;
  }

  async analyze(kind, req, onUpdate) {
    const p = this.procs[kind === 'strong' && this.procs.strong.available() ? 'strong' : 'fast'];
    return p.query(this.sanitize(req), onUpdate);
  }

  terminate(id) { for (const p of Object.values(this.procs)) p.terminate(id); }
  stopAll() { for (const p of Object.values(this.procs)) p.stop(); }
}

module.exports = { Kata, MODELS };
