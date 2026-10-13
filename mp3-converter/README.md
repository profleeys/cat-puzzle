# 🎵 MP3 轉換器

將音訊/視訊檔案或 YouTube 影片轉換為 MP3，並可擷取指定時間區間。

## 功能

- 📂 **上傳本地檔案**：支援 MP3、MP4、WAV、FLAC、AAC、MKV、MOV 等（最大 500 MB）
- ▶️ **YouTube 下載轉換**：貼上 YouTube URL 直接下載音訊並轉為 MP3
- ✂️ **區間擷取**：啟用後可用視覺化時間軸拖曳，或手動輸入開始/結束時間
- ⬇️ **一鍵下載**：轉換完成後自動觸發瀏覽器下載

## 安裝需求

1. **Node.js** v18+（已確認 v24 可用）
2. **yt-dlp**（用於 YouTube 下載功能）：
   - 下載：https://github.com/yt-dlp/yt-dlp/releases
   - 將 `yt-dlp.exe` 放到系統 PATH，或放在此專案資料夾內

## 啟動步驟

```bash
cd mp3-converter
npm install       # 只需執行一次
node server.js    # 啟動伺服器
```

開啟瀏覽器：http://localhost:3000

## 技術架構

| 層級 | 技術 |
|------|------|
| 前端 | 純 HTML5 + CSS3 + Vanilla JS |
| 後端 | Node.js + Express |
| 音訊轉換 | ffmpeg（via `@ffmpeg-installer/ffmpeg`）|
| YouTube | yt-dlp（需另行安裝）|
| 暫存清理 | 伺服器每 30 分鐘自動刪除舊檔案 |

## 注意事項

- 上傳的檔案與輸出 MP3 均為暫存，處理完後會自動刪除
- YouTube 功能需要本機安裝 `yt-dlp`
- 若 YouTube 下載失敗，請先確認 `yt-dlp` 是否在 PATH 中

