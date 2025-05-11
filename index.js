const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const util = require('util');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced Configuration with Environment Variables
const config = {
  DOWNLOAD_FOLDER: path.join(__dirname, 'downloads'),
  YT_DLP_PATH: path.join(__dirname, 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
  COOKIE_PATH: process.env.COOKIE_PATH || path.join(__dirname, 'cookies.txt'),
  MAX_CONCURRENT_DOWNLOADS: parseInt(process.env.MAX_CONCURRENT_DOWNLOADS) || 3,
  DOWNLOAD_TIMEOUT: parseInt(process.env.DOWNLOAD_TIMEOUT) || 300000, // 5 minutes
  TITLE_CACHE_TTL: parseInt(process.env.TITLE_CACHE_TTL) || 604800000, // 1 week
  CPU_COUNT: parseInt(process.env.CPU_COUNT) || os.cpus().length,
  RATE_LIMIT: process.env.RATE_LIMIT || '2M',
  RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS) || 2,
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 5000, // 5 seconds
  HEARTBEAT_INTERVAL: parseInt(process.env.HEARTBEAT_INTERVAL) || 30000 // 30 seconds
};

// Validate and create downloads directory
if (!fs.existsSync(config.DOWNLOAD_FOLDER)) {
  try {
    fs.mkdirSync(config.DOWNLOAD_FOLDER, { recursive: true });
    fs.chmodSync(config.DOWNLOAD_FOLDER, 0o777);
  } catch (err) {
    console.error('Failed to create downloads directory:', err);
    process.exit(1);
  }
}

// Enhanced logging with file output
const logger = {
  info: (...args) => {
    const message = `[INFO] ${new Date().toISOString()} ${args.join(' ')}\n`;
    console.log(message.trim());
    fs.appendFileSync('app.log', message);
  },
  error: (...args) => {
    const message = `[ERROR] ${new Date().toISOString()} ${args.join(' ')}\n`;
    console.error(message.trim());
    fs.appendFileSync('app.log', message);
    fs.appendFileSync('errors.log', message);
  },
  debug: (...args) => {
    if (process.env.DEBUG) {
      const message = `[DEBUG] ${new Date().toISOString()} ${args.join(' ')}\n`;
      console.debug(message.trim());
      fs.appendFileSync('debug.log', message);
    }
  }
};

// Verify yt-dlp exists and is executable
if (!fs.existsSync(config.YT_DLP_PATH)) {
  logger.error('yt-dlp not found at:', config.YT_DLP_PATH);
  process.exit(1);
}

// Promisified exec with retry capability
const execWithRetry = async (command, attempts = config.RETRY_ATTEMPTS) => {
  let lastError;
  
  for (let i = 0; i < attempts; i++) {
    try {
      const { stdout, stderr } = await util.promisify(exec)(command, { 
        timeout: config.DOWNLOAD_TIMEOUT 
      });
      return { stdout, stderr };
    } catch (error) {
      lastError = error;
      if (i < attempts - 1) {
        logger.debug(`Attempt ${i + 1} failed, retrying in ${config.RETRY_DELAY}ms...`);
        await new Promise(resolve => setTimeout(resolve, config.RETRY_DELAY));
      }
    }
  }
  
  throw lastError;
};

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Enhanced video info cache with periodic cleanup
const videoInfoCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of videoInfoCache.entries()) {
    if (now - value.timestamp > config.TITLE_CACHE_TTL) {
      videoInfoCache.delete(key);
    }
  }
}, 3600000); // Cleanup every hour

let activeDownloads = 0;

