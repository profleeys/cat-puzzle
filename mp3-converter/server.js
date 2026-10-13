const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

// 路徑優先讀環境變數，本機 Windows 開發時設定 .env 或直接在此修改預設值
const isWin = process.platform === 'win32';
const FFMPEG_PATH  = process.env.FFMPEG_PATH  || (isWin ? 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe'  : '/usr/bin/ffmpeg');
const FFPROBE_PATH = process.env.FFPROBE_PATH || (isWin ? 'C:\\Tools\\ffmpeg\\bin\\ffprobe.exe' : '/usr/bin/ffprobe');
const PORT         = process.env.PORT          || 3000;

// YTDLP_PATH 若為相對路徑（如 ./bin/yt-dlp），以 __dirname 為基準轉成絕對路徑
const _ytdlpRaw  = process.env.YTDLP_PATH || (isWin ? 'C:\\Tools\\yt-dlp\\yt-dlp.exe' : './bin/yt-dlp');
const YTDLP_PATH = path.isAbsolute(_ytdlpRaw) ? _ytdlpRaw : path.resolve(__dirname, _ytdlpRaw);


ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

const app = express();

// Directories
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const OUTPUT_DIR = path.join(__dirname, 'outputs');
[UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Multer setup: accept audio/video files up to 500MB
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }
});

// ─── Helper: convert file → mp3 with optional trim ──────────────────────────
function convertToMp3(inputPath, outputPath, startSec, endSec) {
  return new Promise((resolve, reject) => {
    let cmd = ffmpeg(inputPath).audioCodec('libmp3lame').audioBitrate('192k');

    if (startSec != null && startSec >= 0) {
      cmd = cmd.setStartTime(startSec);
    }
    if (endSec != null && endSec > 0) {
      const duration = (startSec != null && startSec >= 0)
        ? endSec - startSec
        : endSec;
      if (duration > 0) cmd = cmd.setDuration(duration);
    }

    cmd
      .output(outputPath)
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}

// ─── Probe: get media duration ───────────────────────────────────────────────
function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration || 0);
    });
  });
}

// ─── Route: upload file ──────────────────────────────────────────────────────
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到檔案' });

    // multer 在 Windows 上會把多位元組字元誤讀為 latin1，需轉回 UTF-8
    const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

    const duration = await probeDuration(req.file.path);
    res.json({
      fileId: path.basename(req.file.path),
      originalName,
      duration: Math.floor(duration)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '上傳或分析檔案失敗: ' + err.message });
  }
});

// ─── Route: fetch YouTube info ───────────────────────────────────────────────
app.post('/api/youtube-info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: '缺少 URL' });

  try {
    const { spawn } = require('child_process');
    const info = await new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_PATH, ['--dump-single-json', '--no-playlist', url]);
      const chunks = [];
      const errChunks = [];
      proc.stdout.on('data', d => chunks.push(d));
      proc.stderr.on('data', d => errChunks.push(d));
      proc.on('close', code => {
        if (code !== 0) return reject(new Error(Buffer.concat(errChunks).toString()));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      proc.on('error', reject);
    });
    res.json({
      title: info.title,
      duration: info.duration,
      thumbnail: info.thumbnail,
      url
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: '無法取得 YouTube 資訊，請確認 URL 是否正確，或 yt-dlp 是否已安裝。\n' + err.message });
  }
});

// ─── Route: convert (file or YouTube) to MP3 ────────────────────────────────
app.post('/api/convert', async (req, res) => {
  const { type, fileId, url, startSec, endSec, title } = req.body;

  if (type !== 'file' && type !== 'youtube') {
    return res.status(400).json({ error: '無效的 type，必須為 file 或 youtube' });
  }

  const jobId = uuidv4();
  const outputPath = path.join(OUTPUT_DIR, jobId + '.mp3');

  try {
    if (type === 'file') {
      if (!fileId) return res.status(400).json({ error: '缺少 fileId' });
      const inputPath = path.join(UPLOAD_DIR, fileId);
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: '找不到上傳的檔案' });
      }
      await convertToMp3(inputPath, outputPath, startSec, endSec);

    } else {
      // YouTube: download audio via yt-dlp then convert
      if (!url) return res.status(400).json({ error: '缺少 YouTube URL' });

      const YTDlpWrap = require('yt-dlp-wrap').default;
      const ytDlp = new YTDlpWrap(YTDLP_PATH);

      const tempAudioPath = path.join(UPLOAD_DIR, jobId + '.%(ext)s');

      // Download best audio only
      await new Promise((resolve, reject) => {
        ytDlp.exec([
          url,
          '-f', 'bestaudio',
          '-o', tempAudioPath,
          '--no-playlist'
        ])
          .on('close', resolve)
          .on('error', reject);
      });

      // Find the downloaded file
      const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.startsWith(jobId));
      if (!files.length) throw new Error('yt-dlp 沒有下載到檔案');
      const dlPath = path.join(UPLOAD_DIR, files[0]);

      await convertToMp3(dlPath, outputPath, startSec, endSec);

      // Clean temp audio
      fs.unlink(dlPath, () => {});
    }

    // Stream the file back to client
    const safeTitle = (title || 'output').replace(/[^a-zA-Z0-9\u4e00-\u9fff\-_. ]/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeTitle)}.mp3`);
    res.setHeader('Content-Type', 'audio/mpeg');

    const readStream = fs.createReadStream(outputPath);
    readStream.pipe(res);
    readStream.on('end', () => {
      fs.unlink(outputPath, () => {});
    });

  } catch (err) {
    console.error(err);
    if (fs.existsSync(outputPath)) fs.unlink(outputPath, () => {});
    res.status(500).json({ error: '轉換失敗: ' + err.message });
  }
});

// ─── Cleanup old files every 30 min ─────────────────────────────────────────
setInterval(() => {
  const maxAge = 30 * 60 * 1000;
  [UPLOAD_DIR, OUTPUT_DIR].forEach(dir => {
    fs.readdirSync(dir).forEach(file => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (Date.now() - stat.mtimeMs > maxAge) {
        fs.unlink(filePath, () => {});
      }
    });
  });
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`✅ MP3 Converter server running at http://localhost:${PORT}`);
});

