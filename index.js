const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const util = require("util");
const os = require("os");

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");
const cookiePath = path.join(__dirname, "cookies.txt");
const MAX_CONCURRENT_DOWNLOADS = 3;
const DOWNLOAD_TIMEOUT = 300000; // 5 minutes
const TITLE_CACHE_TTL = 10080000; // 1 week

// Convert exec to promise-based
const execPromise = util.promisify(exec);

// Create downloads folder if it doesn't exist
if (!fs.existsSync(DOWNLOAD_FOLDER)) {
  fs.mkdirSync(DOWNLOAD_FOLDER, { recursive: true });
}

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Cache for video titles
const titleCache = new Map();
let activeDownloads = 0;

// Security patterns
const MALICIOUS_PATTERNS = [
  /https?:\/\/link\/download\?id=/i,
  /javascript:/i,
  /data:/i,
  /vbscript:/i,
  /eval\(/i,
  /document\./i,
  /window\./i,
  /\.php\?/i,
  /\.asp\?/i,
  /\.exe$/i,
  /\.bat$/i,
  /\.cmd$/i,
  /\.dll$/i
];

// Optimized malicious link detection
function isMaliciousLink(url) {
  return MALICIOUS_PATTERNS.some(pattern => pattern.test(url));
}

// Get CPU count for optimal parallel downloads
const CPU_COUNT = os.cpus().length;

// HTML Template with improved design and loading features
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Downloader</title>
    <style>
        :root {
            --primary-color: #ff0000;
            --secondary-color: #0066cc;
            --dark-color: #333;
            --light-color: #f8f9fa;
            --success-color: #28a745;
            --danger-color: #dc3545;
            --warning-color: #ffc107;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background-color: #f5f5f5;
            color: var(--dark-color);
            line-height: 1.6;
        }
        
        .container {
            max-width: 800px;
            margin: 2rem auto;
            padding: 2rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.1);
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
            color: #666;
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
        }
        
        .input-group {
            display: flex;
            margin-bottom: 1rem;
        }
        
        input[type="text"] {
            flex: 1;
            padding: 12px 15px;
            border: 2px solid #ddd;
            border-radius: 30px;
            font-size: 1rem;
            transition: all 0.3s;
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
            margin-left: 10px;
        }
        
        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
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
            color: var(--dark-color);
            padding: 10px;
            background-color: #f0f0f0;
            border-radius: 5px;
            text-align: center;
        }
        
        .download-options {
            display: flex;
            justify-content: center;
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
        
        #progress {
            margin: 2rem 0;
            display: none;
        }
        
        /* Loading spinner */
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
            margin-right: 8px;
            vertical-align: middle;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        /* Enhanced progress bar */
        .progress-container {
            position: relative;
            height: 25px;
            background-color: #f0f0f0;
            border-radius: 12px;
            overflow: hidden;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.2);
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #ff0000, #ff6b6b);
            width: 0%;
            transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
            position: relative;
            overflow: hidden;
        }
        
        .progress-bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(
                90deg,
                rgba(255,255,255,0) 0%,
                rgba(255,255,255,0.3) 50%,
                rgba(255,255,255,0) 100%
            );
            animation: shimmer 2s infinite;
        }
        
        @keyframes shimmer {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        .progress-text {
            text-align: center;
            font-weight: bold;
            color: var(--dark-color);
            margin-top: 8px;
        }
        
        /* Download details */
        .download-details {
            margin-top: 1rem;
            display: none;
            background: #f8f9fa;
            padding: 1rem;
            border-radius: 8px;
            border-left: 4px solid var(--primary-color);
        }
        
        .download-details.show {
            display: block;
            animation: fadeIn 0.5s ease-out;
        }
        
        .download-details p {
            margin: 0.5rem 0;
            display: flex;
            justify-content: space-between;
        }
        
        .download-details span {
            font-weight: bold;
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        /* Button loading state */
        .btn-loading {
            position: relative;
            color: transparent !important;
        }
        
        .btn-loading::after {
            content: '';
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }
        
        /* Skeleton loading for title */
        .skeleton {
            background-color: #e0e0e0;
            border-radius: 4px;
            animation: pulse 1.5s ease-in-out infinite;
        }
        
        @keyframes pulse {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 0.3; }
        }
        
        #result {
            padding: 15px;
            margin: 1rem 0;
            border-radius: 5px;
            text-align: center;
            display: none;
        }
        
        .success {
            background-color: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        
        .error {
            background-color: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        
        footer {
            text-align: center;
            margin-top: 3rem;
            color: #666;
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
                margin-left: 0;
                margin-top: 10px;
                width: 100%;
            }
            
            .download-options {
                flex-direction: column;
                gap: 10px;
            }
            
            .mp3-btn, .mp4-btn {
                width: 100%;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="owner"><a href="https://www.facebook.com/a.dil.605376/" target="_blank">ADIL</a></div>
            <h1>YouTube Downloader</h1>
            <p class="tagline">Download your favorite YouTube videos and music</p>
        </header>

        <div class="input-group">
            <input type="text" id="videoId" placeholder="Enter YouTube URL or Video ID (e.g., dQw4w9WgXcQ)">
            <button class="get-info-btn" onclick="getVideoInfo()">Get Info</button>
        </div>
        
        <div id="title"></div>
        
        <div class="download-options" id="downloadOptions">
            <button id="downloadMp3Btn" class="mp3-btn" onclick="downloadMedia('mp3')">
                <i class="fas fa-music"></i> Download MP3
            </button>
            <button id="downloadMp4Btn" class="mp4-btn" onclick="downloadMedia('mp4')">
                <i class="fas fa-video"></i> Download MP4
            </button>
        </div>
        
        <div id="progress">
            <div class="progress-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="progress-text" id="progressText">0%</div>
        </div>
        
        <div class="download-details" id="downloadDetails"></div>
        
        <div id="result"></div>
    </div>

    <footer>
        <p>© ${new Date().getFullYear()} YouTube Downloader | All rights reserved</p>
    </footer>

    <!-- Font Awesome for icons -->
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css">

    <script>
        let videoTitle = '';
        let videoId = '';
        let eventSource = null;
        let currentFormat = '';
        let downloadStartTime = null;
        
        function getVideoInfo() {
            const input = document.getElementById('videoId').value.trim();
            videoId = input;
            
            // Extract ID from URL if URL was provided
            if (input.includes('youtube.com') || input.includes('youtu.be')) {
                const url = new URL(input.includes('://') ? input : 'https://' + input);
                if (url.hostname === 'youtu.be') {
                    videoId = url.pathname.slice(1);
                } else {
                    videoId = url.searchParams.get('v');
                }
            }
            
            if (!videoId) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                return;
            }
            
            // Show loading state
            const getInfoBtn = document.querySelector('.get-info-btn');
            getInfoBtn.disabled = true;
            getInfoBtn.classList.add('btn-loading');
            
            // Show skeleton loading for title
            const titleElement = document.getElementById('title');
            titleElement.innerHTML = '<div class="skeleton" style="height: 24px; width: 80%; margin: 0 auto;"></div>';
            
            showResult('Fetching video information...', 'success');
            document.getElementById('downloadOptions').classList.remove('show');
            
            fetch(\`/get-title?id=\${videoId}\`)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    videoTitle = data.title;
                    titleElement.textContent = data.title;
                    document.getElementById('downloadOptions').classList.add('show');
                    document.getElementById('downloadMp3Btn').disabled = false;
                    document.getElementById('downloadMp4Btn').disabled = false;
                    showResult('Ready to download', 'success');
                })
                .catch(error => {
                    showResult('Failed to get video information', 'error');
                    console.error(error);
                })
                .finally(() => {
                    getInfoBtn.disabled = false;
                    getInfoBtn.classList.remove('btn-loading');
                });
        }
        
        function downloadMedia(format) {
            if (!videoId) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                return;
            }
            
            currentFormat = format;
            showResult('Preparing download...', 'success');
            
            // Set buttons to loading state
            const mp3Btn = document.getElementById('downloadMp3Btn');
            const mp4Btn = document.getElementById('downloadMp4Btn');
            mp3Btn.disabled = true;
            mp4Btn.disabled = true;
            
            if (format === 'mp3') {
                mp3Btn.classList.add('btn-loading');
            } else {
                mp4Btn.classList.add('btn-loading');
            }
            
            // Show progress and details
            document.getElementById('progress').style.display = 'block';
            const detailsElement = document.getElementById('downloadDetails');
            detailsElement.classList.add('show');
            
            // Record start time
            downloadStartTime = new Date();
            updateDownloadDetails();
            
            // Setup progress updates via SSE
            eventSource = new EventSource(\`/download-progress?id=\${videoId}&title=\${encodeURIComponent(videoTitle)}&format=\${format}\`);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.progress) {
                    const progress = Math.round(data.progress);
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                    updateDownloadDetails();
                }
                
                if (data.url) {
                    // Download complete
                    completeDownload(data.url);
                }
                
                if (data.error) {
                    downloadFailed(data.error);
                }
            };
            
            eventSource.onerror = function() {
                downloadFailed('Download failed');
            };
        }
        
        function completeDownload(url) {
            // Update UI
            document.getElementById('progressBar').style.width = '100%';
            document.getElementById('progressText').textContent = '100%';
            showResult('Download complete!', 'success');
            updateDownloadDetails(true);
            
            // Reset buttons
            resetButtons();
            
            // Close connection
            if (eventSource) eventSource.close();
            
            // Start download after a short delay to show completion
            setTimeout(() => {
                window.location.href = url;
                document.getElementById('progress').style.display = 'none';
                document.getElementById('downloadDetails').classList.remove('show');
            }, 1000);
        }
        
        function downloadFailed(error) {
            showResult(error || 'Download failed', 'error');
            document.getElementById('progress').style.display = 'none';
            document.getElementById('downloadDetails').classList.remove('show');
            resetButtons();
            if (eventSource) eventSource.close();
        }
        
        function resetButtons() {
            const mp3Btn = document.getElementById('downloadMp3Btn');
            const mp4Btn = document.getElementById('downloadMp4Btn');
            mp3Btn.disabled = false;
            mp4Btn.disabled = false;
            mp3Btn.classList.remove('btn-loading');
            mp4Btn.classList.remove('btn-loading');
        }
        
        function updateDownloadDetails(complete = false) {
            const detailsElement = document.getElementById('downloadDetails');
            if (!detailsElement) return;
            
            const now = new Date();
            const elapsed = downloadStartTime ? Math.floor((now - downloadStartTime) / 1000) : 0;
            const progress = parseInt(document.getElementById('progressText').textContent) || 0;
            
            let detailsHTML = \`
                <p><span>Status:</span> \${complete ? 'Completed' : 'Downloading...'}</p>
                <p><span>Format:</span> \${currentFormat.toUpperCase()}</p>
                <p><span>Progress:</span> \${progress}%</p>
                <p><span>Time elapsed:</span> \${formatTime(elapsed)}</p>
            \`;
            
            if (!complete && progress > 0) {
                const estimatedTotal = Math.floor(elapsed * 100 / progress);
                const remaining = estimatedTotal - elapsed;
                detailsHTML += \`<p><span>Estimated time remaining:</span> \${formatTime(remaining)}</p>\`;
            }
            
            detailsElement.innerHTML = detailsHTML;
        }
        
        function formatTime(seconds) {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return \`\${mins}m \${secs}s\`;
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = message;
            resultDiv.className = type;
            resultDiv.style.display = 'block';
        }
        
        // Handle Enter key press
        document.getElementById('videoId').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                getVideoInfo();
            }
        });
    </script>
</body>
</html>
`;

// Routes
app.get("/", (req, res) => {
  res.send(HTML_TEMPLATE);
});

app.get("/get-title", async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required." });
  }

  // Check cache first
  if (titleCache.has(videoId)) {
    const cached = titleCache.get(videoId);
    if (Date.now() - cached.timestamp < TITLE_CACHE_TTL) {
      return res.json({ title: cached.title });
    }
  }

  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    const source = axios.CancelToken.source();
    const timeout = setTimeout(() => {
      source.cancel('API request timed out');
    }, 30000);

    const apiResponse = await axios.get(`https://audio-recon-api-bsda.onrender.com/adil?url=${videoUrl}`, {
      cancelToken: source.token
    });
    
    clearTimeout(timeout);

    if (apiResponse.data?.title) {
      titleCache.set(videoId, {
        title: apiResponse.data.title,
        timestamp: Date.now()
      });
      return res.json({ title: apiResponse.data.title });
    }
    return res.status(500).json({ error: "Could not retrieve video title" });
  } catch (error) {
    if (axios.isCancel(error)) {
      console.log("API request timed out");
      return res.status(504).json({ error: "API request timed out" });
    }
    console.error("API Error:", error);
    return res.status(500).json({ error: "Failed to get video title from API" });
  }
});

// New direct download endpoints
app.get("/download-audio", async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required." });
  }

  try {
    // Get video title first
    const titleResponse = await axios.get(`http://localhost:${PORT}/get-title?id=${videoId}`);
    const title = titleResponse.data.title || videoId;
    const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.mp3`);
    
    // Check if file already exists
    if (fs.existsSync(outputPath)) {
      return res.download(outputPath, `${cleanTitle}.mp3`);
    }

    // Check concurrent download limit
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      return res.status(429).json({ error: "Server busy. Please try again later." });
    }

    activeDownloads++;

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

    console.log("Running audio download command:", command);
    
    await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
    
    activeDownloads--;
    return res.download(outputPath, `${cleanTitle}.mp3`, (err) => {
      if (err) {
        console.error("Download error:", err);
        return res.status(500).json({ error: "Download failed" });
      }
      
      // Schedule cleanup after 1 week
      setTimeout(() => {
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error("Cleanup error:", err);
        }
      }, 10080000); // 1 minute = 60000
    });
  } catch (error) {
    activeDownloads--;
    console.error("Audio download error:", error);
    return res.status(500).json({ error: "Failed to download audio" });
  }
});

app.get("/download-video", async (req, res) => {
  const videoId = req.query.id;
  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required." });
  }

  try {
    // Get video title first
    const titleResponse = await axios.get(`http://localhost:${PORT}/get-title?id=${videoId}`);
    const title = titleResponse.data.title || videoId;
    const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.mp4`);
    
    // Check if file already exists
    if (fs.existsSync(outputPath)) {
      return res.download(outputPath, `${cleanTitle}.mp4`);
    }

    // Check concurrent download limit
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      return res.status(429).json({ error: "Server busy. Please try again later." });
    }

    activeDownloads++;

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const command = `${ytDlpPath} --cookies ${cookiePath} -f "best" --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

    console.log("Running video download command:", command);
    
    await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
    
    activeDownloads--;
    return res.download(outputPath, `${cleanTitle}.mp4`, (err) => {
      if (err) {
        console.error("Download error:", err);
        return res.status(500).json({ error: "Download failed" });
      }
      
      // Schedule cleanup after 1 week
      setTimeout(() => {
        try {
          fs.unlinkSync(outputPath);
        } catch (err) {
          console.error("Cleanup error:", err);
        }
      }, 10080000); // 1 minute = 60000
    });
  } catch (error) {
    activeDownloads--;
    console.error("Video download error:", error);
    return res.status(500).json({ error: "Failed to download video" });
  }
});