// HTML Template (simplified for brevity)
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Downloader</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .container { background: #f5f5f5; padding: 20px; border-radius: 8px; }
        input, button { padding: 10px; margin: 5px 0; }
        button { background: #4285f4; color: white; border: none; cursor: pointer; }
        #progress { margin: 20px 0; }
        #result { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .error { background: #ffebee; color: #c62828; }
        .success { background: #e8f5e9; color: #2e7d32; }
    </style>
</head>
<body>
    <div class="container">
        <h1>YouTube Downloader</h1>
        <div>
            <input type="text" id="videoUrl" placeholder="Enter YouTube URL">
            <button id="downloadBtn">Download</button>
        </div>
        <div id="progress" style="display: none;">
            <progress value="0" max="100"></progress>
            <span id="progressText">0%</span>
        </div>
        <div id="result"></div>
    </div>
    <script>
        // Client-side JavaScript would go here
    </script>
</body>
</html>`;

// Routes
app.get('/', (req, res) => {
  res.send(HTML_TEMPLATE);
});

// Enhanced video info endpoint with multiple fallback sources
app.get('/get-info', async (req, res) => {
  try {
    const videoId = req.query.id;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    // Cache check
    if (videoInfoCache.has(videoId)) {
      const cached = videoInfoCache.get(videoId);
      if (Date.now() - cached.timestamp < config.TITLE_CACHE_TTL) {
        return res.json(cached.data);
      }
    }

    // Try multiple info sources
    const sources = [
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    ];

    let videoInfo;
    for (const source of sources) {
      try {
        const response = await axios.get(source, { timeout: 5000 });
        if (response.data && response.data.title) {
          videoInfo = {
            title: response.data.title,
            duration: response.data.duration || 0,
            views: response.data.view_count || 0,
            thumbnail: response.data.thumbnail_url || 
                     `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
          };
          break;
        }
      } catch (err) {
        logger.debug(`Info source failed: ${source}`, err.message);
      }
    }

    if (!videoInfo) {
      // Final fallback - try yt-dlp to get info
      try {
        const command = `${config.YT_DLP_PATH} --no-warnings --dump-json --no-download "https://www.youtube.com/watch?v=${videoId}"`;
        const { stdout } = await execWithRetry(command);
        const info = JSON.parse(stdout);
        videoInfo = {
          title: info.title || `Video ${videoId}`,
          duration: info.duration || 0,
          views: info.view_count || 0,
          thumbnail: info.thumbnail || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
        };
      } catch (err) {
        logger.error('Failed to get video info from all sources:', err);
        return res.status(404).json({ error: 'Video not found or unavailable' });
      }
    }

    videoInfoCache.set(videoId, {
      data: videoInfo,
      timestamp: Date.now()
    });
    return res.json(videoInfo);

  } catch (error) {
    logger.error('Get info error:', error);
    return res.status(500).json({ error: 'Failed to get video info' });
  }
});

