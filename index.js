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
const CPU_COUNT = os.cpus().length;

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

// HTML Template remains exactly the same as provided
const HTML_TEMPLATE = `
<!DOCTYPE html>
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
</html>
`;

// Routes
app.get("/", (req, res) => {
    res.send(HTML_TEMPLATE);
});

app.get("/get-info", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    // Check cache first
    if (titleCache.has(videoId)) {
        const cached = titleCache.get(videoId);
        if (Date.now() - cached.timestamp < TITLE_CACHE_TTL) {
            return res.json({ 
                title: cached.title,
                duration: cached.duration,
                views: cached.views,
                thumbnail: cached.thumbnail
            });
        }
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
        const source = axios.CancelToken.source();
        const timeout = setTimeout(() => {
            source.cancel('API request timed out');
        }, 30000);

        const apiResponse = await axios.get(`https://noembed.com/embed?url=${videoUrl}`, {
            cancelToken: source.token
        });
        
        clearTimeout(timeout);

        if (apiResponse.data?.title) {
            const videoInfo = {
                title: apiResponse.data.title,
                duration: apiResponse.data.duration || 0,
                views: 0,
                thumbnail: apiResponse.data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                timestamp: Date.now()
            };
            
            titleCache.set(videoId, videoInfo);
            return res.json(videoInfo);
        }
        return res.status(500).json({ error: "Could not retrieve video information" });
    } catch (error) {
        if (axios.isCancel(error)) {
            console.log("API request timed out");
            return res.status(504).json({ error: "API request timed out" });
        }
        console.error("API Error:", error);
        
        // Fallback to basic info if API fails
        try {
            const fallbackInfo = {
                title: `YouTube Video (${videoId})`,
                duration: 0,
                views: 0,
                thumbnail: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
                timestamp: Date.now()
            };
            titleCache.set(videoId, fallbackInfo);
            return res.json(fallbackInfo);
        } catch (fallbackError) {
            return res.status(500).json({ error: "Failed to get video information" });
        }
    }
});

// Enhanced download endpoints with better error handling
app.get("/download-audio", async (req, res) => {
    const { id, quality } = req.query;
    if (!id) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    try {
        // Get video info first
        const infoResponse = await axios.get(`http://localhost:${PORT}/get-info?id=${id}`);
        const title = infoResponse.data.title || id;
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

        const videoUrl = `https://www.youtube.com/watch?v=${id}`;
        let command = `${ytDlpPath} --no-warnings --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${quality === 'best' ? '0' : '5'} --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

        console.log("Running audio download command:", command);
        
        const { stdout, stderr } = await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
        console.log("Audio download stdout:", stdout);
        console.error("Audio download stderr:", stderr);
        
        // Check if download actually failed despite process completing
        if (!fs.existsSync(outputPath)) {
            throw new Error("Download failed - no output file was created");
        }
        
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
            }, 10080000);
        });
    } catch (error) {
        activeDownloads--;
        console.error("Audio download error:", error);
        console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            code: error.code,
            signal: error.signal,
            stdout: error.stdout,
            stderr: error.stderr
        });
        
        let errorMessage = "Failed to download audio";
        if (error.stderr && error.stderr.includes("Video unavailable")) {
            errorMessage = "This video is unavailable (private or removed)";
        } else if (error.message.includes("timeout")) {
            errorMessage = "Download timed out";
        }
        
        return res.status(500).json({ error: errorMessage });
    }
});

app.get("/download-video", async (req, res) => {
    const { id, quality } = req.query;
    if (!id) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    try {
        // Get video info first
        const infoResponse = await axios.get(`http://localhost:${PORT}/get-info?id=${id}`);
        const title = infoResponse.data.title || id;
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

        const videoUrl = `https://www.youtube.com/watch?v=${id}`;
        let format = "best";
        
        if (quality !== "best") {
            format = `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
        }
        
        const command = `${ytDlpPath} --no-warnings --cookies ${cookiePath} -f "${format}" --no-playlist --merge-output-format mp4 --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

        console.log("Running video download command:", command);
        
        const { stdout, stderr } = await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
        console.log("Video download stdout:", stdout);
        console.error("Video download stderr:", stderr);
        
        // Check if download actually failed despite process completing
        if (!fs.existsSync(outputPath)) {
            throw new Error("Download failed - no output file was created");
        }
        
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
            }, 10080000);
        });
    } catch (error) {
        activeDownloads--;
        console.error("Video download error:", error);
        console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            code: error.code,
            signal: error.signal,
            stdout: error.stdout,
            stderr: error.stderr
        });
        
        let errorMessage = "Failed to download video";
        if (error.stderr && error.stderr.includes("Video unavailable")) {
            errorMessage = "This video is unavailable (private or removed)";
        } else if (error.message.includes("timeout")) {
            errorMessage = "Download timed out";
        }
        
        return res.status(500).json({ error: errorMessage });
    }
});

app.get("/download-progress", (req, res) => {
    const { id, title, format, quality } = req.query;
    
    if (!id) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(id)) {
        return res.status(400).json({ error: "Invalid YouTube video ID format." });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Clean title
    const cleanTitle = (title || id).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.${format}`);
    const videoUrl = `https://www.youtube.com/watch?v=${id}`;

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

    // Build yt-dlp command based on format and quality
    let command;
    if (format === 'mp3') {
        const audioQuality = quality === 'best' ? '0' : '5';
        command = `${ytDlpPath} --no-warnings --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --audio-quality ${audioQuality} --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
    } else {
        let formatString = "best";
        if (quality !== "best") {
            formatString = `bestvideo[height<=?${quality}]+bestaudio/best[height<=?${quality}]`;
        }
        command = `${ytDlpPath} --no-warnings --cookies ${cookiePath} -f "${formatString}" --merge-output-format mp4 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
    }

    console.log("Running download command:", command);
    
    const child = exec(command, { timeout: DOWNLOAD_TIMEOUT });

    // Progress tracking
    let progress = 0;
    child.stderr.on('data', (data) => {
        const dataStr = data.toString();
        console.log("yt-dlp stderr:", dataStr);
        
        // Check for video unavailable error
        if (dataStr.includes("Video unavailable")) {
            const errorMsg = "This video is unavailable (private or removed)";
            console.error(errorMsg);
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
        console.log("yt-dlp stdout:", data.toString());
    });

    child.on('error', (error) => {
        console.error("Child process error:", error);
        activeDownloads--;
        res.write(`data: ${JSON.stringify({ error: `Download error: ${error.message}` })}\n\n`);
        res.end();
    });

    child.on('close', (code, signal) => {
        activeDownloads--;
        console.log(`Child process closed with code ${code} and signal ${signal}`);
        
        if (code === 0) {
            if (fs.existsSync(outputPath)) {
                res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
            } else {
                const errorMsg = "Download completed but no file was created";
                console.error(errorMsg);
                res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
            }
        } else {
            const errorMsg = `Download failed with code ${code}`;
            console.error(errorMsg);
            res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
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
        }, 10080000);
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
    console.log(`Download folder: ${DOWNLOAD_FOLDER}`);
    console.log(`YT-DLP path: ${ytDlpPath}`);
});