// SSE endpoint for progress updates
app.get("/download-progress", (req, res) => {
  const videoId = req.query.id;
  let title = req.query.title || videoId;
  const format = req.query.format || 'mp4';

  if (!videoId) {
    return res.status(400).json({ error: "Video ID is required." });
  }

  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: "Invalid YouTube video ID format." });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  // Clean title
  title = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.${format}`);
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Check if file already exists
  if (fs.existsSync(outputPath)) {
    res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
    res.end();
    return;
  }

  // Check concurrent download limit
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    res.write(`data: ${JSON.stringify({ error: "Server busy. Please try again later." })}\n\n`);
    res.end();
    return;
  }

  activeDownloads++;

  // Build yt-dlp command based on format
  let command;
  if (format === 'mp3') {
    command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
  } else {
    // For MP4, we download the pre-merged best quality video
    command = `${ytDlpPath} --cookies ${cookiePath} -f "best" --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
  }

  console.log("Running download command:", command);

  const child = exec(command, { timeout: DOWNLOAD_TIMEOUT });

  // Progress tracking
  let progress = 0;
  child.stderr.on('data', (data) => {
    const progressMatch = data.match(/\[download\]\s+(\d+\.\d+)%/);
    if (progressMatch) {
      progress = parseFloat(progressMatch[1]);
      // Also send download speed if available
      const speedMatch = data.match(/\[download\]\s+([\d.]+[KM]iB)\/s/);
      const speed = speedMatch ? speedMatch[1] : null;
      res.write(`data: ${JSON.stringify({ progress, speed })}\n\n`);
    }
    
    // Send ETA if available
    const etaMatch = data.match(/ETA (\d+:\d+)/);
    if (etaMatch) {
      res.write(`data: ${JSON.stringify({ eta: etaMatch[1] })}\n\n`);
    }
  });

  child.on('close', (code) => {
    activeDownloads--;
    if (code === 0) {
      res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
    } else {
      res.write(`data: ${JSON.stringify({ error: "Download failed. Please try again." })}\n\n`);
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }
    res.end();
  });
});

// File download endpoint
app.get("/download-file", (req, res) => {
  const filePath = decodeURIComponent(req.query.path);

  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  res.download(filePath, path.basename(filePath), (err) => {
    if (err) {
      console.error("Download error:", err);
      return res.status(500).send("Download failed");
    }
    
    // Schedule cleanup after 1 week
    setTimeout(() => {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error("Cleanup error:", err);
      }
    }, 10080000); // 1 minute = 60000
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`CPU Cores: ${CPU_COUNT}`);
  console.log(`Max concurrent downloads: ${MAX_CONCURRENT_DOWNLOADS}`);
});
