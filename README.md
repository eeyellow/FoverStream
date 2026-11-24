# FoveaStream - 無邊框四視窗串流播放器

專為多直播同時收看設計的無邊框極簡播放器。整合 Streamlink 串流解析、HLS / MPEG-TS 硬體加速解碼、YouTube 原生劇院模式與內建網頁瀏覽器，支援 4 台直播無縫並行收看。

## ✨ 核心特性

- **無邊框極簡介面 (Borderless Frameless)**：移除傳統標題列與邊框，沉浸式深色視覺；頂部導航列支援任意拖曳移動視窗，全螢幕下移至頂端自動滑出。
- **四視窗多元播放核心**：
  - 支援 Twitch、Kick、AfreecaTV 等所有 Streamlink 支援平台，亦可直接輸入 `.m3u8` 直播源。
  - YouTube 直播與影片自動啟用原生滿版劇院模式並支援自動略過廣告。
  - 支援內建網頁瀏覽器模式（一般網址或未支援平台自動退回網頁模式，具備上下頁導覽）。
- **智慧畫質與多元佈局**：
  - 支援 `2x2` 四分割、`左1+3`、`上1+3`、`下1+3` 焦點佈局，以及雙擊單台放大（Solo Mode）。
  - 焦點主台自動切換高畫質（Best / 1080p），副台自動降級省頻寬（480p / 360p）。
- **智慧音訊管理 (Audio Focus Follow)**：
  - 滑鼠懸停或點選哪一台即自動獨占音訊、其餘靜音；全體靜音（`M`）解除時自動還原先前出聲的頻道。
- **多組頻道分組記憶 (Presets)**：
  - 內建 3 組獨立頻道分組切換與原子化持久化儲存，下次啟動自動還原上次佈局、分組、網址與音量。
- **VLC 外部連動 & 常駐最上層**：
  - 單鍵呼叫系統 VLC 獨立開啟當前串流；支援視窗釘選最上層（`T`）。

## 📂 專案架構

```text
FoveaStream/
├── src/
│   ├── main/                 # Electron 主程序 (視窗防護、IPC 註冊、服務層)
│   │   └── services/         # Streamlink 伺服器池、執行檔偵測、設定持久化、VLC/YT 服務
│   ├── preload/              # Context Isolation 安全預載橋接層
│   └── renderer/             # 原生 ES Modules 渲染層 (免編譯零建置)
│       ├── components/       # StreamManager、StreamSlot、非阻塞 Toast
│       ├── players/          # HlsPlayer、MpegtsPlayer、YouTubePlayer、WebpagePlayer
│       ├── styles/           # 模組化樣式表 (variables / titlebar / grid / slot / modal)
│       └── utils/            # 網址解析與智慧畫質匹配純函式
├── streamlink-plugins/       # 自動掛載之額外 Streamlink 外掛 (--plugin-dir)
└── tests/                    # 自動化單元測試與 Electron 冒煙測試
```

## ⌨️ 常用快捷鍵

| 快捷鍵 | 功能 |
|---|---|
| `1` ~ `4` | 單獨放大 / 還原 第 1 ~ 4 台畫面 (Solo) |
| `Ctrl` + `1` ~ `4` | 指定第 1 ~ 4 台為焦點大主畫面 |
| `Shift` + `1` ~ `4` | 切換佈局 (`2x2` / `左1+3` / `上1+3` / `下1+3`) |
| `Alt` + `1` ~ `4` | 獨占第 1 ~ 4 台音訊（其他台靜音） |
| `Tab` / `L` | 輪替大主畫面 / 循環切換佈局 |
| `A` / `M` | 開關音訊跟隨滑鼠焦點 / 全體靜音與還原 |
| `↑` / `↓` / `Space` | 調整音量 (`±10%`) / 播放與暫停焦點台 |
| `F` / `F11` / `Esc` | 純淨全螢幕切換 / 退出全螢幕、Solo 或換台面板 |
| `T` / `R` / `S` | 常駐最上層 / 重新連線全部 / 儲存當前分組 |
| `?` / `H` / `F1` | 開啟快速鍵說明面板 |

## 🚀 啟動與開發

### 首次環境設定

1. 安裝 [Node.js](https://nodejs.org/)（建議 LTS 20+）。
2. 安裝 [Streamlink](https://streamlink.github.io/install.html)（「所有使用者」或「僅為我安裝」皆會自動偵測；亦可放置免安裝版於 `resources/bin/streamlink/`）。
3. *(選用)* 安裝 [VLC](https://www.videolan.org/) 以啟用「在 VLC 開啟」功能。
4. 安裝相依套件：
   ```bash
   npm install
   ```

> 額外的 Streamlink 外掛（如 `chaturbate.py`）置於 `streamlink-plugins/` 目錄，啟動時會自動透過 `--plugin-dir` 載入。

### 啟動與測試

```bash
# 啟動應用程式 (或直接雙擊 start.bat)
npm start

# 執行單元測試
npm test

# 執行 Electron 視窗啟動冒煙測試
npm run test:smoke
```

### 疑難排解

- **視窗黑畫面**：部分 Windows Insider 組建的 Chromium 沙箱不相容時，主程序會自動偵測並以 `--no-sandbox` 重啟；若顯示卡驅動異常亦可執行 `npm start -- --disable-gpu`。
- **串流網址被當成網頁開啟**：代表 Streamlink 無法解析該網址（頻道未開台或缺少外掛），可執行 `streamlink --plugin-dir streamlink-plugins --json <網址>` 檢查。
