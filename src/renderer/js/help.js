// 功能說明：每一項系統功能都有文字說明，按 🔊 就用語音念給您聽（也可以全部連續朗讀）
import { h, $$ } from './util.js';
import { voice } from './voice.js';

export const TOPICS = [
  ['🎯', '開始比賽', [
    '第一次使用時，請先選一張自己的半身照，再選一位陪同參賽的 AI 軍師。首頁左上角的頭像卡可以隨時更換。',
    '首頁有三種參賽方式：真人對 AI、真人對真人、AI 對 AI。可以選棋盤大小（九路、十三路、十九路）、規則（中國數子或日韓數目）和讓子數。',
    '真人對真人可以在同一台電腦輪流下，也可以建立房間、把六位數房號告訴遠端的朋友來加入。',
  ]],
  ['🖱', '下棋操作', [
    '輪到您的時候，滑鼠移到棋盤上會出現半透明的棋子，點一下就落子。不能下的位置會告訴您原因，例如禁著點或打劫。',
    '左側按鈕：停一手、提示、軍師代打、悔棋、形勢判斷、認輸。右鍵拖曳可以旋轉棋盤，滾輪可以縮放，上方可以切換斜視、俯視、立體三種視角。',
    '被提掉的棋子會飛進提子方的棋蓋裡，玩家卡片上也會顯示提子數。',
  ]],
  ['📊', '勝率數據', [
    '比賽時，內建的 KataGo 圍棋引擎會在背景計算每一手之後的勝率和目差，顯示在右側「數據」分頁。',
    '勝率條顯示黑白雙方的勝率；目差表示目前誰領先幾目；勝率曲線可以看出整盤棋的起伏，哪一手讓形勢逆轉一目了然。',
    '候選著法表列出引擎考慮的下法、每一手的勝率、計算量和目差。打開「棋盤顯示建議點」，候選位置會直接標在棋盤上，最好的那一手是藍色。',
    '「形勢判斷」會把每個交叉點預測歸屬哪一方標成黑白小方塊，可以看出雙方大概的地盤。',
  ]],
  ['🧙', 'AI 軍師', [
    'AI 軍師在右側「軍師」分頁。可以直接打字問問題，或按快速按鈕：下一手下哪裡、形勢如何、對方想幹嘛、哪塊棋有危險。',
    '暫時要離開時，按「軍師代打」，主位就由軍師接手替您下棋；回來後按「交還主位」，就換回自己下。遠端的對手也會看到主位換人了。',
    '比賽中可以按「換軍師」，從三十位 AI 軍師中換一位陪您繼續比賽。',
    '在「設定」輸入 Anthropic API 金鑰後，軍師會用 Claude 以白話解說引擎的分析；沒有金鑰時也會提供引擎的建議。',
  ]],
  ['🌐', '遠端對戰', [
    '在首頁「真人對真人」按「建立房間」，畫面會出現六位數房號。請朋友在他的電腦輸入房號、按「加入房間」就能開始。',
    '對局中可以文字聊天，也可以按「語音通話」用麥克風對話；通話時背景音樂會自動調小聲。',
    '連線中斷時對局會暫停，對方重新加入同一個房號就能接著下。悔棋和再來一局需要對方同意。',
  ]],
  ['🏁', '終局與數子', [
    '雙方連續停一手，對局就結束。電腦會用引擎判斷哪些棋子已經死了，死子會變成半透明，雙方的地用小方塊標出來。',
    '如果您覺得死活判斷不對，可以直接點棋子切換死活；也可以按「有異議，繼續下」回到對局，用實戰解決。',
    '中國規則數子：活子加地，黑棋貼 7.5 點。日韓規則數目：地加提子，黑棋貼 6.5 目。',
  ]],
  ['📜', '棋譜庫與覆盤速算', [
    '每下完一局，棋譜都會自動收進棋譜庫，可以重播、匯出成 SGF 檔，也可以刪除。',
    '可以匯入 SGF 棋譜檔，一次選很多個檔案，或選整個資料夾，裡面所有的棋譜都會收進來。',
    '棋譜累積越多，AI 越會參考棋譜庫裡的布局下法；數據分頁也會顯示這個局面在棋譜庫裡出現過幾次、大家常下哪裡。',
    '重播時按「覆盤速算」，KataGo 會快速算出每一手的勝率，並把勝率掉最多的「疑問手」列出來，點一下就跳到那一手。',
  ]],
  ['📖', '圍棋教學', [
    '首頁的「圍棋教學」從棋盤、氣、提子開始，一路教到打劫、死活、征子、倒撲、布局和數子。',
    '每一課都有動畫棋盤和語音講解，講完會自動接下一課；課程最後有練習題，點錯會告訴您原因，也可以按「看答案」。',
  ]],
  ['♫', '背景音樂與音效', [
    '內建二十首原創背景音樂，每首三分多鐘。對局畫面上方的「背景音樂」按鈕，滑鼠移上去會出現直立的音量滑桿，往上大聲、往下小聲。',
    '「落子」按鈕控制落子音效的音量，也是直立滑桿。按一下圖示可以靜音或恢復。',
    '音樂分頁可以選曲、隨機播放，也可以加入自己的音樂檔。',
  ]],
  ['🔊', '對局語音播報', [
    '開啟「對局語音播報」後，對局中出現叫吃、提子、打劫、停一手、終局結果時，會用中文語音提醒您。可以在「設定」裡開關。',
  ]],
  ['🔄', '版本更新與設定', [
    '程式開啟時會自動檢查 GitHub 上有沒有新版本；有新版會詢問是否更新，下載完成後自動安裝並重新開啟，棋譜和設定都會保留。線上版只要重新整理網頁就是最新版，棋譜存在這台裝置的瀏覽器裡。',
    '也可以在「設定」或「關於與更新」按「檢查更新」。設定裡還可以改暱稱、音效、代打棋力、AI 軍師金鑰和遠端連線伺服器。',
  ]],
  ['🤖', 'AI 引擎與難度', [
    '本程式內建開源的 KataGo 圍棋引擎：快速網路負責對局與即時勝率，深度網路負責「大師」難度。電腦無法執行 KataGo 時，會自動改用小柯 JS 引擎。',
    '難度從入門、初級、中級、高級、專家到大師。入門和初級會下得比較隨性，大師每手大約思考五秒，棋力達職業水準。',
  ]],
];

