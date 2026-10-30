// 小柯機器人圍棋競賽：主控流程（真人對 AI、真人對真人〔本機／遠端〕、AI 對 AI、棋譜重播）
import { $, $$, h, toast, modal, sleep, errMsg, fmtDate, uid } from './util.js';
import { Game, BLACK, WHITE, PASS, other, colorName, pointName, toGtp, fromGtp, resultText, recordToSgf, parseSgf, deadFromOwnership, fmtNum } from './go.js';
import { AIEngine, LEVELS, wrFor, leadFor } from './ai.js';
import { Book, buildBook } from './book.js';
import { Board3D } from './board3d.js';
import { GameLink, PROTOCOL } from './net.js';
import { MusicPlayer } from './music.js';
import { AdvisorPanel } from './advisor-ui.js';
import { sfx, setSfx, setSfxVolume, sfxVolume } from './sfx.js';
import { voice } from './voice.js';
import { loadPortraits, portraitUrl, labelOf, validProfile, randomProfile, pickProfile, pickAdvisor } from './portraits.js';
import { Guide } from './guide.js';
import { HelpCenter } from './help.js';

const CREDIT = '遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5';
const SPEEDS = [['fast', '快', 250], ['normal', '一般', 900], ['slow', '慢', 2000]];
const RULES = { chinese: { name: '中國規則（數子）', komi: 7.5 }, japanese: { name: '日韓規則（數目）', komi: 6.5 } };
const SIDE = { [BLACK]: '黑方', [WHITE]: '白方' };

const S = {
  settings: null, info: null, screen: 'home',
  mode: null,          // ai | local | net | aivai | replay | idle
  game: null,
  mySide: BLACK,       // 我執的顏色（本機對弈與觀戰為 null）
  names: { 1: '', 2: '' },
  players: { 1: null, 2: null },
  proxy: { 1: false, 2: false },
  levels: { 1: 2, 2: 2 }, // 各色由 AI 下時的難度
  aivaiDelay: 900,
  aiThinking: false, animating: false, paused: false,
  gameId: '', saved: false,
  clocks: { 1: 0, 2: 0 }, clockSide: BLACK, clockStart: 0,
  stats: [], lastA: null, lastAPly: -1, liveId: '', liveTimer: 0,
  showOwn: false, scoring: null, aiLow: { 1: 0, 2: 0 },
  link: null, netStarted: false, netStatus: '', oppName: '', oppProfile: null, hostCfg: null, curStart: null,
  replay: null, book: new Book(), mistakes: null,
};
window.__xkg = S; // 方便自動化測試

let board, music, advisor, ai, guide, help;
const newGameId = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + uid().slice(-6);
const pct = (x) => (x * 100).toFixed(1) + '%';
const isPlay = () => ['ai', 'local', 'net', 'aivai'].includes(S.mode);

// ---------------- 啟動 ----------------
async function init() {
  S.settings = await xk.settings.get();
  S.info = await xk.sys.info();
  setSfx(S.settings.sfx);
  voice.enabled = S.settings.announce !== false;
  ai = new AIEngine();
  await loadPortraits();
  board = new Board3D($('#board'), { onPoint, onHover });
  board.canPlace = (i) => !!S.game && S.game.isLegal(i);
  board.setView(S.settings.view || 'tilt');
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + (S.settings.view || 'tilt')[0].toUpperCase() + (S.settings.view || 'tilt').slice(1)));
  window.__xkgBoard = board;

  music = new MusicPlayer($('#musicPanel'), S.settings, (patch) => saveSettings(patch));
  await music.load();
  if (S.settings.music.autoplay && S.settings.music.enabled !== false) {
    const start = () => { music.play(); document.removeEventListener('pointerdown', start); };
    document.addEventListener('pointerdown', start);
  }
  music.renderState();
  initVolumeControls();
  tickDateTime();
  setInterval(tickDateTime, 1000);

  advisor = new AdvisorPanel($('#advisorPanel'), () => {
    const g = S.game;
    return {
      game: g,
      mySide: ['ai', 'net'].includes(S.mode) ? S.mySide : null,
      analyze: (game) => ai.analyze(game, { visits: 300, ownership: true }),
      showHint: (i) => showHint(i),
    };
  });
  advisor.onChange = () => changeAdvisor(advisorOwner());
  advisor.setHasKey(S.settings.advisor.hasKey);

  bindUI();
  buildDataPanel();
  renderHome();
  showScreen('home');
  if (!validProfile(S.settings.profile)) ensureProfile();
  setInterval(tickClock, 500);
  document.addEventListener('pointerdown', () => sfx.resume(), { once: true });
  ai.init().then(() => renderEngineStatus());
  rebuildBook();
  if (S.settings.autoUpdate !== false && S.info.packaged && !S.info.profile) setTimeout(() => checkUpdate(false), 6000);
}

async function saveSettings(patch) {
  S.settings = await xk.settings.set(patch);
  return S.settings;
}

async function rebuildBook() {
  try {
    const all = await xk.games.all();
    S.book = S.settings.learnFromGames !== false ? buildBook(all.filter((r) => r.result || r.source === 'import')) : new Book();
  } catch { S.book = new Book(); }
  renderLearnStat();
}

function renderLearnStat() {
  const t = `棋譜庫：已收錄 ${S.book.games} 局、${S.book.positions} 個布局局面（AI 下棋與數據分頁都會參考）`;
  $$('.learn-stat').forEach((el) => { el.textContent = t; });
}

// ---------------- 畫面切換 ----------------
function showScreen(name) {
  S.screen = name;
  $$('.screen').forEach((el) => el.classList.toggle('on', el.id === 'scr-' + name));
  if (name === 'game') setTimeout(() => board.resize(), 30);
  if (name === 'records') renderRecords();
}

function bindUI() {
  $('#btnHome').onclick = () => leaveGame();
  $('#viewTilt').onclick = () => setView('tilt');
  $('#viewTop').onclick = () => setView('top');
  $('#viewLow').onclick = () => setView('low');
  $('#btnPass').onclick = () => passMove();
  $('#btnUndo').onclick = () => requestUndo();
  $('#btnResign').onclick = () => resign();
  $('#btnHint').onclick = () => hint();
  $('#btnEstimate').onclick = () => toggleEstimate();
  $('#btnPause').onclick = () => togglePause();
  $('#btnProxy').onclick = () => toggleProxy();
  $('#btnNew').onclick = () => newGameSameMode();
  $('#btnExport').onclick = () => exportCurrent();
  $('#miniMusic').onclick = () => { selectTab('music'); music.toggle(); };
  $$('.tab').forEach((t) => { t.onclick = () => selectTab(t.dataset.tab); });
  $('#chatSend').onclick = () => sendChat();
  $('#chatInput').onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  $('#btnVoice').onclick = () => toggleVoice();
  $('#btnMute').onclick = () => toggleMute();
  $('#rpFirst').onclick = () => replayGo(0);
  $('#rpPrev').onclick = () => replayGo(S.replay.ply - 1);
  $('#rpNext').onclick = () => replayGo(S.replay.ply + 1);
  $('#rpLast').onclick = () => replayGo(S.replay.full.ply);
  $('#rpPlay').onclick = () => replayAuto();
  $('#rpNums').onclick = () => { S.replay.nums = !S.replay.nums; $('#rpNums').classList.toggle('on', S.replay.nums); replayGo(S.replay.ply); };
  $('#rpAnalyze').onclick = () => replayAnalyze();
  $('#rpExport').onclick = () => exportCurrent();
  $('#pBlack .padv-change').onclick = (e) => { e.stopPropagation(); changeAdvisor(BLACK); };
  $('#pWhite .padv-change').onclick = (e) => { e.stopPropagation(); changeAdvisor(WHITE); };
  document.addEventListener('keydown', (e) => {
    if (S.mode !== 'replay' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if (e.key === 'ArrowLeft') replayGo(S.replay.ply - 1);
    if (e.key === 'ArrowRight') replayGo(S.replay.ply + 1);
  });
}

function selectTab(name) {
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.tabpane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
  if (name === 'chat') $('.tab[data-tab="chat"]').classList.remove('ping');
  if (name === 'data') drawGraph();
}

function setView(v) {
  board.setView(v);
  $$('.viewbtn').forEach((b) => b.classList.toggle('on', b.id === 'view' + v[0].toUpperCase() + v.slice(1)));
  saveSettings({ view: v });
}

// ---------------- 首頁 ----------------
function seg(options, value, onPick) {
  const el = h('div', { class: 'seg' }, ...options.map(([v, l]) => h('button', { class: 'segbtn' + (String(v) === String(value) ? ' on' : ''), 'data-v': v, onclick: () => { $$('.segbtn', el).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v))); el.dataset.v = v; onPick && onPick(v); } }, l)));
  el.dataset.v = value;
  return el;
}
const sizeSeg = (v) => seg([[9, '9 路'], [13, '13 路'], [19, '19 路']], v);
const ruleSel = (v) => h('select', { class: 'lv' }, Object.entries(RULES).map(([k, r]) => h('option', { value: k, selected: k === v }, `${r.name}，貼 ${r.komi}`)));
const levelSel = (v, id) => h('select', { class: 'lv', id }, LEVELS.map((l, i) => h('option', { value: i, selected: i === v }, `${l.name}　${l.desc}`)));

function renderHome() {
  const home = $('#homeBody');
  home.innerHTML = '';
  const gs = S.settings.game;
  const nameInput = h('input', { class: 'name-in', value: S.settings.playerName, maxLength: 16, onchange: (e) => saveSettings({ playerName: e.target.value.trim() || '棋友' }) });

  // A：真人對 AI
  const aSize = sizeSeg(gs.size), aRule = ruleSel(gs.rules), aLv = levelSel(gs.level, 'aiLevel');
  const aColor = seg([['black', '我執黑（先下）'], ['white', '我執白'], ['random', '隨機']], gs.color);
  const aHcap = h('select', { class: 'lv', id: 'aiHcap' }, [0, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => h('option', { value: k, selected: k === (gs.handicap || 0) }, k ? `讓 ${k} 子（黑棋先擺，貼 0.5）` : '不讓子（分先）')));
  const cardAI = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🤖'),
    h('h2', {}, 'A　真人對 AI'),
    h('p', { class: 'muted' }, '和小柯 AI 對弈，難度從入門到職業級。AI 會參考棋譜庫的布局越下越聰明。'),
    h('label', {}, '棋盤：'), aSize,
    h('label', {}, '我方：'), aColor,
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '規則：'), aRule), h('div', {}, h('label', {}, '讓子：'), aHcap)),
    h('label', {}, 'AI 難度：'), aLv,
    h('button', { class: 'primary big', id: 'startAI', onclick: () => {
      const cfg = { size: Number(aSize.dataset.v), rules: aRule.value, color: aColor.dataset.v, level: Number(aLv.value), handicap: Number(aHcap.value) };
      saveSettings({ game: cfg });
      startAIGame(cfg);
    } }, '開始對局'));

  // B：真人對真人
  const bSize = sizeSeg(gs.size), bRule = ruleSel(gs.rules);
  const hostSide = h('select', { class: 'lv', id: 'hostSide' }, [['random', '隨機分配黑白'], ['black', '我執黑（先下）'], ['white', '我執白']].map(([v, l]) => h('option', { value: v }, l)));
  const codeIn = h('input', { class: 'code-in', id: 'joinCode', placeholder: '輸入 6 位數房號', maxLength: 7, inputMode: 'numeric' });
  const cardNet = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🌐'),
    h('h2', {}, 'B　真人對真人'),
    h('p', { class: 'muted' }, '邀約遠端棋友連線對弈（可語音聊天），或兩人在同一台電腦輪流下。雙方都有 AI 軍師陪同。'),
    h('div', { class: 'two-col' }, h('div', {}, h('label', {}, '棋盤：'), bSize), h('div', {}, h('label', {}, '規則：'), bRule)),
    h('div', { class: 'net-row' }, hostSide, h('button', { class: 'primary', id: 'btnHost', onclick: () => hostRoom({ size: Number(bSize.dataset.v), rules: bRule.value, side: hostSide.value }) }, '建立房間')),
    h('div', { class: 'net-or' }, '或'),
    h('div', { class: 'net-row' }, codeIn, h('button', { class: 'primary', id: 'btnJoin', onclick: () => joinRoom(codeIn.value) }, '加入房間')),
    h('button', { id: 'btnLocal', onclick: () => startLocalGame({ size: Number(bSize.dataset.v), rules: bRule.value }) }, '👥 同一台電腦兩人對弈'),
    h('div', { id: 'netWait', class: 'net-wait hidden' }));

  // C：AI 對 AI
  const av = S.settings.aivai || {};
  const cSize = sizeSeg(av.size || 19);
  const lvB = levelSel(av.levels ? av.levels[0] : 3, 'aivaiB'), lvW = levelSel(av.levels ? av.levels[1] : 3, 'aivaiW');
  const speedSel = seg(SPEEDS.map(([v, l]) => [v, l]), av.speed || 'normal');
  const cardAivai = h('div', { class: 'card mode-card' },
    h('div', { class: 'card-icon' }, '🎬'),
    h('h2', {}, 'C　AI 對 AI'),
    h('p', { class: 'muted' }, '坐下來觀戰，看兩位 AI 怎麼下，勝率曲線即時更新。可以暫停、請軍師講解，棋譜也會收錄。'),
    h('label', {}, '棋盤：'), cSize,
    h('label', {}, '黑方 AI：'), lvB,
    h('label', {}, '白方 AI：'), lvW,
    h('label', {}, '每手速度：'), speedSel,
    h('button', { class: 'primary big', id: 'startAivai', onclick: () => {
      const cfg = { size: Number(cSize.dataset.v), levels: [Number(lvB.value), Number(lvW.value)], speed: speedSel.dataset.v };
      saveSettings({ aivai: cfg });
      startAIvAI(cfg);
    } }, '開始觀戰'));

  home.append(
    h('div', { class: 'home-hero' },
      h('img', { class: 'hero-icon', src: '../../build/icon.png', alt: '' }),
      h('div', {}, h('h1', {}, '小柯機器人圍棋競賽'), h('p', { class: 'muted' }, '3D 圍棋．KataGo 即時勝率．AI 軍師陪你下'), h('p', { id: 'engineStatus', class: 'engine-status small' })),
      myProfileCard(),
      h('div', { class: 'hero-name' }, h('label', {}, '我的暱稱'), nameInput)),
    h('div', { class: 'mode-grid' }, cardAI, cardNet, cardAivai),
    h('div', { class: 'home-links' },
      h('button', { onclick: () => showScreen('records') }, '📜 棋譜庫'),
      h('button', { id: 'btnGuide', class: 'guide-btn', onclick: () => openGuide() }, '📖 圍棋教學'),
      h('button', { id: 'btnHelp', class: 'guide-btn', onclick: () => openHelp() }, '🔊 功能說明'),
      h('button', { onclick: () => openSettings() }, '⚙ 設定'),
      h('button', { onclick: () => { selectTab('music'); enterIdleBoard(); showScreen('game'); } }, '♫ 背景音樂'),
      h('button', { id: 'btnAbout', onclick: () => openAbout() }, 'ℹ 關於與更新')),
    h('p', { class: 'learn-stat small muted' }),
    h('div', { class: 'credit muted small' }, `v${S.info.version}　${CREDIT}`),
  );
  renderLearnStat();
  renderEngineStatus();
}

