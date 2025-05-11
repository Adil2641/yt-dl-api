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
  DOWNLOAD_TIMEOUT: parseInt(process.env.DOWNLOAD_TIMEOUT) || 300000,
  TITLE_CACHE_TTL: parseInt(process.env.TITLE_CACHE_TTL) || 604800000,
  CPU_COUNT: parseInt(process.env.CPU_COUNT) || os.cpus().length,
  RATE_LIMIT: process.env.RATE_LIMIT || '2M',
  RETRY_ATTEMPTS: parseInt(process.env.RETRY_ATTEMPTS) || 2,
  RETRY_DELAY: parseInt(process.env.RETRY_DELAY) || 5000
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

// Verify yt-dlp exists
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

// Video info cache with periodic cleanup
const videoInfoCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of videoInfoCache.entries()) {
    if (now - value.timestamp > config.TITLE_CACHE_TTL) {
      videoInfoCache.delete(key);
    }
  }
}, 3600000);

let activeDownloads = 0;

// HTML Template
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Downloader Pro</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">
    <style>
        :root {
            --primary-color: #ff0000;
            --secondary-color: #0066cc;
            --dark-color: #333;
            --light-color: #f8f9fa;
            --success-color: #28a745;
            --danger-color: #dc3545;
            --warning-color: #ffc107;
            --bg-color: #f5f5f5;
            --text-color: #333;
            --card-bg: white;
            --input-bg: white;
            --progress-bg: #e9ecef;
            --result-bg: #f0f0f0;
            --border-color: #ddd;
        }

        .dark-mode {
            --bg-color: #121212;
            --text-color: #f0f0f0;
            --card-bg: #1e1e1e;
            --input-bg: #2d2d2d;
            --progress-bg: #333;
            --result-bg: #2a2a2a;
            --border-color: #444;
            --dark-color: #f0f0f0;
            --light-color: #2d2d2d;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            transition: background-color 0.3s, color 0.3s, border-color 0.3s;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: var(--bg-color);
            color: var(--text-color);
            line-height: 1.6;
            min-height: 100vh;
        }
        
        .container {
            max-width: 900px;
            margin: 2rem auto;
            padding: 2rem;
            background: var(--card-bg);
            border-radius: 15px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
            position: relative;
        }
        
        header {
            text-align: center;
            margin-bottom: 2rem;
            position: relative;
        }
        
        h1 {
            color: var(--primary-color);
            margin-bottom: 0.5rem;
            font-size: 2.5rem;
        }
        
        .owner {
            position: absolute;
            top: 0;
            right: 0;
            background-color: var(--primary-color);
            color: white;
            padding: 0.3rem 0.8rem;
            border-radius: 20px;
            font-size: 0.9rem;
            font-weight: bold;
        }
        
        .owner a {
            color: white;
            text-decoration: none;
        }
        
        .owner a:hover {
            text-decoration: underline;
        }
        
        .tagline {
            color: var(--text-color);
            opacity: 0.8;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
        }
        
        .input-group {
            display: flex;
            margin-bottom: 1rem;
            gap: 10px;
        }
        
        input[type="text"] {
            flex: 1;
            padding: 12px 15px;
            border: 2px solid var(--border-color);
            border-radius: 30px;
            font-size: 1rem;
            background-color: var(--input-bg);
            color: var(--text-color);
        }
        
        input[type="text"]:focus {
            border-color: var(--primary-color);
            outline: none;
            box-shadow: 0 0 0 3px rgba(255, 0, 0, 0.1);
        }
        
        button {
            padding: 12px 25px;
            border: none;
            border-radius: 30px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none !important;
            box-shadow: none !important;
        }
        
        .get-info-btn {
            background-color: var(--primary-color);
            color: white;
        }
        
        .mp3-btn {
            background-color: var(--primary-color);
            color: white;
        }
        
        .mp4-btn {
            background-color: var(--secondary-color);
            color: white;
        }
        
        #title {
            margin: 1.5rem 0;
            font-size: 1.2rem;
            font-weight: bold;
            color: var(--text-color);
            padding: 15px;
            background-color: var(--result-bg);
            border-radius: 10px;
            text-align: center;
        }
        
        .download-options {
            display: flex;
            flex-direction: column;
            gap: 15px;
            margin: 1.5rem 0;
            opacity: 0;
            height: 0;
            overflow: hidden;
            transition: all 0.5s ease;
        }
        
        .download-options.show {
            opacity: 1;
            height: auto;
        }
        
        .quality-selector {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-bottom: 15px;
        }
        
        .quality-options {
            display: flex;
            flex-wrap: wrap;
            gap: 10px;
            justify-content: center;
        }
        
        .quality-btn {
            padding: 8px 15px;
            background-color: var(--light-color);
            color: var(--text-color);
            border-radius: 20px;
            font-size: 0.9rem;
            border: none;
            cursor: pointer;
        }
        
        .quality-btn.active {
            background-color: var(--primary-color);
            color: white;
        }
        
        .action-buttons {
            display: flex;
            gap: 15px;
            justify-content: center;
        }
        
        #progress {
            margin: 2rem 0;
            display: none;
        }
        
        .progress-container {
            background-color: var(--progress-bg);
            border-radius: 10px;
            height: 20px;
            margin-bottom: 10px;
            overflow: hidden;
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, var(--primary-color), #ff6b6b);
            width: 0%;
            transition: width 0.3s ease;
            border-radius: 10px;
        }
        
        .progress-text {
            text-align: center;
            font-weight: bold;
            color: var(--text-color);
        }
        
        #result {
            padding: 15px;
            margin: 1rem 0;
            border-radius: 10px;
            text-align: center;
            display: none;
            background-color: var(--result-bg);
        }
        
        .success {
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .error {
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        .video-thumbnail {
            width: 100%;
            max-width: 480px;
            height: auto;
            border-radius: 10px;
            margin: 1rem auto;
            display: block;
            border: 1px solid var(--border-color);
        }
        
        .video-info {
            display: flex;
            justify-content: space-between;
            margin: 1rem 0;
            font-size: 0.9rem;
            color: var(--text-color);
            opacity: 0.8;
        }
        
        .theme-toggle {
            position: absolute;
            top: 20px;
            left: 20px;
            background: none;
            border: none;
            font-size: 1.5rem;
            color: var(--text-color);
            cursor: pointer;
            z-index: 10;
        }
        
        .features {
            display: flex;
            flex-wrap: wrap;
            gap: 15px;
            justify-content: center;
            margin: 2rem 0;
        }
        
        .feature-card {
            background-color: var(--light-color);
            padding: 15px;
            border-radius: 10px;
            width: 150px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
        }
        
        .feature-icon {
            font-size: 2rem;
            margin-bottom: 10px;
            color: var(--primary-color);
        }
        
        footer {
            text-align: center;
            margin-top: 3rem;
            color: var(--text-color);
            opacity: 0.7;
            font-size: 0.9rem;
        }
        
        @media (max-width: 768px) {
            .container {
                margin: 1rem;
                padding: 1.5rem;
            }
            
            .input-group {
                flex-direction: column;
            }
            
            button {
                width: 100%;
            }
            
            .action-buttons {
                flex-direction: column;
            }
            
            .quality-options {
                flex-direction: column;
                align-items: center;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <button class="theme-toggle" id="themeToggle">
            <i class="fas fa-moon"></i>
        </button>
        
        <header>
            <div class="owner"><a href="https://www.facebook.com/a.dil.605376/" target="_blank">ADIL</a></div>
            <h1>YouTube Downloader Pro</h1>
            <p class="tagline">Download videos and music in highest quality</p>
        </header>
        
        <div class="input-group">
            <input type="text" id="videoId" placeholder="Enter YouTube URL or Video ID (e.g., dQw4w9WgXcQ)">
            <button class="get-info-btn" id="getInfoBtn">
                <i class="fas fa-info-circle"></i> Get Info
            </button>
        </div>
        
        <div id="title"></div>
        <img id="videoThumbnail" class="video-thumbnail" style="display: none;">
        <div class="video-info" id="videoInfo" style="display: none;"></div>
        
        <div class="download-options" id="downloadOptions">
            <div class="quality-selector">
                <h3>Select Quality:</h3>
                <div class="quality-options" id="qualityOptions">
                    <button class="quality-btn active" data-quality="best" onclick="setQuality(this)">Best Quality</button>
                    <button class="quality-btn" data-quality="1080" onclick="setQuality(this)">1080p</button>
                    <button class="quality-btn" data-quality="720" onclick="setQuality(this)">720p</button>
                    <button class="quality-btn" data-quality="480" onclick="setQuality(this)">480p</button>
                    <button class="quality-btn" data-quality="360" onclick="setQuality(this)">360p</button>
                </div>
            </div>
            
            <div class="action-buttons">
                <button id="downloadMp3Btn" class="mp3-btn" onclick="downloadMedia('mp3')">
                    <i class="fas fa-music"></i> Download MP3
                </button>
                <button id="downloadMp4Btn" class="mp4-btn" onclick="downloadMedia('mp4')">
                    <i class="fas fa-video"></i> Download MP4
                </button>
            </div>
        </div>
        
        <div id="progress">
            <div class="progress-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="progress-text" id="progressText">0%</div>
        </div>
        
        <div id="result"></div>
        
        <div class="features">
            <div class="feature-card">
                <div class="feature-icon"><i class="fas fa-tachometer-alt"></i></div>
                <h3>Fast</h3>
                <p>High-speed downloads</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon"><i class="fas fa-lock"></i></div>
                <h3>Secure</h3>
                <p>No data collection</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon"><i class="fas fa-bolt"></i></div>
                <h3>Powerful</h3>
                <p>All formats supported</p>
            </div>
            <div class="feature-card">
                <div class="feature-icon"><i class="fas fa-adjust"></i></div>
                <h3>Dark Mode</h3>
                <p>Easy on your eyes</p>
            </div>
        </div>
    </div>
    
    <footer>
        <p>© ${new Date().getFullYear()} YouTube Downloader Pro | All rights reserved</p>
    </footer>
    
    <script>
        let videoTitle = '';
        let videoId = '';
        let eventSource = null;
        let currentFormat = '';
        let selectedQuality = 'best';
        let videoDuration = 0;
        let videoViews = 0;
        
        // Initialize dark mode from localStorage
        function initDarkMode() {
            const darkModeEnabled = localStorage.getItem('darkMode') === 'enabled';
            if (darkModeEnabled) {
                document.body.classList.add('dark-mode');
                document.getElementById('themeToggle').innerHTML = '<i class="fas fa-sun"></i>';
            }
        }
        
        // Theme toggle
        function toggleDarkMode() {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('darkMode', 'enabled');
                document.getElementById('themeToggle').innerHTML = '<i class="fas fa-sun"></i>';
            } else {
                localStorage.removeItem('darkMode');
                document.getElementById('themeToggle').innerHTML = '<i class="fas fa-moon"></i>';
            }
        }
        
        // Initialize on page load
        document.addEventListener('DOMContentLoaded', function() {
            initDarkMode();
            
            // Set up event listeners
            document.getElementById('themeToggle').addEventListener('click', toggleDarkMode);
            document.getElementById('getInfoBtn').addEventListener('click', getVideoInfo);
            
            // Handle Enter key press
            document.getElementById('videoId').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    getVideoInfo();
                }
            });
        });
        
        function setQuality(btn) {
            document.querySelectorAll('.quality-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedQuality = btn.dataset.quality;
        }
        
        function formatDuration(seconds) {
            if (!seconds) return '00:00';
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            
            return [
                hours.toString().padStart(2, '0'),
                minutes.toString().padStart(2, '0'),
                secs.toString().padStart(2, '0')
            ].filter((part, i) => part !== '00' || i > 0).join(':');
        }
        
        function formatNumber(num) {
            if (!num) return '0';
            return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        }
        
        function getVideoInfo() {
            const input = document.getElementById('videoId').value.trim();
            const getInfoBtn = document.getElementById('getInfoBtn');
            videoId = input;
            
            // Disable button during request
            getInfoBtn.disabled = true;
            getInfoBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
            
            // Extract ID from URL if URL was provided
            try {
                if (input.includes('youtube.com') || input.includes('youtu.be')) {
                    const url = new URL(input.includes('://') ? input : 'https://' + input);
                    if (url.hostname === 'youtu.be') {
                        videoId = url.pathname.slice(1).split(/[?&#]/)[0];
                    } else {
                        videoId = url.searchParams.get('v') || input;
                    }
                }
            } catch (e) {
                console.error('URL parsing error:', e);
            }
            
            if (!videoId || videoId.length < 11) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                getInfoBtn.disabled = false;
                getInfoBtn.innerHTML = '<i class="fas fa-info-circle"></i> Get Info';
                return;
            }
            
            // Clean video ID (take first 11 chars)
            videoId = videoId.substring(0, 11);
            
            showResult('Fetching video information...', 'success');
            document.getElementById('downloadOptions').classList.remove('show');
            document.getElementById('videoThumbnail').style.display = 'none';
            document.getElementById('videoInfo').style.display = 'none';
            
            fetch('/get-info?id=' + encodeURIComponent(videoId))
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.error) {
                        throw new Error(data.error);
                    }
                    
                    videoTitle = data.title || 'Unknown Title';
                    videoDuration = data.duration || 0;
                    videoViews = data.views || 0;
                    
                    document.getElementById('title').textContent = videoTitle;
                    
                    const thumbnailUrl = data.thumbnail || 'https://img.youtube.com/vi/' + videoId + '/maxresdefault.jpg';
                    const thumbnailImg = document.getElementById('videoThumbnail');
                    thumbnailImg.src = thumbnailUrl;
                    thumbnailImg.style.display = 'block';
                    thumbnailImg.onerror = function() {
                        this.src = 'https://img.youtube.com/vi/' + videoId + '/hqdefault.jpg';
                    };
                    
                    const videoInfoDiv = document.getElementById('videoInfo');
                    videoInfoDiv.innerHTML = \`
                        <span><i class="fas fa-clock"></i> \${formatDuration(videoDuration)}</span>
                        <span><i class="fas fa-eye"></i> \${formatNumber(videoViews)} views</span>
                    \`;
                    videoInfoDiv.style.display = 'flex';
                    
                    document.getElementById('downloadOptions').classList.add('show');
                    document.getElementById('downloadMp3Btn').disabled = false;
                    document.getElementById('downloadMp4Btn').disabled = false;
                    showResult('Ready to download', 'success');
                })
                .catch(error => {
                    console.error('Error:', error);
                    showResult(error.message || 'Failed to get video information', 'error');
                })
                .finally(() => {
                    getInfoBtn.disabled = false;
                    getInfoBtn.innerHTML = '<i class="fas fa-info-circle"></i> Get Info';
                });
        }
        
        function downloadMedia(format) {
            if (!videoId) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                return;
            }
            
            currentFormat = format;
            showResult('Preparing download...', 'success');
            document.getElementById('downloadMp3Btn').disabled = true;
            document.getElementById('downloadMp4Btn').disabled = true;
            document.getElementById('progress').style.display = 'block';
            
            // Close previous connection if exists
            if (eventSource) {
                eventSource.close();
            }
            
            // Setup progress updates via SSE
            eventSource = new EventSource(\`/download-progress?id=\${encodeURIComponent(videoId)}&title=\${encodeURIComponent(videoTitle)}&format=\${format}&quality=\${selectedQuality}\`);
            
            eventSource.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.progress) {
                        const progress = Math.round(data.progress);
                        document.getElementById('progressBar').style.width = progress + '%';
                        document.getElementById('progressText').textContent = progress + '%';
                        
                        // Update title with progress
                        if (progress < 100) {
                            document.getElementById('title').textContent = \`\${videoTitle} (\${progress}%)\`;
                        }
                    }
                    if (data.url) {
                        // Download complete
                        eventSource.close();
                        window.location.href = data.url;
                        resetUI();
                    }
                    if (data.error) {
                        showResult(data.error, 'error');
                        eventSource.close();
                        resetUI();
                    }
                } catch (e) {
                    console.error('Error parsing SSE data:', e);
                }
            };
            
            eventSource.onerror = function() {
                showResult('Download failed or was interrupted', 'error');
                if (eventSource) eventSource.close();
                resetUI();
            };
        }
        
        function resetUI() {
            document.getElementById('progress').style.display = 'none';
            document.getElementById('downloadMp3Btn').disabled = false;
            document.getElementById('downloadMp4Btn').disabled = false;
            if (videoTitle) {
                document.getElementById('title').textContent = videoTitle;
            }
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = message;
            resultDiv.className = type;
            resultDiv.style.display = 'block';
            
            // Auto-hide success messages after 5 seconds
            if (type === 'success') {
                setTimeout(() => {
                    resultDiv.style.display = 'none';
                }, 5000);
            }
        }
    </script>
</body>
</html>`;

// Routes
app.get('/', (req, res) => {
  res.send(HTML_TEMPLATE);
});

app.get('/get-info', async (req, res) => {
  try {
    const videoId = req.query.id;
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ error: 'Invalid YouTube video ID' });
    }

    if (videoInfoCache.has(videoId)) {
      const cached = videoInfoCache.get(videoId);
      if (Date.now() - cached.timestamp < config.TITLE_CACHE_TTL) {
        return res.json(cached.data);
      }
    }

    const response = await axios.get(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    if (response.data.title) {
      const videoInfo = {
        title: response.data.title,
        duration: response.data.duration || 0,
        views: 0,
        thumbnail: response.data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
      };
      videoInfoCache.set(videoId, {
        data: videoInfo,
        timestamp: Date.now()
      });
      return res.json(videoInfo);
    }
    return res.status(404).json({ error: 'Video not found' });
  } catch (error) {
    logger.error('Get info error:', error);
    return res.status(500).json({ error: 'Failed to get video info' });
  }
});

