// AI 軍師小視窗：KataGo 分析（勝率、目差、候選著法、形勢）＋（有金鑰時）Claude 白話解說
import { h, uid } from './util.js';
import { BLACK, WHITE, PASS, colorName, pointName, boardText, deadFromOwnership } from './go.js';
import { wrFor, leadFor } from './ai.js';

const QUICK = [
  ['下一手下哪裡？', '現在輪到我，下一手下哪裡比較好？為什麼？'],
  ['形勢如何？', '請判斷目前的形勢：誰領先、各有哪些地和勢、哪裡是急所？'],
  ['對方想幹嘛？', '對方上一手的意圖是什麼？我要注意哪些威脅？'],
  ['哪塊棋有危險？', '盤面上有沒有還沒活的棋或快被吃掉的棋？要怎麼處理？'],
];

const pct = (x) => (x * 100).toFixed(1) + '%';
const lead = (x) => (x >= 0 ? `領先 ${x.toFixed(1)} 目` : `落後 ${(-x).toFixed(1)} 目`);

export class AdvisorPanel {
  // ctx(): { game, mySide(BLACK/WHITE 或 null＝觀戰), analyze(game) → Promise<分析>, showHint(i) }
  constructor(root, ctx) {
    this.root = root;
    this.ctx = ctx;
    this.history = [];
    this.busy = null;
    this.hasKey = false;
    this.build();
    xk.advisor.onDelta((d) => { if (this.busy && d.id === this.busy.id) { this.busy.text += d.text; this.busy.el.textContent = this.busy.text; this.scroll(); } });
    xk.advisor.onDone((d) => this.onDone(d));
  }

  setAdvisor(label, url) {
    this.nameEl.textContent = label || '小柯軍師';
    if (url) this.avEl.src = url;
    this.avEl.classList.toggle('hidden', !url);
  }

  setHasKey(v) {
    this.hasKey = v;
    this.modeEl.textContent = v ? '🟢 Claude 軍師（線上）＋KataGo' : '⚪ 離線軍師（本機引擎）';
    this.modeEl.title = v ? '使用 Claude 以白話解說 KataGo 的分析' : '尚未設定 Anthropic API 金鑰，只提供引擎的分析。可到「設定」輸入金鑰。';
  }