// Unified download handler with enhanced recovery
const handleDownload = async (req, res, format) => {
  const { id, quality = 'best' } = req.query;
  
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  try {
    // Get video info with validation
    const infoResponse = await axios.get(`http://localhost:${PORT}/get-info?id=${id}`);
    const title = infoResponse.data?.title || id;
    const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 100);
    const outputPath = path.join(config.DOWNLOAD_FOLDER, `${cleanTitle}.${format}`);

    // Check existing file
    if (fs.existsSync(outputPath)) {
      return res.download(outputPath);
    }

    // Check concurrent download limit
    if (activeDownloads >= config.MAX_CONCURRENT_DOWNLOADS) {
      return res.status(429).json({ error: 'Server busy. Please try again later' });
    }

    activeDownloads++;
    logger.info(`Starting download for ${id} (${format})`);

    const videoUrl = `https://www.youtube.com/watch?v=${id}`;
    let command;

    if (format === 'mp3') {
      const audioQuality = quality === 'best' ? '0' : '5';
      command = `${config.YT_DLP_PATH} --no-warnings ${config.COOKIE_PATH ? `--cookies ${config.COOKIE_PATH}` : ''} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
    } else {
      const formatString = quality === 'best' ? 'best' : `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
      command = `${config.YT_DLP_PATH} --no-warnings ${config.COOKIE_PATH ? `--cookies ${config.COOKIE_PATH}` : ''} -f "${formatString}" --merge-output-format mp4 --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
    }

    logger.debug('Executing command:', command);
    const { stdout, stderr } = await execWithRetry(command);

    // Verify download completed successfully
    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but no file was created');
    }

    activeDownloads--;
    return res.download(outputPath, `${cleanTitle}.${format}`, (err) => {
      if (err) {
        logger.error('Download delivery error:', err);
      }
      // Schedule cleanup
      setTimeout(() => {
        try {
          fs.unlinkSync(outputPath);
          logger.info(`Cleaned up ${outputPath}`);
        } catch (err) {
          logger.error('Cleanup error:', err);
        }
      }, config.TITLE_CACHE_TTL);
    });

  } catch (error) {
    activeDownloads--;
    logger.error('Download failed:', {
      videoId: id,
      format,
      error: error.message,
      code: error.code,
      signal: error.signal,
      stdout: error.stdout,
      stderr: error.stderr
    });

    let errorMessage = 'Download failed';
    if (error.stderr?.includes('Video unavailable') || error.stderr?.includes('content isn\'t available')) {
      errorMessage = 'This video is unavailable (private, removed, or age-restricted)';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Download timed out';
    } else if (error.signal === 'SIGTERM') {
      errorMessage = 'Download was terminated';
    } else if (error.stderr?.includes('This video is only available for registered users')) {
      errorMessage = 'Age-restricted content requires cookies (try signing in)';
    }

    return res.status(500).json({ 
      error: errorMessage,
      details: process.env.DEBUG ? error.message : undefined
    });
  }
};

// Download endpoints
app.get('/download-audio', (req, res) => handleDownload(req, res, 'mp3'));
app.get('/download-video', (req, res) => handleDownload(req, res, 'mp4'));

// Enhanced progress endpoint with heartbeat
app.get('/download-progress', (req, res) => {
  const { id, title, format, quality = 'best' } = req.query;
  
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial heartbeat
  res.write(': heartbeat\n\n');
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, config.HEARTBEAT_INTERVAL);

  // Clean title
  const cleanTitle = (title || id).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 100);
  const outputPath = path.join(config.DOWNLOAD_FOLDER, `${cleanTitle}.${format}`);
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;

  // Check if file already exists
  if (fs.existsSync(outputPath)) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
    res.end();
    return;
  }

  // Check concurrent download limit
  if (activeDownloads >= config.MAX_CONCURRENT_DOWNLOADS) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ error: 'Server busy. Please try again later' })}\n\n`);
    res.end();
    return;
  }

  activeDownloads++;
  logger.info(`Starting progress tracking for ${id} (${format})`);

  // Build yt-dlp command
  let command;
  if (format === 'mp3') {
    const audioQuality = quality === 'best' ? '0' : '5';
    command = `${config.YT_DLP_PATH} --no-warnings ${config.COOKIE_PATH ? `--cookies ${config.COOKIE_PATH}` : ''} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
  } else {
    const formatString = quality === 'best' ? 'best' : `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
    command = `${config.YT_DLP_PATH} --no-warnings ${config.COOKIE_PATH ? `--cookies ${config.COOKIE_PATH}` : ''} -f "${formatString}" --merge-output-format mp4 --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
  }

  logger.debug('Executing progress command:', command);
  const child = exec(command, { timeout: config.DOWNLOAD_TIMEOUT });

  // Progress tracking
  let progress = 0;
  child.stderr.on('data', (data) => {
    const dataStr = data.toString();
    logger.debug('yt-dlp stderr:', dataStr);
    
    // Check for video unavailable error
    if (dataStr.includes('Video unavailable') || 
        dataStr.includes('content isn\'t available') ||
        dataStr.includes('This video is only available for registered users')) {
      const errorMsg = dataStr.includes('registered users') ? 
        'Age-restricted content requires cookies (try signing in)' :
        'This video is unavailable (private, removed, or age-restricted)';
      
      logger.error(errorMsg);
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.end();
      child.kill();
      activeDownloads--;
      return;
    }

    const progressMatch = dataStr.match(/\[download\]\s+(\d+\.\d+)%/);
    if (progressMatch) {
      progress = parseFloat(progressMatch[1]);
      res.write(`data: ${JSON.stringify({ progress })}\n\n`);
    }
  });

  child.stdout.on('data', (data) => {
    logger.debug('yt-dlp stdout:', data.toString());
  });

  child.on('error', (error) => {
    logger.error('Child process error:', error);
    clearInterval(heartbeat);
    activeDownloads--;
    res.write(`data: ${JSON.stringify({ error: `Download error: ${error.message}` })}\n\n`);
    res.end();
  });

  child.on('close', (code, signal) => {
    clearInterval(heartbeat);
    activeDownloads--;
    logger.info(`Child process closed with code ${code} and signal ${signal}`);
    
    if (code === 0) {
      if (fs.existsSync(outputPath)) {
        res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
      } else {
        const errorMsg = 'Download completed but no file was created';
        logger.error(errorMsg);
        res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      }
    } else {
      let errorMsg = 'Download failed';
      if (signal === 'SIGTERM') {
        errorMsg = 'Download was terminated';
      } else if (code === 1) {
        errorMsg = 'Download failed (check if video is available)';
      }
      logger.error(errorMsg);
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (err) {
        logger.error('Cleanup error:', err);
      }
    }
    res.end();
  });

  // Handle client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (child.exitCode === null) {
      child.kill();
      activeDownloads--;
      logger.info('Client disconnected, terminating download');
    }
  });
});

// File download endpoint with validation
app.get('/download-file', (req, res) => {
  try {
    const filePath = decodeURIComponent(req.query.path);
    
    if (!filePath || !filePath.startsWith(config.DOWNLOAD_FOLDER) || !fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    const fileName = path.basename(filePath);
    res.download(filePath, fileName, (err) => {
      if (err) {
        logger.error('Download delivery error:', err);
      }
    });
  } catch (error) {
    logger.error('File download error:', error);
    res.status(500).send('Download failed');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.DEBUG ? err.message : undefined
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

// Startup
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info('Configuration:', {
    cpuCount: config.CPU_COUNT,
    maxDownloads: config.MAX_CONCURRENT_DOWNLOADS,
    downloadFolder: config.DOWNLOAD_FOLDER,
    ytDlpPath: config.YT_DLP_PATH,
    cookiePath: config.COOKIE_PATH,
    rateLimit: config.RATE_LIMIT,
    timeout: config.DOWNLOAD_TIMEOUT,
    retryAttempts: config.RETRY_ATTEMPTS,
    retryDelay: config.RETRY_DELAY
  });
});