const handleDownload = async (req, res, format) => {
  const { id, quality = 'best' } = req.query;
  
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  try {
    const infoResponse = await axios.get(`http://localhost:${PORT}/get-info?id=${id}`);
    const title = infoResponse.data?.title || id;
    const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 100);
    const outputPath = path.join(config.DOWNLOAD_FOLDER, `${cleanTitle}.${format}`);

    if (fs.existsSync(outputPath)) {
      return res.download(outputPath);
    }

    if (activeDownloads >= config.MAX_CONCURRENT_DOWNLOADS) {
      return res.status(429).json({ error: 'Server busy. Please try again later' });
    }

    activeDownloads++;
    logger.info(`Starting download for ${id} (${format})`);

    const videoUrl = `https://www.youtube.com/watch?v=${id}`;
    let command;

    if (format === 'mp3') {
      const audioQuality = quality === 'best' ? '0' : '5';
      command = `${config.YT_DLP_PATH} --no-warnings ${fs.existsSync(config.COOKIE_PATH) ? `--cookies ${config.COOKIE_PATH}` : ''} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
    } else {
      const formatString = quality === 'best' ? 'best' : `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
      command = `${config.YT_DLP_PATH} --no-warnings ${fs.existsSync(config.COOKIE_PATH) ? `--cookies ${config.COOKIE_PATH}` : ''} -f "${formatString}" --merge-output-format mp4 --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
    }

    logger.debug('Executing command:', command);
    const { stdout, stderr } = await execWithRetry(command);

    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but no file was created');
    }

    activeDownloads--;
    return res.download(outputPath, `${cleanTitle}.${format}`, (err) => {
      if (err) logger.error('Download delivery error:', err);
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
      error: error.message,
      stderr: error.stderr
    });

    let errorMessage = 'Download failed';
    if (error.stderr?.includes('Video unavailable') || error.stderr?.includes('content isn\'t available')) {
      errorMessage = 'This video is unavailable (private, removed, or age-restricted)';
    } else if (error.message.includes('timeout')) {
      errorMessage = 'Download timed out';
    } else if (error.signal === 'SIGTERM') {
      errorMessage = 'Download was terminated';
    }

    return res.status(500).json({ error: errorMessage });
  }
};

app.get('/download-audio', (req, res) => handleDownload(req, res, 'mp3'));
app.get('/download-video', (req, res) => handleDownload(req, res, 'mp4'));

app.get('/download-progress', (req, res) => {
  const { id, title, format, quality = 'best' } = req.query;
  
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid YouTube video ID' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send initial heartbeat
  res.write(': heartbeat\n\n');
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  const cleanTitle = (title || id).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').substring(0, 100);
  const outputPath = path.join(config.DOWNLOAD_FOLDER, `${cleanTitle}.${format}`);
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;

  if (fs.existsSync(outputPath)) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
    res.end();
    return;
  }

  if (activeDownloads >= config.MAX_CONCURRENT_DOWNLOADS) {
    clearInterval(heartbeat);
    res.write(`data: ${JSON.stringify({ error: 'Server busy. Please try again later' })}\n\n`);
    res.end();
    return;
  }

  activeDownloads++;
  logger.info(`Starting progress tracking for ${id} (${format})`);

  let command;
  if (format === 'mp3') {
    const audioQuality = quality === 'best' ? '0' : '5';
    command = `${config.YT_DLP_PATH} --no-warnings ${fs.existsSync(config.COOKIE_PATH) ? `--cookies ${config.COOKIE_PATH}` : ''} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
  } else {
    const formatString = quality === 'best' ? 'best' : `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
    command = `${config.YT_DLP_PATH} --no-warnings ${fs.existsSync(config.COOKIE_PATH) ? `--cookies ${config.COOKIE_PATH}` : ''} -f "${formatString}" --merge-output-format mp4 --no-playlist --concurrent-fragments ${config.CPU_COUNT} --limit-rate ${config.RATE_LIMIT} -o "${outputPath}" "${videoUrl}"`;
  }

  logger.debug('Executing progress command:', command);
  const child = exec(command, { timeout: config.DOWNLOAD_TIMEOUT });

  let progress = 0;
  child.stderr.on('data', (data) => {
    const dataStr = data.toString();
    logger.debug('yt-dlp stderr:', dataStr);
    
    if (dataStr.includes('Video unavailable') || dataStr.includes('content isn\'t available')) {
      const errorMsg = 'This video is unavailable (private, removed, or age-restricted)';
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

  req.on('close', () => {
    clearInterval(heartbeat);
    if (child.exitCode === null) {
      child.kill();
      activeDownloads--;
      logger.info('Client disconnected, terminating download');
    }
  });
});

app.get('/download-file', (req, res) => {
  try {
    const filePath = decodeURIComponent(req.query.path);
    
    if (!filePath || !filePath.startsWith(config.DOWNLOAD_FOLDER) || !fs.existsSync(filePath)) {
      return res.status(404).send('File not found');
    }

    res.download(filePath, path.basename(filePath), (err) => {
      if (err) logger.error('Download delivery error:', err);
    });
  } catch (error) {
    logger.error('File download error:', error);
    res.status(500).send('Download failed');
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
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
  logger.info('Configuration:', config);
});