function renderEngineStatus() {
  const el = $('#engineStatus');
  if (!el || !ai) return;
  const st = ai.status || {};
  if (ai.useKata) el.textContent = `🟢 AI 引擎：KataGo（快速網路${st.strong ? '＋深度網路' : ''}）已就緒`;
  else el.textContent = `🟡 AI 引擎：小柯 JS 引擎${st.error ? `（KataGo 無法使用：${st.error}）` : ''}`;
}

function myProfileCard() {
  const pr = S.settings.profile;
  if (!validProfile(pr)) return h('button', { class: 'my-profile empty', id: 'btnProfile', onclick: () => ensureProfile(true) }, '選擇半身照與 AI 軍師');
  return h('button', { class: 'my-profile', id: 'btnProfile', title: '更換半身照與 AI 軍師', onclick: () => ensureProfile(true) },
    h('img', { class: 'mp-main', src: portraitUrl(pr.avatar) }),
    h('div', { class: 'mp-text' }, h('b', {}, labelOf(pr.avatar)), h('span', {}, '陪同參賽的 AI 軍師'),
      h('div', { class: 'mp-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, labelOf(pr.advisor)))),
    h('span', { class: 'mp-change' }, '更換'));
}

async function ensureProfile(force = false) {
  const cur = S.settings.profile;
  if (!force && validProfile(cur)) return true;
  const r = await pickProfile(cur, { required: !validProfile(cur) });
  if (r) { await saveSettings({ profile: r }); renderHome(); return true; }
  return validProfile(S.settings.profile);
}
const myProfile = () => S.settings.profile;

// ---------------- 日期時間、音量 ----------------
function tickDateTime() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const el = $('#clock');
  if (el) el.textContent = `西元 ${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日（星期${'日一二三四五六'[d.getDay()]}）${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function initVolumeControls() {
  const sv = $('#sfxVol'), svv = $('#sfxVolVal');
  let lastSfx = S.settings.sfxVolume > 0 ? S.settings.sfxVolume : 0.8;
  const applySfx = (v, save = true) => {
    setSfxVolume(v);
    sv.value = Math.round(v * 100);
    svv.textContent = Math.round(v * 100);
    $('#btnSfx').textContent = v > 0 ? '🔔 落子' : '🔕 落子';
    if (v > 0) lastSfx = v;
    if (save) { clearTimeout(applySfx.t); applySfx.t = setTimeout(() => saveSettings({ sfxVolume: v }), 400); }
  };
  applySfx(S.settings.sfxVolume ?? 0.8, false);
  let lastPreview = 0;
  sv.oninput = () => {
    applySfx(sv.value / 100);
    if (Date.now() - lastPreview > 180) { lastPreview = Date.now(); sfx.resume(); sfx.move(); }
  };
  const muteToggle = () => { applySfx(sfxVolume() > 0 ? 0 : lastSfx); if (sfxVolume() > 0) { sfx.resume(); sfx.move(); } };
  $('#btnSfx').onclick = muteToggle;
  $('#btnSfx').addEventListener('mute', muteToggle);
  const mv = $('#musicVol'), mvv = $('#musicVolVal');
  const showMusic = (v) => { mv.value = Math.round(v * 100); mvv.textContent = Math.round(v * 100); };
  showMusic(music.cfg.volume);
  music.onVolume = showMusic;
  mv.oninput = () => music.setVolume(mv.value / 100);
}

// ---------------- 數據分頁 ----------------
function buildDataPanel() {
  const p = $('#dataPanel');
  p.innerHTML = '';
  p.append(
    h('div', { class: 'dp-bar' },
      h('div', { class: 'dp-side b' }, h('span', { class: 'stone-dot b' }), h('b', { id: 'dpWrB' }, '50.0%')),
      h('div', { class: 'dp-track' }, h('div', { class: 'dp-fill', id: 'dpFill' })),
      h('div', { class: 'dp-side w' }, h('b', { id: 'dpWrW' }, '50.0%'), h('span', { class: 'stone-dot w' }))),
    h('div', { class: 'dp-lead', id: 'dpLead' }, '—'),
    h('div', { class: 'dp-engine muted small', id: 'dpEngine' }, ''),
    h('div', { class: 'dp-graph-wrap' }, h('canvas', { id: 'dpGraph', class: 'dp-graph', width: 600, height: 220, onclick: (e) => graphClick(e) }), h('div', { class: 'dp-legend small muted' }, '— 黑方勝率　┅ 目差　（點曲線可跳到那一手，限重播）')),
    h('div', { class: 'dp-toggles' },
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'dpCands', checked: S.settings.game.hints !== false, onchange: (e) => { saveSettings({ game: { hints: e.target.checked } }); renderOverlay(); } }), ' 棋盤顯示建議點'),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', id: 'dpOwn', onchange: (e) => { S.showOwn = e.target.checked; renderOverlay(); } }), ' 形勢判斷')),
    h('div', { class: 'dp-title' }, '候選著法'),
    h('div', { class: 'dp-table-wrap' }, h('table', { class: 'dp-table', id: 'dpTable' })),
    h('div', { class: 'dp-title' }, '棋譜庫參考'),
    h('div', { class: 'dp-book small', id: 'dpBook' }, '—'),
    h('div', { class: 'dp-mistakes', id: 'dpMistakes' }),
  );
}

function renderData() {
  const g = S.game;
  if (!g) return;
  const a = S.lastAPly === g.ply ? S.lastA : null;
  const st = S.stats[g.ply] || (a ? { wr: a.winrate, lead: a.scoreLead } : null);
  const wr = st ? st.wr : 0.5, ld = st ? st.lead : 0;
  $('#dpWrB').textContent = st ? pct(wr) : '—';
  $('#dpWrW').textContent = st ? pct(1 - wr) : '—';
  $('#dpFill').style.width = (wr * 100).toFixed(1) + '%';
  $('#dpLead').textContent = st ? (Math.abs(ld) < 0.05 ? '雙方均勢' : `${ld > 0 ? '黑' : '白'}方領先 ${Math.abs(ld).toFixed(1)} 目`) : '計算中…';
  $('#dpEngine').textContent = a ? `${a.engine}．計算量 ${a.visits}．第 ${g.ply} 手後，輪到${colorName(g.turn)}` : (ai ? `${ai.name} 計算中…` : '');
  // 左側小勝率條
  const mini = $('#wrMini');
  mini.querySelector('.wr-b').style.width = (wr * 100).toFixed(1) + '%';
  mini.querySelector('.wr-bt').textContent = `黑 ${st ? pct(wr) : '—'}`;
  mini.querySelector('.wr-wt').textContent = `白 ${st ? pct(1 - wr) : '—'}`;
  mini.querySelector('.wr-lead').textContent = st ? (Math.abs(ld) < 0.05 ? '均勢' : `${ld > 0 ? '黑' : '白'} +${Math.abs(ld).toFixed(1)} 目`) : '';
  mini.classList.toggle('hidden', S.mode === 'idle');
  // 候選表
  const tb = $('#dpTable');
  tb.innerHTML = '';
  tb.append(h('tr', {}, ...['序', '著點', `勝率（${colorName(g.turn)}）`, '計算量', '目差'].map((t) => h('th', {}, t))));
  if (a && !g.result) {
    a.moves.slice(0, 10).forEach((m, k) => tb.append(h('tr', { class: k === 0 ? 'best' : '', onclick: () => { if (m.i >= 0) showHint(m.i); } },
      h('td', {}, String(k + 1)), h('td', {}, pointName(m.i, g.size)), h('td', {}, pct(wrFor(m.winrate, g.turn))),
      h('td', {}, m.visits >= 1000 ? (m.visits / 1000).toFixed(1) + 'k' : String(m.visits)), h('td', {}, leadFor(m.scoreLead, g.turn).toFixed(1)))));
  }
  // 棋譜庫
  const hits = S.book.lookup(g).slice(0, 4);
  $('#dpBook').textContent = !S.book.games ? '棋譜庫還是空的，下完的對局與匯入的 SGF 都會收錄。' : hits.length
    ? `這個局面在棋譜庫出現 ${hits.reduce((x, y) => x + y.n, 0)} 次，常見下法：` + hits.map((x) => `${pointName(x.i, g.size)}（${x.n} 次${x.rate != null ? `，勝率 ${Math.round(x.rate * 100)}%` : ''}）`).join('、')
    : `棋譜庫（${S.book.games} 局）裡沒有這個局面。`;
  drawGraph();
  renderOverlay();
}

function renderOverlay() {
  const g = S.game;
  if (!g || S.scoring) return;
  const a = S.lastAPly === g.ply ? S.lastA : null;
  const showC = $('#dpCands') && $('#dpCands').checked && a && !g.result && (S.mode !== 'net' || g.turn === S.mySide) && !S.animating;
  board.setCandidates(showC ? a.moves.filter((m) => m.i >= 0).slice(0, 8).map((m) => ({ i: m.i, wrMe: wrFor(m.winrate, g.turn), visits: m.visits })) : null);
  board.setOwnership(S.showOwn && a && a.ownership ? a.ownership : null);
  $('#btnEstimate').classList.toggle('on', S.showOwn);
  if ($('#dpOwn')) $('#dpOwn').checked = S.showOwn;
}

function drawGraph() {
  const cv = $('#dpGraph');
  if (!cv || !S.game) return;
  const w = cv.clientWidth || 300, hgt = cv.clientHeight || 120;
  const dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, hgt);
  const total = S.mode === 'replay' ? S.replay.full.ply : S.game.ply;
  const N = Math.max(10, total);
  const X = (k) => 6 + (k / N) * (w - 12);
  const Y = (v) => 6 + (1 - v) * (hgt - 12);
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, 0, w, hgt / 2);
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(0, Y(0.5)); g.lineTo(w, Y(0.5)); g.stroke();
  g.setLineDash([]);
  const stats = S.stats;
  // 目差（虛線，±30 目為上下限）
  g.strokeStyle = 'rgba(232,184,74,0.75)'; g.setLineDash([3, 3]); g.lineWidth = 1.4;
  g.beginPath();
  let started = false;
  for (let k = 0; k <= total; k++) { const s = stats[k]; if (!s) continue; const y = Y(0.5 + Math.max(-1, Math.min(1, s.lead / 30)) / 2); if (!started) { g.moveTo(X(k), y); started = true; } else g.lineTo(X(k), y); }
  g.stroke(); g.setLineDash([]);
  // 勝率
  g.strokeStyle = '#7ee0ff'; g.lineWidth = 2.2;
  g.beginPath(); started = false;
  for (let k = 0; k <= total; k++) { const s = stats[k]; if (!s) continue; if (!started) { g.moveTo(X(k), Y(s.wr)); started = true; } else g.lineTo(X(k), Y(s.wr)); }
  g.stroke();
  // 目前手數
  const cur = S.game.ply;
  g.strokeStyle = 'rgba(255,90,90,0.9)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(X(cur), 0); g.lineTo(X(cur), hgt); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.font = '11px sans-serif';
  g.fillText('黑勝', 8, 16); g.fillText('白勝', 8, hgt - 8);
  g.textAlign = 'right'; g.fillText(`${total} 手`, w - 6, hgt - 8); g.textAlign = 'left';
}

function graphClick(e) {
  if (S.mode !== 'replay') return;
  const cv = $('#dpGraph');
  const r = cv.getBoundingClientRect();
  const N = Math.max(10, S.replay.full.ply);
  replayGo(Math.round(((e.clientX - r.left - 6) / (r.width - 12)) * N));
}

// 每一手之後在背景分析（勝率、目差、候選、形勢）
function scheduleLive(delay = 60) {
  clearTimeout(S.liveTimer);
  S.liveTimer = setTimeout(runLive, delay);
}
async function runLive() {
  const g = S.game;
  if (!g || !ai || S.mode === 'idle' || g.result || S.scoring) { if (g) renderData(); return; }
  if (!ai.useKata && S.aiThinking) return; // JS 引擎一次只算一件事
  if (S.liveId) ai.cancel(S.liveId);
  const id = 'live-' + uid();
  S.liveId = id;
  const ply = g.ply;
  const done = (a, final) => {
    if (S.game !== g || g.ply !== ply || !a) return;
    S.lastA = a; S.lastAPly = ply;
    if (final || a.visits >= 20) S.stats[ply] = { wr: a.winrate, lead: a.scoreLead };
    renderData();
  };
  try {
    const a = await ai.analyze(g, { visits: S.mode === 'replay' ? 200 : 160, ownership: true, id, onUpdate: (u) => done(u, false), playouts: 1800, timeMs: 700 });
    done(a, true);
  } catch (e) { console.warn('live', e); }
  if (S.liveId === id) S.liveId = '';
}

// ---------------- 對局共用 ----------------
function enterIdleBoard() {
  if (S.mode && S.mode !== 'idle') return;
  S.mode = 'idle';
  S.game = new Game({ size: 19 });
  S.names = { 1: '黑方', 2: '白方' };
  S.players = { 1: null, 2: null };
  board.setSize(19);
  board.setPosition(S.game.board.cells);
  board.setPrisoners({ 1: 0, 2: 0 });
  board.setLastMove(-1); board.setHint(-1); board.clearOverlay();
  board.setInteractive(false);
  updateGameUI();
}

function komiOf(rules, handicap) { return handicap >= 2 ? 0.5 : RULES[rules] ? RULES[rules].komi : 7.5; }

// opts: { size, rules, handicap, komi, names, players, mySide, levels }
function setupGame(mode, opts) {
  S.mode = mode;
  S.game = new Game({ size: opts.size, rules: opts.rules, handicap: opts.handicap || 0, komi: opts.komi ?? komiOf(opts.rules, opts.handicap || 0), setup: opts.setup, first: opts.first });
  S.mySide = opts.mySide ?? null;
  S.names = opts.names;
  S.players = opts.players || { 1: randomProfile(), 2: randomProfile() };
  S.proxy = { 1: false, 2: false };
  S.levels = opts.levels || S.levels;
  S.aiThinking = false; S.animating = false; S.paused = false; S.saved = false;
  S.stats = []; S.lastA = null; S.lastAPly = -1; S.showOwn = false; S.scoring = null; S.aiLow = { 1: 0, 2: 0 }; S.mistakes = null;
  S.gameId = newGameId();
  S.clocks = { 1: 0, 2: 0 }; S.clockSide = S.game.turn; S.clockStart = Date.now();
  board.setSize(S.game.size);
  board.setMySide(S.mySide || BLACK);
  board.setPosition(S.game.board.cells);
  board.lidCounts = { 1: 0, 2: 0 };
  board.setPrisoners({ 1: 0, 2: 0 });
  board.setLastMove(-1); board.setHint(-1); board.setDead(null); board.setNumbers(null); board.clearOverlay();
  advisor.reset();
  for (const m of ['net', 'ai', 'aivai', 'replay', 'local']) document.body.classList.toggle('mode-' + m, mode === m);
  $('#chatLog').innerHTML = '';
  $('#aiInfo').textContent = '';
  $('#scorePanel').classList.add('hidden');
  $('#dpMistakes').innerHTML = '';
  showScreen('game');
  selectTab(mode === 'net' ? 'chat' : 'data');
  updateAdvisorHead();
  updateGameUI();
  renderData();
  if (mode !== 'replay') { showVersus(); scheduleLive(400); }
}

// 軍師面板顯示的是哪一方的軍師
function advisorOwner() {
  if (['ai', 'net'].includes(S.mode)) return S.mySide;
  return S.game ? S.game.turn : BLACK;
}
function updateAdvisorHead() {
  const pr = S.players[advisorOwner()];
  advisor.setAdvisor(pr ? labelOf(pr.advisor) : '小柯軍師', pr ? portraitUrl(pr.advisor) : '');
}

function showVersus() {
  const side = (c) => {
    const pr = S.players[c];
    if (!pr) return h('div');
    return h('div', { class: 'vs-side ' + (c === BLACK ? 'b' : 'w') },
      h('img', { class: 'vs-main', src: portraitUrl(pr.avatar) }),
      h('div', { class: 'vs-name' }, S.names[c] || ''),
      h('div', { class: 'vs-tag' }, `${c === BLACK ? '⚫ 執黑' : '⚪ 執白'}．${labelOf(pr.avatar)}`),
      h('div', { class: 'vs-adv' }, h('img', { src: portraitUrl(pr.advisor) }), h('span', {}, `軍師：${labelOf(pr.advisor)}`)));
  };
  const g = S.game;
  const el = h('div', { class: 'versus', onclick: () => el.remove() }, side(BLACK), h('div', { class: 'vs-mid' }, 'VS', h('div', { class: 'vs-cfg' }, `${g.size} 路．${RULES[g.rules].name.slice(0, 4)}．貼 ${fmtNum(g.komi)}${g.handicap ? `．讓 ${g.handicap} 子` : ''}`)), side(WHITE));
  $('#boardWrap').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3200);
}

// 輪到的一方是否由真人（本機）下
function humanTurn() {
  const g = S.game;
  if (!g || g.result || S.scoring) return false;
  const c = g.turn;
  if (S.proxy[c]) return false;
  if (S.mode === 'ai') return c === S.mySide;
  if (S.mode === 'local') return true;
  if (S.mode === 'net') return c === S.mySide && !!(S.link && S.link.connected) && S.netStarted;
  return false;
}
function canMove() { return humanTurn() && !S.animating && !S.aiThinking; }

function onHover(i) {
  const el = $('#hoverInfo');
  if (!el) return;
  if (i < 0 || !S.game) { el.textContent = ''; return; }
  el.textContent = pointName(i, S.game.size);
}

function onPoint(i) {
  const g = S.game;
  if (!g) return;
  if (S.scoring) { toggleDead(i); return; }
  if (!isPlay()) return;
  if (!canMove()) {
    if (g.result) return;
    if (S.proxy[g.turn] && (S.mode !== 'net' || g.turn === S.mySide)) toast('目前由 AI 軍師代打，按「交還主位」就能自己下', 'info', 2500);
    else if (S.mode !== 'aivai') { flashBanner(); sfx.illegal(); }
    return;
  }
  const why = g.whyIllegal(i);
  if (why) { sfx.illegal(); showWhy(why); return; }
  localMove(i);
}

function showWhy(text) {
  $$('.toast.why').forEach((t) => t.remove());
  toast('✕ ' + text, 'why', 3200);
}

async function localMove(i) {
  if (S.mode === 'net') S.link.send({ t: 'move', ply: S.game.ply, mv: toGtp(i, S.game.size) });
  await applyMove(i);
}

function passMove() {
  if (!canMove()) return;
  localMove(PASS);
}

async function applyMove(i) {
  const g = S.game;
  board.setHint(-1);
  const mover = g.turn;
  S.clocks[mover] += Date.now() - S.clockStart;
  S.clockStart = Date.now();
  const res = g.play(i);
  if (!res.ok) { showWhy(res.why); return; }
  S.clockSide = g.turn;
  S.animating = true;
  board.setCandidates(null);
  board.lidCounts = { ...g.captures };
  updateGameUI();
  const ply = g.ply;
  if (res.pass) {
    sfx.pass();
    popText(`${colorName(mover)}棋停一手`, mover === BLACK ? 'black' : 'white');
    say(`${colorName(mover)}棋停一手`);
  } else {
    await board.placeStone(i, mover, res.captured);
    if (res.captured.length) sfx.capture(res.captured.length); else sfx.move();
  }
  S.animating = false;
  if (S.game !== g || g.ply !== ply) { updateGameUI(); return; }
  board.setLastMove(res.pass ? -1 : i);
  if (!res.pass) {
    if (res.captured.length) { popText(`提 ${res.captured.length} 子`, 'cap'); say(res.ko ? `提${res.captured.length}子，打劫` : `提${res.captured.length}子`); }
    else if (res.atari) { sfx.atari(); popText('叫吃！', 'atari'); say('叫吃'); }
    if (res.ko && !res.captured.length) say('打劫');
  }
  updateGameUI();
  scheduleLive();
  if (res.bothPassed) { await startScoring(); return; }
  if (g.ply > g.size * g.size * 3) { toast('手數太多，自動進入終局', 'info'); await startScoring(); return; }
  if (S.mode === 'net' && g.turn === S.mySide && !S.proxy[S.mySide]) { sfx.turn(); xk.win.attention('輪到您下棋', `對方：${pointName(i, g.size)}`); }
  maybeAutoMove();
}

function say(text) { if (S.settings.announce !== false && isPlay()) voice.call(text); }

// ---------------- 畫面更新 ----------------
function updateGameUI() {
  const g = S.game;
  if (!g) return;
  for (const c of [BLACK, WHITE]) {
    const card = $(c === BLACK ? '#pBlack' : '#pWhite');
    card.querySelector('.pname').textContent = S.names[c] || SIDE[c];
    card.querySelector('.ptag').textContent = (S.mode === 'ai' || S.mode === 'net') && c === S.mySide ? '（我）' : '';
    const pr = S.players[c];
    const proxied = !!S.proxy[c];
    card.classList.toggle('proxy', proxied);
    const img = card.querySelector('.pimg');
    const want = pr ? portraitUrl(proxied ? pr.advisor : pr.avatar) : '';
    if (img.getAttribute('src') !== want) img.setAttribute('src', want);
    img.classList.toggle('hidden', !pr);
    const advImg = card.querySelector('.padvimg');
    const advWant = pr ? portraitUrl(proxied ? pr.avatar : pr.advisor) : '';
    if (advImg.getAttribute('src') !== advWant) advImg.setAttribute('src', advWant);
    card.querySelector('.padv').classList.toggle('hidden', !pr);
    card.querySelector('.padvname').textContent = pr ? (proxied ? `主位暫離：${labelOf(pr.avatar)}` : `軍師 ${labelOf(pr.advisor)}`) : '';
    const canChange = pr && (S.mode === 'local' || ((S.mode === 'ai' || S.mode === 'net') && c === S.mySide));
    card.querySelector('.padv-change').classList.toggle('hidden', !canChange);
    card.classList.toggle('active', !g.result && !S.scoring && g.turn === c && isPlay());
    card.querySelector('.pcaps').textContent = `提 ${g.captures[c]}`;
  }
  renderMoves();
  const rules = RULES[g.rules] ? RULES[g.rules].name.slice(0, 4) : '';
  $('#gameInfo').textContent = S.mode === 'idle' ? '' : `${g.size} 路．${rules}．貼 ${fmtNum(g.komi)}${g.handicap ? `．讓 ${g.handicap}` : ''}`;
  // 輪次提示
  const banner = $('#turnBanner');
  let text = '', cls = '';
  const c = g.turn;
  if (S.mode === 'replay') { text = `棋譜重播　第 ${g.ply} / ${S.replay.full.ply} 手`; cls = 'replay'; }
  else if (S.mode === 'idle') { text = '請回首頁選擇參賽方式'; cls = 'watch'; }
  else if (g.result) { text = resultText(g.result); cls = 'over'; }
  else if (S.scoring) { text = '終局：點棋子可以切換死活，確認後計算勝負'; cls = 'over'; }
  else if (S.mode === 'aivai') { text = S.paused ? `AI 對 AI．已暫停（輪到${colorName(c)}）` : `AI 對 AI．${colorName(c)}方（${LEVELS[S.levels[c]].name}）思考中…`; cls = 'watch'; }
  else if (S.mode === 'net' && !(S.link && S.link.connected)) { text = S.netStatus || '等待對手連線…'; cls = 'watch'; }
  else if (S.mode === 'net' && !S.netStarted) { text = '對手已連線，準備開局…'; cls = 'watch'; }
  else if (S.proxy[c] && (S.mode !== 'net' || c === S.mySide)) { text = `${labelOf(S.players[c]?.advisor)}代打中（${colorName(c)}）`; cls = 'proxy'; }
  else if (S.mode === 'local') { text = `輪到${colorName(c)}方（${S.names[c]}）下棋`; cls = 'mine'; }
  else if (c === S.mySide) { text = `輪到您下棋（${colorName(c)}）`; cls = 'mine'; }
  else if (S.mode === 'net' && S.proxy[c]) { text = '換您觀棋（對方由 AI 軍師代打）'; cls = 'watch'; }
  else { text = S.mode === 'ai' ? '換您觀棋（AI 思考中…）' : '換您觀棋（對方思考中）'; cls = 'watch'; }
  banner.textContent = text;
  banner.className = 'turn-banner ' + cls;
  board.setInteractive(canMove(), c);
  // 按鈕
  const playing = ['ai', 'net', 'local'].includes(S.mode) && !g.result && !S.scoring;
  $('#btnPass').disabled = !canMove();
  $('#btnUndo').disabled = !playing || g.ply === 0 || S.animating || S.aiThinking;
  $('#btnResign').disabled = !playing || (S.mode === 'net' && !S.netStarted);
  $('#btnHint').disabled = !canMove();
  const proxyBtn = $('#btnProxy');
  proxyBtn.classList.toggle('hidden', !['ai', 'net', 'local'].includes(S.mode));
  const pside = proxySide();
  proxyBtn.disabled = !playing || (S.mode === 'net' && !(S.link && S.link.connected && S.netStarted));
  proxyBtn.textContent = S.proxy[pside] ? '↩ 交還主位' : '🧙 軍師代打';
  proxyBtn.classList.toggle('on', !!S.proxy[pside]);
  $('#btnPause').textContent = S.paused ? '▶ 繼續' : '⏸ 暫停';
  $('#btnPause').disabled = S.mode !== 'aivai' || !!g.result;
  $('#btnEstimate').disabled = S.mode === 'idle';
  $('#btnNew').textContent = S.mode === 'net' ? '再來一局' : '新局';
  $('#btnNew').disabled = S.mode === 'replay' || S.mode === 'idle' || (S.mode === 'net' && !g.result);
  $('#btnExport').disabled = !g.ply;
  renderClocks();
}

function renderMoves() {
  const g = S.game;
  const list = $('#moveList');
  list.innerHTML = '';
  const n = g.size;
  const frag = document.createDocumentFragment();
  g.moves.forEach((m, k) => {
    frag.append(h('span', { class: 'mv ' + (m.c === BLACK ? 'b' : 'w') + (k === g.ply - 1 ? ' cur' : ''), title: `第 ${k + 1} 手`, onclick: () => S.mode === 'replay' && replayGo(k + 1) },
      h('i', {}, String(k + 1)), pointName(m.i, n) + (m.cap.length ? ` ×${m.cap.length}` : '')));
  });
  list.append(frag);
  list.scrollTop = list.scrollHeight;
}

function renderClocks() {
  const g = S.game;
  if (!g) return;
  for (const c of [BLACK, WHITE]) {
    let ms = S.clocks[c] || 0;
    if (!g.result && !S.scoring && S.clockSide === c && isPlay() && (S.mode !== 'net' || S.netStarted) && !S.paused) ms += Date.now() - S.clockStart;
    const s = Math.floor(ms / 1000);
    $(c === BLACK ? '#pBlack' : '#pWhite').querySelector('.pclock').textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}
function tickClock() { if (S.screen === 'game' && S.game) renderClocks(); }

function flashBanner() { const b = $('#turnBanner'); b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); }
function popText(text, cls = '') {
  const el = h('div', { class: 'pop ' + cls }, text);
  $('#boardWrap').append(el);
  setTimeout(() => el.remove(), 1600);
}

// ---------------- AI ----------------
function isAITurn() {
  const g = S.game;
  if (!g || g.result || S.animating || S.scoring) return false;
  const c = g.turn;
  if (S.mode === 'aivai') return !S.paused;
  if (S.mode === 'ai') return c !== S.mySide || !!S.proxy[c];
  if (S.mode === 'local') return !!S.proxy[c];
  if (S.mode === 'net') return c === S.mySide && !!S.proxy[c] && !!(S.link && S.link.connected) && S.netStarted;
  return false;
}
function maybeAutoMove() { if (isAITurn() && !S.aiThinking) aiMove(); }

const proxyLevel = () => Math.min(S.settings.proxyLevel ?? 4, LEVELS.length - 1);

async function computeAIMove(g, lvl) {
  const r = await ai.genMove(g, lvl);
  let move = r.move, source = r.source;
  // 棋譜庫：布局階段若棋譜常見下法與引擎首選差不多，就照棋譜下
  if (lvl >= 3 && S.settings.learnFromGames !== false && r.a && r.a.moves.length && move !== PASS) {
    const hits = S.book.lookup(g).filter((x) => x.n >= 2 && (x.rate == null || x.rate >= 0.45));
    const best = r.a.moves[0];
    for (const x of hits.slice(0, 3)) {
      const m = r.a.moves.find((y) => y.i === x.i);
      if (m && wrFor(best.winrate, g.turn) - wrFor(m.winrate, g.turn) <= 0.025) { move = x.i; source = `棋譜庫（出現 ${x.n} 次）`; break; }
    }
  }
  return { move, source, a: r.a };
}

async function aiMove() {
  const g = S.game;
  if (!isAITurn() || S.aiThinking) return;
  const mode = S.mode, turn = g.turn, ply = g.ply;
  const isProxy = mode !== 'aivai' && !!S.proxy[turn];
  S.aiThinking = true;
  updateGameUI();
  const t0 = Date.now();
  const lvl = isProxy ? proxyLevel() : S.levels[turn];
  let move = PASS, source = '', a = null;
  try { ({ move, source, a } = await computeAIMove(g, lvl)); }
  catch (e) { console.error(e); const lm = g.legalMoves(); move = lm.length ? lm[Math.floor(Math.random() * lm.length)] : PASS; source = '備用著法'; }
  const minWait = mode === 'aivai' ? S.aivaiDelay : isProxy ? 700 : 350;
  const wait = minWait - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
  S.aiThinking = false;
  if (S.game !== g || S.mode !== mode || g.ply !== ply || !isAITurn()) { updateGameUI(); maybeAutoMove(); return; }
  if (a) { S.stats[ply] = S.stats[ply] || { wr: a.winrate, lead: a.scoreLead }; if (!S.lastA || S.lastAPly !== ply || (S.lastA.visits || 0) < a.visits) { S.lastA = a; S.lastAPly = ply; } }
  if (a) renderData();
  // AI 認輸：勝率長期極低
  if (a && !isProxy && (mode === 'ai' || mode === 'aivai')) {
    const wr = wrFor(a.winrate, turn), ld = leadFor(a.scoreLead, turn);
    S.aiLow[turn] = wr < 0.03 && ld < -10 && g.ply > g.size * g.size * 0.3 ? S.aiLow[turn] + 1 : 0;
    if (S.aiLow[turn] >= 3) {
      $('#aiInfo').textContent = `${S.names[turn]}：勝率只剩 ${pct(wr)}，認輸`;
      g.resign(turn);
      await onGameOver();
      return;
    }
  }
  const who = mode === 'aivai' ? S.names[turn] : isProxy ? `軍師 ${labelOf(S.players[turn]?.advisor)}` : 'AI';
  $('#aiInfo').textContent = `${who}：${pointName(move, g.size)}　${source}${a ? `．${colorName(turn)}勝率 ${pct(wrFor(a.winrate, turn))}` : ''}`;
  if (move !== PASS && !g.isLegal(move)) move = PASS;
  if (mode === 'net') S.link.send({ t: 'move', ply: g.ply, mv: toGtp(move, g.size), proxy: true });
  await applyMove(move);
}

// 軍師代打：遠端與 AI 對戰時是「我」；本機兩人對弈時是「輪到的一方」
function proxySide() {
  if (S.mode === 'local') { const g = S.game; if (!g) return BLACK; return S.proxy[BLACK] ? BLACK : S.proxy[WHITE] ? WHITE : g.turn; }
  return S.mySide;
}
function toggleProxy() {
  const g = S.game;
  if (!g || g.result || !['ai', 'net', 'local'].includes(S.mode)) return;
  const side = proxySide();
  const on = !S.proxy[side];
  S.proxy[side] = on;
  const adv = labelOf(S.players[side]?.advisor);
  if (S.mode === 'net') S.link.send({ t: 'proxy', on, advisor: S.players[side]?.advisor, ply: g.ply });
  if (on) { popText(`AI 軍師「${adv}」接手`, 'proxy'); chatSys(`${S.mode === 'local' ? colorName(side) + '方' : '您'}暫時離開，由 AI 軍師「${adv}」代打`); say(`軍師${adv}接手`); }
  else { popText('主位回來了', 'proxy'); chatSys('已交還主位，換回自己下棋'); say('主位回來了'); }
  updateGameUI();
  updateAdvisorHead();
  maybeAutoMove();
}

// 中途更換 AI 軍師
async function changeAdvisor(c) {
  if (!c || !S.players[c]) return;
  const allowed = S.mode === 'local' || ((S.mode === 'ai' || S.mode === 'net') && c === S.mySide);
  if (!allowed) { toast('只能更換自己的 AI 軍師'); return; }
  const id = await pickAdvisor(S.players[c].advisor, `更換${colorName(c)}方的 AI 軍師`);
  if (!id || id === S.players[c].advisor) return;
  S.players[c] = { ...S.players[c], advisor: id };
  if (S.mode !== 'local') saveSettings({ profile: { ...myProfile(), advisor: id } });
  if (S.mode === 'net' && S.link) S.link.send({ t: 'advisor', advisor: id });
  popText(`換上軍師「${labelOf(id)}」`, 'proxy');
  chatSys(`${colorName(c)}方換上 AI 軍師「${labelOf(id)}」`);
  say(`換上軍師${labelOf(id)}`);
  updateGameUI();
  updateAdvisorHead();
}

function togglePause() {
  if (S.mode !== 'aivai' || !S.game || S.game.result) return;
  S.paused = !S.paused;
  if (S.paused) S.clocks[S.game.turn] += Date.now() - S.clockStart; else S.clockStart = Date.now();
  updateGameUI();
  if (!S.paused) maybeAutoMove();
}

// ---------------- 提示、形勢、悔棋、認輸 ----------------
async function hint() {
  const g = S.game;
  if (!canMove()) return;
  $('#btnHint').disabled = true;
  try {
    let a = S.lastAPly === g.ply && S.lastA && S.lastA.visits >= 100 ? S.lastA : null;
    if (!a) a = await ai.analyze(g, { visits: 300, ownership: true, playouts: 6000, timeMs: 2000 });
    if (S.game !== g || g.ply !== S.game.ply) return;
    S.lastA = a; S.lastAPly = g.ply;
    const best = a.moves[0];
    if (best) {
      if (best.i >= 0) showHint(best.i);
      toast(`💡 提示：${pointName(best.i, g.size)}（${colorName(g.turn)}勝率 ${pct(wrFor(best.winrate, g.turn))}）`, 'ok', 5000);
    }
    renderData();
  } finally { updateGameUI(); }
}

function showHint(i) {
  board.setHint(i);
  clearTimeout(showHint.t);
  showHint.t = setTimeout(() => board.setHint(-1), 12000);
}

async function toggleEstimate() {
  S.showOwn = !S.showOwn;
  const g = S.game;
  if (S.showOwn && g && !(S.lastAPly === g.ply && S.lastA && S.lastA.ownership)) await runLive();
  renderOverlay();
  if (S.showOwn && S.lastA && S.lastA.ownership) {
    let b = 0, w = 0;
    for (const v of S.lastA.ownership) { if (v > 0.3) b++; else if (v < -0.3) w++; }
    toast(`🗺 形勢判斷：黑方約 ${b} 點、白方約 ${w} 點（含棋子）；${leadFor(S.lastA.scoreLead, BLACK) >= 0 ? '黑' : '白'}方領先 ${Math.abs(S.lastA.scoreLead).toFixed(1)} 目`, 'info', 6000);
  }
}

async function requestUndo() {
  const g = S.game;
  if (!g || g.result || !g.ply || S.animating || S.aiThinking || S.scoring) return;
  if (S.mode === 'ai') {
    const n = g.turn === S.mySide ? 2 : 1;
    doUndo(Math.min(n, g.ply));
    return;
  }
  if (S.mode === 'local') { doUndo(1); return; }
  if (S.mode === 'net') {
    const n = g.turn === S.mySide ? 2 : 1;
    if (n > g.ply) return;
    S.link.send({ t: 'undo-req', n, ply: g.ply });
    toast('已向對方提出悔棋請求…');
  }
}

function doUndo(n) {
  const g = S.game;
  if (!g) return;
  for (let k = 0; k < n; k++) g.undo();
  syncBoard();
  S.clockSide = g.turn;
  S.stats.length = g.ply + 1;
  updateGameUI();
  scheduleLive();
  maybeAutoMove();
}

function syncBoard() {
  const g = S.game;
  board.setPosition(g.board.cells);
  board.lidCounts = { ...g.captures };
  board.setPrisoners(g.captures);
  const last = g.lastMove;
  board.setLastMove(last && last.i >= 0 ? last.i : -1);
  board.setHint(-1);
}

async function resign() {
  const g = S.game;
  if (!g || g.result) return;
  const side = S.mode === 'local' ? g.turn : S.mySide;
  const ok = await modal('認輸', S.mode === 'local' ? `${colorName(side)}方確定要認輸嗎？` : '確定要認輸嗎？', [{ label: '取消', value: false }, { label: '認輸', value: true, primary: true }]);
  if (!ok || g.result) return;
  if (S.mode === 'net') S.link.send({ t: 'resign', ply: g.ply });
  g.resign(side);
  S.aiThinking = false;
  await onGameOver();
}

// ---------------- 終局數子 ----------------
async function startScoring() {
  const g = S.game;
  S.scoring = { dead: new Set(), score: null, ok: {}, busy: true };
  updateGameUI();
  renderScorePanel('正在判斷死活…');
  say('雙方停一手，終局');
  let own = null;
  try {
    // 網路對局由房主判斷，來賓等房主送來的結果
    if (S.mode !== 'net' || S.link.role === 'host') {
      const a = await ai.analyze(g, { visits: 400, ownership: true, playouts: 12000, timeMs: 3500 });
      own = a && a.ownership;
    }
  } catch (e) { console.warn(e); }
  if (!S.scoring || S.game !== g) return;
  if (S.mode === 'net' && S.link.role !== 'host') { renderScorePanel('等待房主判斷死活…'); return; }
  S.scoring.own = own;
  S.scoring.dead = deadFromOwnership(g.board, own);
  S.scoring.busy = false;
  recalcScore();
  if (S.mode === 'net') S.link.send({ t: 'score', dead: [...S.scoring.dead] });
  if (S.mode === 'aivai') { await sleep(2500); if (S.scoring && S.game === g) finalizeScore(); }
}

function neutralFrom(own, g) {
  if (!own || g.rules !== 'japanese') return null;
  return Uint8Array.from(own, (v, i) => (g.board.cells[i] === 0 && Math.abs(v) < 0.25 ? 1 : 0));
}

function recalcScore() {
  const g = S.game, sc = S.scoring;
  if (!sc) return;
  sc.score = g.score(sc.dead, neutralFrom(sc.own, g));
  board.setDead(sc.dead);
  board.setCandidates(null); board.setOwnership(null);
  board.setTerritory(sc.score.owner);
  renderScorePanel();
  updateGameUI();
}

function toggleDead(i) {
  const g = S.game, sc = S.scoring;
  if (!sc || sc.busy || !g.board.cells[i] || S.mode === 'aivai') return;
  if (S.mode === 'net' && S.link.role !== 'host') { S.link.send({ t: 'dead-toggle', i }); return; }
  const grp = g.board.group(i);
  const dead = !sc.dead.has(i);
  for (const s of grp.stones) dead ? sc.dead.add(s) : sc.dead.delete(s);
  sc.ok = {};
  recalcScore();
  if (S.mode === 'net') S.link.send({ t: 'score', dead: [...sc.dead] });
}

function renderScorePanel(msg) {
  const p = $('#scorePanel');
  p.classList.remove('hidden');
  p.innerHTML = '';
  const g = S.game, sc = S.scoring;
  if (msg || !sc || !sc.score) { p.append(h('div', { class: 'spin' }, msg || '計算中…')); return; }
  const s = sc.score;
  const jp = g.rules === 'japanese';
  const line = (c) => jp
    ? `${c === BLACK ? '⚫ 黑' : '⚪ 白'}：地 ${c === BLACK ? s.terrB : s.terrW} ＋ 提子 ${c === BLACK ? g.captures[BLACK] + s.deadW : g.captures[WHITE] + s.deadB}${c === WHITE ? ` ＋ 貼目 ${fmtNum(g.komi)}` : ''} ＝ ${fmtNum(c === BLACK ? s.black : s.white)}`
    : `${c === BLACK ? '⚫ 黑' : '⚪ 白'}：子 ${c === BLACK ? s.stonesB : s.stonesW} ＋ 地 ${c === BLACK ? s.terrB : s.terrW}${c === WHITE ? ` ＋ 貼目 ${fmtNum(g.komi)}` : ''} ＝ ${fmtNum(c === BLACK ? s.black : s.white)}`;
  const res = s.winner ? `${colorName(s.winner)}勝 ${fmtNum(Math.abs(s.diff))} ${jp ? '目' : '子'}` : '和棋';
  const iConfirmed = S.mode === 'net' ? sc.ok[S.link.role] : false;
  p.append(
    h('div', { class: 'sp-title' }, '🏁 終局數子'),
    h('div', { class: 'sp-line' }, line(BLACK)),
    h('div', { class: 'sp-line' }, line(WHITE)),
    h('div', { class: 'sp-res' }, res),
    h('div', { class: 'muted small' }, S.mode === 'aivai' ? '自動確認中…' : `半透明的是判定為死子的棋（共 ${sc.dead.size} 顆）。點棋子可以切換死活。`),
    S.mode === 'aivai' ? null : h('div', { class: 'sp-btns' },
      h('button', { class: 'primary', id: 'btnScoreOk', disabled: iConfirmed, onclick: () => confirmScore() }, iConfirmed ? '等待對方確認…' : '✔ 確認結果'),
      h('button', { id: 'btnResume', onclick: () => resumePlay(true) }, '有異議，繼續下')));
}

function confirmScore() {
  const sc = S.scoring;
  if (!sc || !sc.score) return;
  if (S.mode === 'net') {
    sc.ok[S.link.role] = true;
    S.link.send({ t: 'score-ok' });
    if (sc.ok.host && sc.ok.guest) finalizeScore(); else renderScorePanel();
    return;
  }
  finalizeScore();
}

function resumePlay(local) {
  if (!S.scoring) return;
  if (local && S.mode === 'net') S.link.send({ t: 'resume' });
  S.scoring = null;
  S.game.passes = 0;
  board.setDead(null); board.setTerritory(null);
  $('#scorePanel').classList.add('hidden');
  toast('回到對局，用實戰解決死活', 'info');
  updateGameUI();
  scheduleLive();
  maybeAutoMove();
}

async function finalizeScore() {
  const g = S.game, sc = S.scoring;
  if (!sc || !sc.score) return;
  g.setScored(sc.score);
  g.result.dead = [...sc.dead];
  S.scoring = null;
  $('#scorePanel').classList.add('hidden');
  await onGameOver(sc.score);
}

async function onGameOver(score) {
  const g = S.game;
  const r = g.result;
  board.setInteractive(false);
  S.clocks[g.turn] += Date.now() - S.clockStart;
  const mine = S.mode === 'ai' || S.mode === 'net';
  if (!mine || r.winner === S.mySide) sfx.win(); else if (r.winner) sfx.lose();
  say(resultText(r));
  await saveGame();
  updateGameUI();
  renderData();
  const btns = S.mode === 'ai' || S.mode === 'local' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再下一局', value: 'again', primary: true }]
    : S.mode === 'aivai' ? [{ label: '檢視棋盤', value: 'stay' }, { label: '再看一局', value: 'again', primary: true }]
    : [{ label: '知道了', value: 'stay', primary: true }];
  const title = !mine ? '對局結束' : !r.winner ? '和棋' : r.winner === S.mySide ? '恭喜獲勝！' : '這局輸了';
  const v = await modal(title, h('div', {},
    h('p', { class: 'res-big' }, resultText(r) + (mine && r.winner ? (r.winner === S.mySide ? '　🎉' : '') : '')),
    score ? h('p', { class: 'muted small' }, `黑 ${fmtNum(score.black)}．白 ${fmtNum(score.white)}（${g.rules === 'japanese' ? '數目法' : '數子法'}，貼 ${fmtNum(g.komi)}）`) : null,
    h('p', { class: 'muted small' }, '本局棋譜已自動存入棋譜庫，可以重播或做覆盤速算；AI 也會參考這局的布局。')), btns);
  if (v === 'again') newGameSameMode();
}

function recordMeta() {
  return {
    id: S.gameId, mode: S.mode, source: 'play',
    black: S.names[BLACK], white: S.names[WHITE],
    mySide: S.mode === 'ai' || S.mode === 'net' ? (S.mySide === BLACK ? 'B' : 'W') : '',
    level: S.mode === 'ai' ? LEVELS[S.levels[other(S.mySide)]].name : S.mode === 'aivai' ? `${LEVELS[S.levels[BLACK]].name} 對 ${LEVELS[S.levels[WHITE]].name}` : '',
    players: S.players,
    analysis: S.stats.map((s) => (s ? [Math.round(s.wr * 1000) / 1000, Math.round(s.lead * 10) / 10] : null)),
  };
}

async function saveGame() {
  if (S.saved || !S.game || !S.game.ply || !isPlay()) return;
  S.saved = true;
  const rec = S.game.toRecord(recordMeta());
  try {
    await xk.games.save(rec);
    if (S.settings.learnFromGames !== false && rec.result) { S.book.addRecord(rec); renderLearnStat(); }
  } catch (e) { toast('棋譜儲存失敗：' + errMsg(e), 'err'); }
}

async function saveUnfinished() {
  if (S.saved || !S.game || S.game.result || S.game.ply < 4 || !isPlay()) return;
  S.saved = true;
  try { await xk.games.save(S.game.toRecord({ ...recordMeta(), unfinished: true })); } catch {}
}

async function leaveGame() {
  if (['ai', 'net', 'local'].includes(S.mode) && S.game && !S.game.result && S.game.ply) {
    const ok = await modal('離開對局', S.mode === 'net' ? '離開會中斷與對手的連線，確定要離開嗎？' : '這局還沒下完，確定要離開嗎？（棋譜會保留）', [{ label: '繼續下棋', value: false }, { label: '離開', value: true, primary: true }]);
    if (!ok) return;
  }
  await saveUnfinished();
  closeNet();
  if (S.liveId) ai.cancel(S.liveId);
  S.mode = null;
  S.game = null;
  S.scoring = null;
  stopReplayAuto();
  document.body.classList.remove('mode-net', 'mode-ai', 'mode-replay', 'mode-aivai', 'mode-local');
  renderHome();
  showScreen('home');
}

function newGameSameMode() {
  if (S.mode === 'ai') startAIGame(S.lastAI);
  else if (S.mode === 'aivai') startAIvAI(S.lastAivai);
  else if (S.mode === 'local') startLocalGame(S.lastLocal);
  else if (S.mode === 'net') requestRematch();
}

// ---------------- 開局 ----------------
async function startAIGame(cfg) {
  if (!(await ensureProfile())) return;
  S.lastAI = cfg;
  const me = cfg.color === 'white' ? WHITE : cfg.color === 'black' ? BLACK : (Math.random() < 0.5 ? BLACK : WHITE);
  const lv = LEVELS[cfg.level];
  const aiName = `小柯 AI（${lv.name}）`, myName = S.settings.playerName || '我';
  const mine = myProfile(), opp = randomProfile([mine.avatar, mine.advisor]);
  setupGame('ai', {
    size: cfg.size, rules: cfg.rules, handicap: cfg.handicap || 0, mySide: me,
    names: me === BLACK ? { 1: myName, 2: aiName } : { 1: aiName, 2: myName },
    players: me === BLACK ? { 1: mine, 2: opp } : { 1: opp, 2: mine },
    levels: { 1: cfg.level, 2: cfg.level },
  });
  popText(me === BLACK ? '您執黑' : '您執白', me === BLACK ? 'black' : 'white');
  if (cfg.level === 5 && !ai.strongAvailable) toast('深度網路無法使用，「大師」改用快速網路', 'info', 5000);
  setTimeout(() => maybeAutoMove(), 1200);
}

async function startLocalGame(cfg) {
  if (!(await ensureProfile())) return;
  S.lastLocal = cfg;
  const mine = myProfile(), p2 = randomProfile([mine.avatar, mine.advisor]);
  setupGame('local', {
    size: cfg.size, rules: cfg.rules, mySide: null,
    names: { 1: S.settings.playerName || '棋友一', 2: '棋友二' },
    players: { 1: mine, 2: p2 }, levels: { 1: proxyLevel(), 2: proxyLevel() },
  });
}

async function startAIvAI(cfg) {
  if (!(await ensureProfile())) return;
  cfg = cfg || { size: 19, levels: [3, 3], speed: 'normal' };
  S.lastAivai = cfg;
  const p1 = randomProfile(), p2 = randomProfile([p1.avatar, p1.advisor]);
  setupGame('aivai', {
    size: cfg.size, rules: S.settings.game.rules || 'chinese', mySide: null,
    names: { 1: `黑方 AI（${LEVELS[cfg.levels[0]].name}）`, 2: `白方 AI（${LEVELS[cfg.levels[1]].name}）` },
    players: { 1: p1, 2: p2 }, levels: { 1: cfg.levels[0], 2: cfg.levels[1] },
  });
  S.aivaiDelay = (SPEEDS.find(([v]) => v === cfg.speed) || SPEEDS[1])[2];
  updateGameUI();
  setTimeout(() => maybeAutoMove(), 1300);
}

// ---------------- 遠端對戰 ----------------
function netWait(el) {
  const w = $('#netWait');
  if (!w) return;
  w.classList.toggle('hidden', !el);
  w.innerHTML = '';
  if (el) w.append(el);
}

async function hostRoom(cfg) {
  if (!(await ensureProfile())) return;
  closeNet();
  S.hostCfg = cfg;
  saveSettings({ game: { size: cfg.size, rules: cfg.rules } });
  netWait(h('span', {}, '正在建立房間…'));
  const link = new GameLink(S.settings);
  S.link = link;
  try {
    const code = await link.host();
    netWait(h('div', {},
      h('div', { class: 'room-code' }, code.replace(/(\d{3})(\d{3})/, '$1 $2')),
      h('div', {}, `${cfg.size} 路房間已建立，請把房號告訴對方，對方在「加入房間」輸入即可。`),
      h('div', { class: 'net-row' },
        h('button', { onclick: () => { navigator.clipboard.writeText(code); toast('已複製房號', 'ok'); } }, '複製房號'),
        h('button', { onclick: () => { closeNet(); netWait(null); } }, '取消')),
      h('div', { class: 'muted small spin' }, '等待對手加入…')));
    bindLink(link);
  } catch (e) {
    netWait(h('span', { class: 'err' }, '建立房間失敗：' + errMsg(e)));
    S.link = null;
  }
}

async function joinRoom(code) {
  if (!(await ensureProfile())) return;
  closeNet();
  netWait(h('span', {}, '正在連線…'));
  const link = new GameLink(S.settings);
  S.link = link;
  bindLink(link);
  try { await link.join(code); }
  catch (e) { netWait(h('span', { class: 'err' }, errMsg(e))); S.link = null; link.close(); }
}

function bindLink(link) {
  link.on('connected', () => {
    S.netStarted = false;
    link.send({ t: 'hello', name: S.settings.playerName || '棋友', ver: PROTOCOL, profile: myProfile() });
  });
  link.on('msg', (m) => onNetMsg(link, m));
  link.on('lost', (reason) => {
    if (S.link !== link) return;
    S.netStatus = '⚠ ' + reason + '，對局暫停';
    endVoice(false);
    if (S.screen === 'game' && S.mode === 'net') {
      chatSys(reason);
      updateGameUI();
      if (S.game && !S.game.result) toast('與對手的連線中斷了', 'err', 6000);
    } else netWait(h('span', { class: 'err' }, reason));
  });
  link.on('call', (call) => onVoiceCall(call));
}

function makeStart(hostColor) {
  const cfg = S.hostCfg || { size: 19, rules: 'chinese' };
  const me = S.settings.playerName || '棋友';
  const opp = validProfile(S.oppProfile) ? S.oppProfile : randomProfile([myProfile().avatar]);
  return {
    t: 'start', gameId: newGameId(), size: cfg.size, rules: cfg.rules, komi: komiOf(cfg.rules, 0), hostColor,
    names: hostColor === BLACK ? { 1: me, 2: S.oppName } : { 1: S.oppName, 2: me },
    players: hostColor === BLACK ? { 1: myProfile(), 2: opp } : { 1: opp, 2: myProfile() },
  };
}

function startNetGame(m) {
  const mySide = S.link.role === 'host' ? m.hostColor : other(m.hostColor);
  const pl = m.players && validProfile(m.players[1]) && validProfile(m.players[2]) ? { 1: m.players[1], 2: m.players[2] } : null;
  setupGame('net', { size: m.size, rules: m.rules, komi: m.komi, mySide, names: { 1: m.names[1], 2: m.names[2] }, players: pl });
  S.gameId = m.gameId;
  if (m.proxy) S.proxy = { 1: !!m.proxy[1], 2: !!m.proxy[2] };
  S.netStarted = true;
  S.netStatus = '';
  S.curStart = m;
  const g = S.game;
  for (const s of m.moves || []) { const i = fromGtp(s, g.size); if (i != null && g.isLegal(i)) g.play(i); }
  if ((m.moves || []).length) syncBoard();
  netWait(null);
  chatSys(`對局開始！您執${colorName(mySide)}${mySide === BLACK ? '，請先下' : '，黑棋先下'}。`);
  updateGameUI();
  if (mySide === g.turn) sfx.turn();
  xk.win.attention('對局開始', `您執${colorName(mySide)}`);
}

async function onNetMsg(link, m) {
  const g = S.game;
  switch (m.t) {
    case 'busy': netWait(h('span', { class: 'err' }, '這個房間已經有人在下棋了')); link.close(); S.link = null; break;
    case 'old': netWait(h('span', { class: 'err' }, m.text || '版本不相容')); toast(m.text || '版本不相容', 'err', 8000); break;
    case 'hello':
      S.oppName = String(m.name || '對手').slice(0, 16);
      S.oppProfile = validProfile(m.profile) ? { avatar: m.profile.avatar, advisor: m.profile.advisor } : null;
      if (link.role === 'host') {
        if (S.mode === 'net' && g && !g.result && S.netStarted) {
          link.send({ ...S.curStart, moves: g.moves.map((x) => toGtp(x.i, g.size)), proxy: S.proxy, players: S.players });
          S.netStatus = '';
          chatSys('對手已重新連線');
          updateGameUI();
        } else {
          const side = S.hostCfg.side === 'black' ? BLACK : S.hostCfg.side === 'white' ? WHITE : (Math.random() < 0.5 ? BLACK : WHITE);
          const start = makeStart(side);
          link.send(start);
          startNetGame(start);
        }
      }
      break;
    case 'start': if (link.role === 'guest') { startNetGame(m); setTimeout(() => maybeAutoMove(), 800); } break;
    case 'move': {
      if (!g || S.mode !== 'net' || g.result) return;
      if (m.ply !== g.ply || g.turn === S.mySide) { link.send({ t: 'sync-req' }); return; }
      const i = fromGtp(m.mv, g.size);
      if (i == null || !g.isLegal(i)) { link.send({ t: 'sync-req' }); return; }
      if (S.scoring) resumePlay(false);
      await applyMove(i);
      break;
    }
    case 'sync-req': if (g && S.curStart) link.send({ t: 'sync', moves: g.moves.map((x) => toGtp(x.i, g.size)) }); break;
    case 'sync':
      if (g && link.role === 'guest' && S.curStart) {
        const ng = new Game({ size: S.curStart.size, rules: S.curStart.rules, komi: S.curStart.komi });
        for (const s of m.moves) { const i = fromGtp(s, ng.size); if (i != null && ng.isLegal(i)) ng.play(i); }
        S.game = ng;
        syncBoard();
        updateGameUI();
        scheduleLive();
      }
      break;
    case 'proxy': {
      if (!g) return;
      const opp = other(S.mySide);
      S.proxy[opp] = !!m.on;
      const adv = labelOf(m.advisor || S.players[opp]?.advisor);
      if (m.on) { popText(`對方換由 AI 軍師「${adv}」代打`, 'proxy'); chatSys(`${S.oppName || '對方'} 暫時離開，主位換由 AI 軍師「${adv}」代打`); toast(`對方暫時離開，換 AI 軍師「${adv}」代打`, 'info', 5000); }
      else { popText(`${S.oppName || '對方'} 回到主位`, 'proxy'); chatSys(`${S.oppName || '對方'} 回來了，主位換回親自下棋`); toast('對方回到主位，親自下棋', 'info', 4000); }
      xk.win.attention('主位換人', m.on ? `對方改由 AI 軍師「${adv}」代打` : '對方回到主位');
      updateGameUI();
      break;
    }
    case 'advisor': {
      if (!g) return;
      const opp = other(S.mySide);
      if (S.players[opp] && m.advisor) { S.players[opp] = { ...S.players[opp], advisor: m.advisor }; chatSys(`對方換上 AI 軍師「${labelOf(m.advisor)}」`); updateGameUI(); }
      break;
    }
    case 'undo-req': {
      if (!g || g.result) return;
      if (S.proxy[S.mySide]) { link.send({ t: 'undo-no' }); link.send({ t: 'chat', text: '（AI 軍師代打中，主位暫時離開，無法回覆悔棋）' }); return; }
      const ok = await modal('悔棋請求', `${S.oppName} 想要悔棋（退回 ${m.n} 手），同意嗎？`, [{ label: '不同意', value: false }, { label: '同意', value: true, primary: true }], { timeout: 30000, timeoutValue: false });
      if (ok && S.game === g && g.ply === m.ply) { link.send({ t: 'undo-ok', n: m.n }); doUndo(m.n); chatSys(`同意對方悔棋 ${m.n} 手`); }
      else link.send({ t: 'undo-no' });
      break;
    }
    case 'undo-ok': if (g) { doUndo(m.n); toast('對方同意悔棋', 'ok'); chatSys(`悔棋 ${m.n} 手`); } break;
    case 'undo-no': toast('對方不同意悔棋'); break;
    case 'resign': if (g && !g.result) { g.resign(other(S.mySide)); S.scoring = null; await onGameOver(); } break;
    case 'score': {
      if (!g || link.role !== 'guest') return;
      if (!S.scoring) S.scoring = { dead: new Set(), ok: {}, busy: false };
      S.scoring.busy = false;
      S.scoring.dead = new Set(m.dead || []);
      S.scoring.ok = {};
      recalcScore();
      break;
    }
    case 'dead-toggle': if (link.role === 'host' && S.scoring) toggleDead(m.i); break;
    case 'score-ok':
      if (S.scoring) { S.scoring.ok[link.role === 'host' ? 'guest' : 'host'] = true; if (S.scoring.ok.host && S.scoring.ok.guest) finalizeScore(); else { renderScorePanel(); toast('對方已確認數子結果'); } }
      break;
    case 'resume': if (S.scoring) { resumePlay(false); chatSys('對方對死活有異議，繼續對局'); } break;
    case 'rematch-req': {
      if (S.proxy[S.mySide]) { link.send({ t: 'rematch-no' }); break; }
      const ok = await modal('再來一局', `${S.oppName} 想再下一局（黑白交換），同意嗎？`, [{ label: '不要', value: false }, { label: '好啊', value: true, primary: true }], { timeout: 45000, timeoutValue: false });
      if (!ok) { link.send({ t: 'rematch-no' }); break; }
      if (link.role === 'host') startRematchAsHost(); else link.send({ t: 'rematch-ok' });
      break;
    }
    case 'rematch-ok': if (link.role === 'host') startRematchAsHost(); break;
    case 'rematch-no': toast('對方暫時不想再下'); break;
    case 'chat': chatLine('opp', String(m.text || '').slice(0, 500)); if (S.screen === 'game' && !$('#pane-chat').classList.contains('on')) $('.tab[data-tab="chat"]').classList.add('ping'); break;
    case 'voice-end': endVoice(true); break;
    case 'voice-reject': toast('對方沒有接聽語音'); endVoice(false); break;
  }
}

function requestRematch() {
  if (!S.link || !S.link.connected) { toast('對手已離線', 'err'); return; }
  S.link.send({ t: 'rematch-req' });
  toast('已邀請對方再下一局…');
}

async function startRematchAsHost() {
  await saveUnfinished();
  const start = makeStart(other(S.curStart.hostColor));
  S.link.send(start);
  startNetGame(start);
}

function closeNet() {
  endVoice(false, true);
  if (S.link) { S.link.close(); S.link = null; }
  S.netStarted = false;
}

// ---------------- 聊天與語音 ----------------
function chatLine(who, text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg ' + who }, h('b', {}, who === 'me' ? '我' : (S.oppName || '對手')), h('span', {}, text)));
  log.scrollTop = log.scrollHeight;
}
function chatSys(text) {
  const log = $('#chatLog');
  log.append(h('div', { class: 'chat-msg sys' }, text));
  log.scrollTop = log.scrollHeight;
}
function sendChat() {
  const inp = $('#chatInput');
  const text = inp.value.trim();
  if (!text || !S.link || !S.link.connected) return;
  S.link.send({ t: 'chat', text });
  chatLine('me', text);
  inp.value = '';
}

const VS = { call: null, mic: null };
async function getMic() {
  await xk.sys.askMicrophone();
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
}
function setVoiceUI(state) {
  $('#voiceState').textContent = { off: '語音：未通話', calling: '語音：撥號中…', on: '🟢 語音通話中' }[state];
  $('#btnVoice').textContent = state === 'off' ? '🎤 語音通話' : '⏹ 結束通話';
  $('#btnMute').classList.toggle('hidden', state !== 'on');
  $('#voiceBar').classList.toggle('on', state === 'on');
  music.setDuck(state === 'on');
}
async function toggleVoice() {
  if (VS.call || VS.mic) { endVoice(false, true); return; }
  if (!S.link || !S.link.connected) { toast('尚未連線到對手', 'err'); return; }
  try {
    VS.mic = await getMic();
    setVoiceUI('calling');
    setupCall(S.link.call(VS.mic));
  } catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); endVoice(false); }
}
async function onVoiceCall(call) {
  if (VS.call) { call.close(); return; }
  xk.win.attention('語音通話邀請', `${S.oppName || '對手'} 邀請您語音通話`);
  const ok = await modal('語音通話邀請', `${S.oppName || '對手'} 邀請您語音通話，要接聽嗎？`, [{ label: '拒絕', value: false }, { label: '接聽', value: true, primary: true }], { timeout: 45000, timeoutValue: false });
  if (!ok) { call.close(); S.link && S.link.send({ t: 'voice-reject' }); return; }
  try { VS.mic = await getMic(); call.answer(VS.mic); setupCall(call); }
  catch (e) { toast('無法開啟麥克風：' + errMsg(e), 'err'); call.close(); S.link && S.link.send({ t: 'voice-reject' }); }
}
function setupCall(call) {
  VS.call = call;
  call.on('stream', (s) => { const a = $('#remoteAudio'); a.srcObject = s; a.play().catch(() => {}); setVoiceUI('on'); chatSys('語音通話已接通'); });
  call.on('close', () => { if (VS.call === call) endVoice(false); });
  call.on('error', () => { if (VS.call === call) endVoice(false); });
}
function toggleMute() {
  if (!VS.mic) return;
  const t = VS.mic.getAudioTracks()[0];
  t.enabled = !t.enabled;
  $('#btnMute').textContent = t.enabled ? '🔇 靜音' : '🔈 取消靜音';
}
function endVoice(remote, notify) {
  const had = !!(VS.call || VS.mic);
  if (notify && S.link) S.link.send({ t: 'voice-end' });
  if (VS.call) { try { VS.call.close(); } catch {} VS.call = null; }
  if (VS.mic) { VS.mic.getTracks().forEach((t) => t.stop()); VS.mic = null; }
  const a = $('#remoteAudio'); if (a) a.srcObject = null;
  if (music) setVoiceUI('off');
  if (had && S.screen === 'game') chatSys(remote ? '對方結束了語音通話' : '語音通話已結束');
}

// ---------------- 棋譜庫 ----------------
const MODE_NAME = { ai: '真人對 AI', net: '遠端對弈', local: '本機對弈', aivai: 'AI 對 AI', import: '匯入' };
const resShort = (r) => (!r ? '未完成' : r.type === 'resign' ? `${colorName(r.winner)}中盤勝` : r.type === 'void' ? '無勝負' : !r.winner ? '和棋' : `${colorName(r.winner)}+${fmtNum(Math.abs(r.diff || 0))}`);

async function renderRecords() {
  const body = $('#recordsBody');
  body.innerHTML = '';
  const all = await xk.games.list();
  let filter = S.recFilter || '';
  const head = h('div', { class: 'rec-head' },
    h('div', {}, h('h2', {}, '📜 棋譜庫'), h('p', { class: 'learn-stat muted' })),
    h('div', { class: 'rec-actions' },
      h('input', { class: 'rec-search', placeholder: '搜尋棋手、賽事…', value: filter, oninput: (e) => { S.recFilter = e.target.value; draw(); } }),
      h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.learnFromGames !== false, onchange: async (e) => { await saveSettings({ learnFromGames: e.target.checked }); await rebuildBook(); toast(e.target.checked ? 'AI 會參考棋譜庫' : 'AI 不再參考棋譜庫'); } }), ' AI 參考棋譜庫'),
      h('button', { onclick: () => importRecords(false) }, '匯入 SGF 檔'),
      h('button', { onclick: () => importRecords(true) }, '匯入整個資料夾'),
      h('button', { onclick: () => showScreen('home') }, '返回首頁')));
  const wrap = h('div', { class: 'rec-wrap' });
  body.append(head, wrap);
  const draw = () => {
    const q = (S.recFilter || '').trim();
    const list = q ? all.filter((g) => [g.black, g.white, g.event, g.level].some((x) => x && String(x).includes(q))) : all;
    wrap.innerHTML = '';
    if (!all.length) {
      wrap.append(h('div', { class: 'empty' }, '還沒有棋譜。每下完一局都會自動收錄在這裡，AI 也會從棋譜中學習布局。也可以「匯入 SGF 檔」或「匯入整個資料夾」。'));
      return;
    }
    const shown = list.slice(0, 500);
    wrap.append(h('table', { class: 'rec-table' },
      h('thead', {}, h('tr', {}, ...['日期', '類型', '棋盤', '黑方', '白方', '結果', '手數', '速算', ''].map((t) => h('th', {}, t)))),
      h('tbody', {}, shown.map((g) => h('tr', {},
        h('td', {}, g.date && /T/.test(g.date) ? fmtDate(g.date) : (g.date || '')),
        h('td', {}, MODE_NAME[g.mode] || (g.source === 'import' ? '匯入' : g.mode || '')),
        h('td', {}, `${g.size} 路`),
        h('td', {}, g.black || ''), h('td', {}, g.white || ''),
        h('td', { class: 'res' }, resShort(g.result)),
        h('td', {}, String(g.plies)),
        h('td', {}, g.analyzed ? '✔' : ''),
        h('td', { class: 'ops' },
          h('button', { onclick: () => openReplay(g.id) }, '重播'),
          h('button', { onclick: () => exportRecord(g.id) }, '匯出'),
          h('button', { class: 'danger', onclick: async () => { if (await modal('刪除棋譜', '確定刪除這份棋譜？', [{ label: '取消', value: false }, { label: '刪除', value: true, primary: true }])) { await xk.games.delete(g.id); await rebuildBook(); renderRecords(); } } }, '刪除')))))));
    if (list.length > shown.length) wrap.append(h('div', { class: 'muted small rec-more' }, `只顯示前 ${shown.length} 筆，共 ${list.length} 筆，請用搜尋縮小範圍。`));
  };
  draw();
  renderLearnStat();
}

async function importRecords(folder) {
  const files = await xk.games.pickImport(folder);
  if (!files.length) return;
  toast(`讀取 ${files.length} 個檔案中…`);
  let bad = 0;
  const recs = [];
  for (const f of files) {
    if (f.error) { bad++; continue; }
    try {
      const t = f.text.trim();
      let list = [];
      if (t.startsWith('{') || t.startsWith('[')) { const j = JSON.parse(t); list = Array.isArray(j) ? j : [j]; }
      else list = parseSgf(t);
      if (!list.length) { bad++; continue; }
      for (const r of list) {
        if (!r.moves || !r.moves.length || !(r.size >= 5 && r.size <= 19)) { bad++; continue; }
        const g = Game.replay(r);
        if (!g.ply) { bad++; continue; }
        recs.push({ ...g.toRecord({ mode: 'import', source: 'import', black: r.black || f.name.replace(/\.\w+$/, ''), white: r.white || '', event: r.event || '' }), result: r.result || null, date: r.date || new Date().toISOString(), id: undefined });
      }
    } catch { bad++; }
  }
  for (let k = 0; k < recs.length; k += 200) await xk.games.saveMany(recs.slice(k, k + 200));
  await rebuildBook();
  toast(`匯入 ${recs.length} 局棋譜${bad ? `，${bad} 個無法辨識` : ''}`, recs.length ? 'ok' : 'err', 5000);
  renderRecords();
}

const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 20);
async function exportRecord(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const p = await xk.games.export(`棋譜_${safeName(rec.black) || '黑'}_vs_${safeName(rec.white) || '白'}_${(rec.id || '').slice(0, 8)}.sgf`, recordToSgf(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

async function exportCurrent() {
  if (S.mode === 'replay') return exportRecord(S.replay.rec.id);
  const g = S.game;
  if (!g || !g.ply) return;
  const rec = g.toRecord(recordMeta());
  const p = await xk.games.export(`棋譜_${S.gameId.slice(0, 8)}.sgf`, recordToSgf(rec));
  if (p) toast('已匯出：' + p, 'ok', 5000);
}

// ---------------- 棋譜重播與覆盤速算 ----------------
async function openReplay(id) {
  const rec = await xk.games.get(id);
  if (!rec) return;
  const full = Game.replay(rec);
  const pl = rec.players && validProfile(rec.players[1]) && validProfile(rec.players[2]) ? { 1: rec.players[1], 2: rec.players[2] } : null;
  S.replay = { rec, full, ply: 0, timer: 0, nums: false };
  setupGame('replay', { size: rec.size, rules: rec.rules, komi: rec.komi, handicap: rec.handicap, setup: rec.setup, first: rec.first, names: { 1: rec.black || '黑方', 2: rec.white || '白方' }, players: pl, mySide: rec.mySide === 'W' ? WHITE : rec.mySide === 'B' ? BLACK : null });
  S.stats = (rec.analysis || []).map((x) => (x ? { wr: x[0], lead: x[1] } : null));
  $('#rpNums').classList.remove('on');
  replayGo(0);
  if (rec.analysis && rec.analysis.length) showMistakes();
  if (full.result) toast(resultText(full.result));
}

function replayGo(ply) {
  const r = S.replay;
  if (!r) return;
  ply = Math.max(0, Math.min(r.full.ply, ply));
  const forward = ply === r.ply + 1 && S.game;
  const g = Game.replay(r.rec, ply);
  r.ply = ply;
  S.game = g;
  if (forward && ply > 0) {
    const m = g.lastMove;
    board.lidCounts = { ...g.captures };
    if (m.i >= 0) { board.placeStone(m.i, m.c, m.cap).then(() => { if (S.game === g) { board.setLastMove(m.i); updateNums(); } }); if (m.cap.length) sfx.capture(m.cap.length); else sfx.move(); }
    else syncBoard();
  } else syncBoard();
  updateNums();
  updateGameUI();
  renderData();
  scheduleLive(250);
}

function updateNums() {
  const r = S.replay;
  if (!r || !r.nums) { board.setNumbers(null); return; }
  const map = new Map();
  S.game.moves.forEach((m, k) => { if (m.i >= 0 && S.game.board.cells[m.i] === m.c) map.set(m.i, k + 1); });
  board.setNumbers(map);
}

function replayAuto() {
  const r = S.replay;
  if (!r) return;
  if (r.timer) { stopReplayAuto(); return; }
  $('#rpPlay').textContent = '⏸';
  r.timer = setInterval(() => {
    if (r.ply >= r.full.ply) { stopReplayAuto(); return; }
    replayGo(r.ply + 1);
  }, 1100);
}
function stopReplayAuto() {
  if (S.replay && S.replay.timer) { clearInterval(S.replay.timer); S.replay.timer = 0; }
  const b = $('#rpPlay'); if (b) b.textContent = '▶';
}

async function replayAnalyze() {
  const r = S.replay;
  if (!r || r.busy) return;
  r.busy = true;
  const btn = $('#rpAnalyze');
  btn.disabled = true;
  const t0 = Date.now();
  try {
    const out = await ai.analyzeGame(r.full, { visits: r.full.size === 19 ? 24 : 40, onProgress: (d, t) => { btn.textContent = `⚡ ${d}/${t}`; } });
    r.rec.analysis = out.map((x) => (x ? [Math.round(x.winrate * 1000) / 1000, Math.round(x.scoreLead * 10) / 10] : null));
    S.stats = out.map((x) => (x ? { wr: x.winrate, lead: x.scoreLead } : null));
    await xk.games.save(r.rec);
    showMistakes();
    renderData();
    toast(`覆盤速算完成：${r.full.ply} 手，用時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`, 'ok', 5000);
    selectTab('data');
  } catch (e) { toast('覆盤失敗：' + errMsg(e), 'err'); }
  finally { r.busy = false; btn.disabled = false; btn.textContent = '⚡ 覆盤速算'; }
}

// 勝率掉最多的著手（疑問手）
function showMistakes() {
  const r = S.replay;
  const box = $('#dpMistakes');
  box.innerHTML = '';
  if (!r) return;
  const st = S.stats, moves = r.full.moves;
  const list = [];
  for (let k = 1; k <= moves.length; k++) {
    if (!st[k - 1] || !st[k]) continue;
    const c = moves[k - 1].c;
    const drop = wrFor(st[k - 1].wr, c) - wrFor(st[k].wr, c);
    if (drop > 0.06) list.push({ k, c, drop, i: moves[k - 1].i });
  }
  list.sort((a, b) => b.drop - a.drop);
  box.append(h('div', { class: 'dp-title' }, `疑問手（勝率下降超過 6%）：${list.length} 手`));
  for (const x of list.slice(0, 12)) {
    box.append(h('button', { class: 'mk-item', onclick: () => replayGo(x.k - 1) },
      h('span', { class: 'stone-dot ' + (x.c === BLACK ? 'b' : 'w') }), `第 ${x.k} 手 ${pointName(x.i, r.full.size)}`, h('b', {}, `−${(x.drop * 100).toFixed(1)}%`)));
  }
  if (!list.length) box.append(h('div', { class: 'muted small' }, '沒有明顯的疑問手，下得很穩！'));
}

// ---------------- 教學、說明 ----------------
function openGuide() {
  if (!guide) guide = new Guide($('#guideBody'), { settings: S.settings, save: (p) => saveSettings(p), onBack: () => showScreen('home') });
  showScreen('guide');
  guide.open(0);
  window.__guide = guide;
}
function openHelp() {
  if (!help) help = new HelpCenter($('#helpBody'), { settings: S.settings, save: (p) => saveSettings(p), onBack: () => showScreen('home') });
  showScreen('help');
  window.__help = help;
}

// ---------------- 關於與更新 ----------------
async function openAbout() {
  const status = h('div', { class: 'upd-status muted' }, '正在檢查是否有新版本…');
  const st = ai.status || {};
  const body = h('div', { class: 'about' },
    h('div', { class: 'about-head' }, h('img', { class: 'about-icon', src: '../../build/icon.png' }),
      h('div', {}, h('h2', {}, '小柯機器人圍棋競賽'), h('div', { class: 'muted' }, `版本 v${S.info.version}　（${S.info.platform === 'darwin' ? 'macOS' : S.info.platform === 'win32' ? 'Windows' : S.info.platform}）`))),
    h('p', { class: 'credit-line' }, CREDIT),
    h('p', { class: 'muted small' }, '3D 圍棋（9／13／19 路）：真人對 AI、真人對真人（本機或遠端＋語音）、AI 對 AI；KataGo 即時勝率與覆盤速算；AI 軍師陪同與代打；棋譜庫與布局學習；動畫語音教學；20 首原創背景音樂。'),
    h('p', { class: 'muted small' }, `AI 引擎：${ai.useKata ? 'KataGo' : '小柯 JS 引擎'}${st.error ? `（${st.error}）` : ''}。KataGo 由 David J Wu（lightvector）與貢獻者開發，MIT 授權；神經網路權重來自 katagotraining.org。`),
    h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: S.settings.autoUpdate !== false, onchange: (e) => saveSettings({ autoUpdate: e.target.checked }) }), ' 開啟程式時自動檢查新版本'),
    status);
  const p = modal('關於與更新', body, [{ label: '關閉', value: false, primary: true }]);
  checkUpdate(true, status);
  await p;
}

async function checkUpdate(manual, statusEl) {
  let info;
  try { info = await xk.update.check(); }
  catch (e) { if (statusEl) statusEl.textContent = '無法檢查更新：' + errMsg(e); return; }
  if (!info.newer) { if (statusEl) statusEl.textContent = `✅ 已經是最新版本（v${info.current}）`; return; }
  const go = () => startUpdate(info);
  if (statusEl) {
    statusEl.innerHTML = '';
    statusEl.append(h('span', {}, `🔔 有新版本 v${info.latest}（目前 v${info.current}）　`), h('button', { class: 'primary', id: 'btnDoUpdate', onclick: () => { $$('.modal-back').forEach((b) => b.remove()); go(); } }, '立即更新'));
    return;
  }
  const v = await modal(`發現新版本 v${info.latest}`, h('div', {}, h('p', {}, `目前版本 v${info.current}，要更新到 v${info.latest} 嗎？`), info.notes ? h('pre', { class: 'upd-notes' }, info.notes) : null), [{ label: '稍後再說', value: false }, { label: '立即更新', value: true, primary: true }]);
  if (v) go();
}

async function startUpdate(info) {
  if (!info.canInstall) {
    const v = await modal('下載新版本', h('p', {}, info.flavor === 'dev' ? '目前是開發版，請到 GitHub 下載安裝檔。' : '找不到這個平台的安裝檔，請到 GitHub 下載。'), [{ label: '取消', value: false }, { label: '開啟下載頁', value: true, primary: true }]);
    if (v) xk.update.openPage();
    return;
  }
  const bar = h('div', { class: 'upd-bar' }, h('div', { class: 'upd-fill' }));
  const txt = h('div', { class: 'muted small' }, '準備下載…');
  const box = h('div', { class: 'upd-box' }, h('b', {}, `正在下載 v${info.latest}`), bar, txt);
  document.body.append(box);
  const off = xk.update.onProgress(({ got, total }) => {
    const p = total ? Math.floor((got / total) * 100) : 0;
    bar.firstChild.style.width = p + '%';
    txt.textContent = `${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB（${p}%）`;
  });
  try {
    const file = await xk.update.download();
    off();
    if (S.game && isPlay()) await saveUnfinished();
    txt.textContent = info.flavor === 'mac' ? '下載完成，正在開啟安裝檔…' : '下載完成，正在安裝，程式會自動重新開啟…';
    const r = await xk.update.install(file);
    if (r.manual) {
      box.remove();
      await modal('請完成安裝', h('div', {}, h('p', {}, '新版安裝檔已開啟（也放在「下載」資料夾）。'), h('p', {}, info.flavor === 'mac' ? '請先結束本程式，再把「小柯機器人圍棋競賽」拖到「應用程式」資料夾覆蓋舊版。' : '請依照畫面指示完成安裝。')));
    }
  } catch (e) { off(); box.remove(); toast('更新失敗：' + errMsg(e), 'err', 8000); }
}

// ---------------- 設定 ----------------
async function openSettings() {
  const s = S.settings;
  const f = {};
  const row = (label, el, tip) => h('div', { class: 'set-row' }, h('label', {}, label), el, tip ? h('div', { class: 'muted small' }, tip) : null);
  f.name = h('input', { value: s.playerName });
  f.sfx = h('input', { type: 'checkbox', checked: s.sfx });
  f.announce = h('input', { type: 'checkbox', checked: s.announce !== false });
  f.autoplay = h('input', { type: 'checkbox', checked: s.music.autoplay });
  f.autoUpdate = h('input', { type: 'checkbox', checked: s.autoUpdate !== false });
  f.proxyLevel = h('select', {}, LEVELS.map((l, i) => h('option', { value: i, selected: i === (s.proxyLevel ?? 4) }, `${l.name}　${l.desc}`)));
  f.key = h('input', { type: 'password', placeholder: s.advisor.hasKey ? '（已設定，留空表示不變更）' : 'sk-ant-…' });
  f.model = h('select', {}, ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'].map((m) => h('option', { value: m, selected: s.advisor.model === m }, m)));
  f.effort = h('select', {}, [['low', '快速（low）'], ['medium', '一般（medium）'], ['high', '深入（high）']].map(([v, l]) => h('option', { value: v, selected: s.advisor.effort === v }, l)));
  f.srvMode = h('select', {}, h('option', { value: 'public', selected: s.server.mode !== 'custom' }, '公用配對伺服器（PeerJS Cloud）'), h('option', { value: 'custom', selected: s.server.mode === 'custom' }, '自架伺服器'));
  f.host = h('input', { value: s.server.host, placeholder: '例如 peer.example.com' });
  f.port = h('input', { value: s.server.port, type: 'number', style: { width: '90px' } });
  f.path = h('input', { value: s.server.path, style: { width: '90px' } });
  f.secure = h('input', { type: 'checkbox', checked: s.server.secure });
  f.stun = h('textarea', { rows: 2, value: s.stun });
  f.turnUrls = h('input', { value: s.turn.urls, placeholder: 'turn:turn.example.com:3478' });
  f.turnUser = h('input', { value: s.turn.username, placeholder: '帳號' });
  f.turnPass = h('input', { type: 'password', value: s.turn.credential, placeholder: '密碼' });
  const testOut = h('div', { class: 'muted small' });
  const updStatus = h('div', { class: 'upd-status muted small', id: 'setUpdStatus' }, '按「檢查更新」查詢 GitHub 上的最新版本');
  const body = h('div', { class: 'settings' },
    h('h4', {}, '一般'),
    row('我的暱稱', f.name),
    row('音效', h('label', { class: 'chk' }, f.sfx, ' 落子、提子、叫吃音效')),
    row('對局語音播報', h('label', { class: 'chk' }, f.announce, ' 叫吃、提子、打劫、停一手、終局時用語音提醒')),
    row('背景音樂', h('label', { class: 'chk' }, f.autoplay, ' 開啟程式後自動播放')),
    row('版本更新', h('label', { class: 'chk' }, f.autoUpdate, ' 開啟程式時自動檢查新版本')),
    row(`目前版本 v${S.info.version}`, h('div', { class: 'inline' }, h('button', { id: 'btnCheckUpdate', onclick: () => { updStatus.textContent = '正在檢查是否有新版本…'; checkUpdate(true, updStatus); } }, '🔄 檢查更新'), updStatus)),
    row('半身照與 AI 軍師', h('button', { onclick: async () => { await ensureProfile(true); } }, '更換半身照與軍師')),
    row('軍師代打的棋力', f.proxyLevel, '暫時離開時，AI 軍師用這個難度替您下棋。'),
    h('h4', {}, 'AI 軍師（Claude）'),
    row('Anthropic API 金鑰', f.key, s.advisor.envKey && !s.advisor.hasKey ? '已偵測到環境變數 ANTHROPIC_API_KEY。' : '金鑰會加密存在本機，只用來呼叫 Claude。沒有金鑰時軍師仍會提供 KataGo 的分析。'),
    row('模型', f.model),
    row('思考深度', f.effort),
    h('div', { class: 'set-row' }, h('label', {}, ''), h('button', { onclick: async () => { testOut.textContent = '測試中…'; await applySettings(f); const r = await xk.advisor.test(); testOut.textContent = r.ok ? `✅ ${r.text}` : `❌ ${r.error}`; } }, '測試金鑰'), testOut),
    h('h4', {}, '遠端對弈連線'),
    row('配對伺服器', f.srvMode),
    row('自架伺服器', h('div', { class: 'inline' }, f.host, f.port, f.path, h('label', { class: 'chk' }, f.secure, ' HTTPS'))),
    row('STUN', f.stun),
    row('TURN（跨網路連不上時）', h('div', { class: 'inline' }, f.turnUrls, f.turnUser, f.turnPass)),
    h('p', { class: 'credit-line small' }, `小柯機器人圍棋競賽 v${S.info.version}．${CREDIT}`),
  );
  const ok = await modal('設定', body, [{ label: '取消', value: false }, { label: '儲存', value: true, primary: true }]);
  if (ok) { await applySettings(f); toast('設定已儲存', 'ok'); renderHome(); }
}

async function applySettings(f) {
  const patch = {
    playerName: f.name.value.trim() || '棋友',
    sfx: f.sfx.checked,
    announce: f.announce.checked,
    autoUpdate: f.autoUpdate.checked,
    proxyLevel: Number(f.proxyLevel.value),
    music: { autoplay: f.autoplay.checked },
    advisor: { model: f.model.value, effort: f.effort.value },
    server: { mode: f.srvMode.value, host: f.host.value.trim(), port: Number(f.port.value) || 9000, path: f.path.value.trim() || '/', secure: f.secure.checked },
    stun: f.stun.value,
    turn: { urls: f.turnUrls.value.trim(), username: f.turnUser.value.trim(), credential: f.turnPass.value },
  };
  if (f.key.value.trim()) patch.advisor.apiKey = f.key.value.trim();
  await saveSettings(patch);
  f.key.value = '';
  setSfx(S.settings.sfx);
  voice.enabled = S.settings.announce !== false;
  advisor.setHasKey(S.settings.advisor.hasKey);
}

window.addEventListener('beforeunload', () => { closeNet(); });
window.addEventListener('resize', () => drawGraph());
init().catch((e) => { console.error(e); document.body.append(h('pre', { class: 'fatal' }, '啟動失敗：' + (e.stack || e))); });