export class HelpCenter {
  constructor(root, { onBack, settings, save }) {
    this.root = root;
    this.onBack = onBack;
    this.save = save;
    this.token = 0;
    this.build();
  }

  build() {
    this.root.innerHTML = '';
    this.state = h('span', { class: 'muted small' });
    this.list = h('div', { class: 'help-list' });
    TOPICS.forEach(([icon, title, paras], k) => {
      const card = h('section', { class: 'help-card', 'data-k': k },
        h('div', { class: 'help-title' }, h('span', { class: 'help-icon' }, icon), h('h3', {}, title),
          h('button', { class: 'help-say', title: '用語音念這一項', onclick: () => this.read([k]) }, '🔊 朗讀')),
        ...paras.map((p) => h('p', {}, p)));
      this.list.append(card);
    });
    this.root.append(
      h('div', { class: 'gd-head' }, h('button', { class: 'ghost', onclick: () => this.close() }, '⟵ 首頁'), h('h2', {}, '🔊 功能說明'),
        h('button', { class: 'primary', id: 'helpAll', onclick: () => this.read(TOPICS.map((_, i) => i)) }, '▶ 全部朗讀'),
        h('button', { id: 'helpStop', onclick: () => this.stop() }, '⏹ 停止'), this.state),
      h('p', { class: 'muted help-intro' }, '每一項功能都有文字說明；按「🔊 朗讀」會用中文語音念給您聽。'),
      this.list);
    if (!voice.available) this.state.textContent = '（這台裝置沒有中文語音，請閱讀文字說明）';
  }

  async read(keys) {
    const tok = ++this.token;
    voice.stop();
    for (const k of keys) {
      const card = this.list.querySelector(`[data-k="${k}"]`);
      $$('.help-card', this.list).forEach((c) => c.classList.toggle('reading', c === card));
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const [, title, paras] = TOPICS[k];
      this.state.textContent = `正在朗讀：${title}`;
      await voice.speak(title + '。' + paras.join(''));
      if (tok !== this.token) return;
    }
    $$('.help-card', this.list).forEach((c) => c.classList.remove('reading'));
    this.state.textContent = '';
  }

  stop() { this.token++; voice.stop(); $$('.help-card', this.list).forEach((c) => c.classList.remove('reading')); this.state.textContent = ''; }
  close() { this.stop(); this.onBack && this.onBack(); }
}