  build() {
    this.modeEl = h('div', { class: 'adv-mode' });
    this.avEl = h('img', { class: 'adv-portrait', alt: '' });
    this.nameEl = h('b', {}, '小柯軍師');
    this.btnChange = h('button', { class: 'link small adv-change', title: '中途換一位 AI 軍師', onclick: () => this.onChange && this.onChange() }, '換軍師');
    this.log = h('div', { class: 'adv-log' });
    this.input = h('textarea', { class: 'adv-input', rows: 2, placeholder: '問軍師，例如：右下角的白棋活了嗎？（Enter 送出）', onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); } } });
    this.btnSend = h('button', { class: 'primary', onclick: () => this.send() }, '請教');
    this.root.append(
      h('div', { class: 'adv-head' }, this.avEl, h('div', { class: 'adv-who' }, h('div', {}, this.nameEl, ' ', this.btnChange), this.modeEl)),
      this.log,
      h('div', { class: 'adv-quick' }, QUICK.map(([label, q]) => h('button', { class: 'chip', onclick: () => this.send(q) }, label))),
      h('div', { class: 'adv-send' }, this.input, this.btnSend),
    );
    this.say('ai', '您好！我是您的 AI 軍師。比賽中隨時可以問我，我會先請 KataGo 算一遍勝率與候選著法，再用白話告訴您建議和理由。');
  }

  reset() {
    this.history = [];
    this.log.innerHTML = '';
    this.say('ai', '新的一局開始了，需要建議隨時叫我！');
  }

  say(who, text) {
    const el = h('div', { class: 'adv-msg ' + who }, text);
    this.log.append(el);
    this.scroll();
    return el;
  }

  scroll() { this.log.scrollTop = this.log.scrollHeight; }

  pvText(game, pv, n = 6) {
    let c = game.turn;
    const out = [];
    for (const i of pv.slice(0, n)) { out.push(`${colorName(c)} ${pointName(i, game.size)}`); c = 3 - c; }
    return out.join('、');
  }

  async buildContext() {
    const { game: g, mySide } = this.ctx();
    const n = g.size;
    const a = g.result ? null : await this.ctx().analyze(g);
    const me = mySide || g.turn;
    const toMove = g.turn;
    const recent = g.moves.slice(-12).map((m, k) => `${g.ply - Math.min(12, g.ply) + k + 1}. ${colorName(m.c)} ${pointName(m.i, n)}${m.cap && m.cap.length ? `（提 ${m.cap.length} 子）` : ''}`).join('\n');
    const lines = [
      '【局面資訊】',
      `${n} 路圍棋，${g.rules === 'japanese' ? '日韓規則（數目）' : '中國規則（數子）'}，貼目 ${g.komi}${g.handicap ? `，讓 ${g.handicap} 子` : ''}。`,
      mySide ? `您執${colorName(mySide)}。現在輪到${colorName(toMove)}${toMove === mySide ? '（輪到您）' : '（對方思考中）'}，已下 ${g.ply} 手。` : `觀戰中（AI 對 AI）。現在輪到${colorName(toMove)}，已下 ${g.ply} 手。`,
      `提子：黑提了 ${g.captures[BLACK]} 子、白提了 ${g.captures[WHITE]} 子。`,
      '棋盤（x＝黑、o＝白、大寫＝最後一手、.＝空）：',
      boardText(g.board, g.lastMove ? g.lastMove.i : -1),
      recent ? `最近的著手：\n${recent}` : '（還沒有人下）',
    ];
    if (a) {
      lines.push(`KataGo 分析（${a.engine}，計算量 ${a.visits}）：${colorName(me)}方勝率 ${pct(wrFor(a.winrate, me))}，${colorName(me)}方${lead(leadFor(a.scoreLead, me))}。`);
      lines.push(`候選著法（${toMove === me ? '給您參考' : '對方可能下的'}；勝率以${colorName(toMove)}方計）：`);
      a.moves.slice(0, 5).forEach((m, k) => {
        lines.push(`${k + 1}. ${pointName(m.i, n)}　勝率 ${pct(wrFor(m.winrate, toMove))}　目差 ${leadFor(m.scoreLead, toMove).toFixed(1)}　計算量 ${m.visits}　預想：${this.pvText(g, m.pv)}`);
      });
      if (a.ownership) {
        let b = 0, w = 0;
        for (const v of a.ownership) { if (v > 0.3) b++; else if (v < -0.3) w++; }
        const dead = deadFromOwnership(g.board, a.ownership);
        const deadB = [], deadW = [];
        for (const i of dead) (g.board.cells[i] === BLACK ? deadB : deadW).push(pointName(i, n));
        lines.push(`形勢估計（每點歸屬）：黑方大約 ${b} 點、白方大約 ${w} 點。`);
        if (deadB.length || deadW.length) lines.push(`可能已經死掉的棋子：${deadB.length ? '黑 ' + deadB.slice(0, 20).join(' ') : ''}${deadB.length && deadW.length ? '；' : ''}${deadW.length ? '白 ' + deadW.slice(0, 20).join(' ') : ''}`);
      }
    } else lines.push('（對局已經結束）');
    return { text: lines.join('\n'), a, g, me, mine: !!mySide && toMove === mySide };
  }

  async send(q) {
    const question = (q || this.input.value).trim();
    if (!question || this.busy) return;
    this.input.value = '';
    this.say('me', question);
    const pending = this.say('ai thinking', '軍師正在計算局面…');
    let c;
    try { c = await this.buildContext(); } catch (e) { pending.textContent = '分析失敗：' + e.message; pending.classList.remove('thinking'); return; }
    if (c.mine && c.a && c.a.moves[0]) this.ctx().showHint(c.a.moves[0].i);
    if (!this.hasKey) {
      pending.classList.remove('thinking');
      pending.textContent = this.offlineAnswer(c);
      this.scroll();
      return;
    }
    pending.textContent = '';
    pending.classList.add('streaming');
    const id = uid();
    this.busy = { id, el: pending, text: '', question };
    this.btnSend.textContent = '停止';
    this.btnSend.onclick = () => xk.advisor.cancel(id);
    const userMsg = { role: 'user', content: `${c.text}\n\n【我的問題】${question}` };
    this.busy.userMsg = userMsg;
    this.busy.offline = this.offlineAnswer(c);
    xk.advisor.ask(id, { messages: [...this.history.slice(-12), userMsg] });
  }

  onDone(d) {
    const b = this.busy;
    if (!b || d.id !== b.id) return;
    this.busy = null;
    this.btnSend.textContent = '請教';
    this.btnSend.onclick = () => this.send();
    b.el.classList.remove('thinking', 'streaming');
    if (d.error) {
      if (d.error === 'cancelled') { b.el.textContent = (b.text || '') + '（已停止）'; return; }
      if (d.error === 'nokey') { this.setHasKey(false); b.el.textContent = b.offline; return; }
      b.el.textContent = `${b.offline}\n\n⚠ ${d.error}`;
      return;
    }
    const text = d.text || b.text;
    b.el.textContent = text + (d.truncated ? '…' : '');
    this.history.push(b.userMsg, { role: 'assistant', content: text });
    this.scroll();
  }

  offlineAnswer(c) {
    const { a, g, me } = c;
    if (!a) return '這盤已經結束了，可以到「棋譜庫」重播，或按「覆盤速算」看每一手的勝率變化。';
    const n = g.size;
    const wr = wrFor(a.winrate, me), ld = leadFor(a.scoreLead, me);
    const judge = wr > 0.85 ? '您大幅領先，穩穩收官就好。' : wr > 0.6 ? '您目前占優。' : wr > 0.4 ? '雙方大致均勢。' : wr > 0.15 ? '您稍微落後，要找機會。' : '形勢不利，可以考慮在對方的地裡製造糾紛。';
    const best = a.moves[0];
    if (!best) return `${colorName(me)}方勝率 ${pct(wr)}，${lead(ld)}。${judge}`;
    const alts = a.moves.slice(1, 3).map((m) => `${pointName(m.i, n)}（${pct(wrFor(m.winrate, g.turn))}）`).join('、');
    if (c.mine) {
      return `建議下「${pointName(best.i, n)}」（下完勝率 ${pct(wrFor(best.winrate, me))}）。\n目前${colorName(me)}方勝率 ${pct(wr)}，${lead(ld)}。${judge}\n預想變化：${this.pvText(g, best.pv)}${alts ? `\n其他可考慮：${alts}` : ''}\n（棋盤上閃爍的綠圈就是建議位置）`;
    }
    return `現在是${colorName(g.turn)}方下。KataGo 預測會下「${pointName(best.i, n)}」，預想變化：${this.pvText(g, best.pv)}。\n${colorName(me)}方勝率 ${pct(wr)}，${lead(ld)}。${judge}`;
  }
}

export { PASS };
