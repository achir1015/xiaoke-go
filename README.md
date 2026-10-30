# 小柯機器人圍棋競賽

3D 立體圍棋對弈程式：內建 KataGo 引擎即時顯示勝率，AI 軍師陪同參賽，棋譜累積與覆盤速算，動畫語音教學。

**遊戲開發：吳玉柱 先生 與 Claude AI Opus 5.5**

## 下載

到 [Releases](https://github.com/achir1015/xiaoke-go/releases/latest) 下載：

| 平台 | 檔案 |
| --- | --- |
| Windows 11（安裝版） | `XiaokeGo-版本-win-x64.exe` |
| Windows 11（免安裝） | `XiaokeGo-版本-win-x64-portable.exe` |
| MacBook Pro（Intel） | `XiaokeGo-版本-mac-x64.dmg` |
| MacBook Pro（Apple 晶片 M1～） | `XiaokeGo-版本-mac-arm64.dmg` |
| Android 手機 | `XiaokeGo-版本-android.apk` |
| iPad／iPhone | 用 Safari 開 [安裝頁](https://achir1015.github.io/xiaoke-go/ios/) 按「安裝」（限已登記的裝置） |

Mac 第一次開啟：把程式拖進「應用程式」後，在程式上按右鍵 →「打開」→ 再按「打開」（程式沒有 Apple 公證，只需要第一次這樣做）。

線上版（網頁）會接著推出。

## 功能

- **3D 棋盤與棋子**：榧木棋盤（含盤腳）、蛤碁石質感棋子、棋罐與棋蓋，提子會飛進棋蓋；斜視、俯視、立體三種視角。
- **參賽方式**：真人對 AI（入門、初級、中級、高級、專家、大師）、真人對真人（同一台電腦，或建立房號邀約遠端棋友，含文字與語音聊天）、AI 對 AI 觀戰。
- **棋盤與規則**：9／13／19 路；中國規則數子（貼 7.5）、日韓規則數目（貼 6.5）；讓 2～9 子。
- **勝率數據**：KataGo 在背景計算每一手的勝率、目差、勝率曲線、候選著法（勝率／計算量／目差）與形勢判斷。
- **AI 軍師**：開賽前從 30 位軍師中選一位陪同；可請教下一手與形勢；暫時離開時由軍師代打，回來「交還主位」；中途可換軍師。設定 Anthropic API 金鑰後由 Claude 白話解說。
- **半身照**：男 20 位、女 20 位、AI 軍師 30 位。
- **終局數子**：雙方停一手後自動判斷死活並數子，可點棋子修正死活，有異議可繼續下。
- **棋譜庫**：自動收錄每一局；匯入 SGF（多檔或整個資料夾）、匯出 SGF、重播、顯示手數；「覆盤速算」一鍵算出每一手的勝率並列出疑問手；AI 會參考棋譜庫的布局下法（同一定式八個方向都查得到）。
- **圍棋教學**：12 課（棋盤、氣、提子、連接、叫吃、禁著點、打劫、死活、征子、倒撲、布局、數子、操作），動畫棋盤＋語音講解＋練習題。
- **功能說明**：每項系統功能都有文字說明，可單項或全部語音朗讀；對局中叫吃、提子、打劫、停一手會語音播報。
- **背景音樂**：20 首原創曲（每首 3 分多鐘），直立音量滑桿，可加入自己的音樂。
- **自動更新**：開啟時檢查 GitHub 最新版本，下載後自動安裝。

## 開發

```bash
npm install
node scripts/fetch-engine.mjs
npm start
```

- 測試：`npm test`（規則、課程、軍師提示詞）、`node e2e/smoke.mjs`、`node e2e/net.mjs`
- 打包：`npm run dist:win`
- 資源：`npm run music`（背景音樂）、`npm run portraits`（半身照）、`npm run icon`（圖示）

## 授權與致謝

- 本程式：MIT 授權。
- [KataGo](https://github.com/lightvector/KataGo)：David J Wu（lightvector）與貢獻者，MIT 授權；神經網路權重來自 [katagotraining.org](https://katagotraining.org)。
- 參考資源：[Coderchen-001/AI_GO](https://github.com/Coderchen-001/AI_GO)（Lizzieyzy＋KataGo 整合包）。
