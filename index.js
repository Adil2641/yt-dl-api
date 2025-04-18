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

// HTML Template with improved design and owner name
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
            max-width: 1000px;
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
        
        .tabs {
            display: flex;
            margin-bottom: 1.5rem;
            border-bottom: 1px solid #ddd;
        }
        
        .tab {
            padding: 0.8rem 1.5rem;
            cursor: pointer;
            font-weight: bold;
            border-bottom: 3px solid transparent;
        }
        
        .tab.active {
            border-bottom: 3px solid var(--primary-color);
            color: var(--primary-color);
        }
        
        .tab-content {
            display: none;
        }
        
        .tab-content.active {
            display: block;
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
        
        .search-btn {
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
        
        .progress-container {
            background-color: #e9ecef;
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
            color: var(--dark-color);
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
        
        /* Search results styles */
        .search-results {
            margin-top: 2rem;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 1.5rem;
        }
        
        .video-card {
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
            transition: transform 0.3s;
        }
        
        .video-card:hover {
            transform: translateY(-5px);
        }
        
        .video-thumbnail {
            position: relative;
            padding-top: 56.25%; /* 16:9 aspect ratio */
            overflow: hidden;
        }
        
        .video-thumbnail img {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        
        .video-info {
            padding: 1rem;
        }
        
        .video-title {
            font-weight: bold;
            margin-bottom: 0.5rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        
        .video-channel {
            color: #666;
            font-size: 0.9rem;
            margin-bottom: 0.5rem;
        }
        
        .video-duration {
            background-color: rgba(0, 0, 0, 0.7);
            color: white;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.8rem;
            position: absolute;
            bottom: 0.5rem;
            right: 0.5rem;
        }
        
        .video-actions {
            display: flex;
            justify-content: space-between;
            margin-top: 1rem;
        }
        
        .video-actions button {
            padding: 0.5rem 1rem;
            font-size: 0.9rem;
            margin: 0;
        }
        
        /* Video player styles */
        .video-player-container {
            margin: 2rem 0;
            display: none;
        }
        
        .video-player {
            position: relative;
            padding-top: 56.25%; /* 16:9 aspect ratio */
            background-color: #000;
            border-radius: 8px;
            overflow: hidden;
        }
        
        .video-player iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: none;
        }
        
        .player-actions {
            display: flex;
            justify-content: center;
            gap: 15px;
            margin-top: 1rem;
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
            
            .search-results {
                grid-template-columns: 1fr;
            }
            
            .video-actions {
                flex-direction: column;
                gap: 10px;
            }
            
            .video-actions button {
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
        
        <div class="tabs">
            <div class="tab active" onclick="switchTab('direct')">Direct Download</div>
            <div class="tab" onclick="switchTab('search')">Search Videos</div>
        </div>
        
        <!-- Direct Download Tab -->
        <div id="direct-tab" class="tab-content active">
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
        </div>
        
        <!-- Search Videos Tab -->
        <div id="search-tab" class="tab-content">
            <div class="input-group">
                <input type="text" id="searchQuery" placeholder="Search for YouTube videos...">
                <button class="search-btn" onclick="searchVideos()">
                    <i class="fas fa-search"></i> Search
                </button>
            </div>
            
            <div id="searchResults" class="search-results"></div>
            
            <div class="video-player-container" id="videoPlayerContainer">
                <div class="video-player" id="videoPlayer"></div>
                <div class="player-actions">
                    <button id="downloadMp3BtnPlayer" class="mp3-btn" onclick="downloadFromPlayer('mp3')">
                        <i class="fas fa-music"></i> Download MP3
                    </button>
                    <button id="downloadMp4BtnPlayer" class="mp4-btn" onclick="downloadFromPlayer('mp4')">
                        <i class="fas fa-video"></i> Download MP4
                    </button>
                </div>
            </div>
        </div>
        
        <div id="progress">
            <div class="progress-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="progress-text" id="progressText">0%</div>
        </div>
        
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
        let currentSearchResults = [];
        
        function switchTab(tabName) {
            // Update tab UI
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.remove('active');
            });
            
            document.querySelector(`.tab[onclick="switchTab('${tabName}')"]`).classList.add('active');
            document.getElementById(`${tabName}-tab`).classList.add('active');
            
            // Reset progress and results when switching tabs
            document.getElementById('progress').style.display = 'none';
            document.getElementById('result').style.display = 'none';
        }
        
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
                    document.getElementById('title').textContent = data.title;
                    document.getElementById('downloadOptions').classList.add('show');
                    document.getElementById('downloadMp3Btn').disabled = false;
                    document.getElementById('downloadMp4Btn').disabled = false;
                    showResult('Ready to download', 'success');
                })
                .catch(error => {
                    showResult('Failed to get video information', 'error');
                    console.error(error);
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
            
            // Setup progress updates via SSE
            eventSource = new EventSource(\`/download-progress?id=\${videoId}&title=\${encodeURIComponent(videoTitle)}&format=\${format}\`);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.progress) {
                    const progress = Math.round(data.progress);
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                }
                if (data.url) {
                    // Download complete
                    eventSource.close();
                    window.location.href = data.url;
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadMp3Btn').disabled = false;
                    document.getElementById('downloadMp4Btn').disabled = false;
                }
                if (data.error) {
                    showResult(data.error, 'error');
                    eventSource.close();
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadMp3Btn').disabled = false;
                    document.getElementById('downloadMp4Btn').disabled = false;
                }
            };
            
            eventSource.onerror = function() {
                showResult('Download failed', 'error');
                document.getElementById('progress').style.display = 'none';
                document.getElementById('downloadMp3Btn').disabled = false;
                document.getElementById('downloadMp4Btn').disabled = false;
                eventSource.close();
            };
        }
        
        function searchVideos() {
            const query = document.getElementById('searchQuery').value.trim();
            if (!query) {
                showResult('Please enter a search term', 'error');
                return;
            }
            
            showResult('Searching for videos...', 'success');
            document.getElementById('searchResults').innerHTML = '';
            document.getElementById('videoPlayerContainer').style.display = 'none';
            
            fetch(\`/search-videos?q=\${encodeURIComponent(query)}\`)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    
                    currentSearchResults = data.results || [];
                    renderSearchResults(currentSearchResults);
                    showResult(\`Found \${currentSearchResults.length} videos\`, 'success');
                })
                .catch(error => {
                    showResult('Failed to search videos', 'error');
                    console.error(error);
                });
        }
        
        function renderSearchResults(results) {
            const resultsContainer = document.getElementById('searchResults');
            resultsContainer.innerHTML = '';
            
            if (results.length === 0) {
                resultsContainer.innerHTML = '<p>No videos found. Try a different search term.</p>';
                return;
            }
            
            results.forEach((video, index) => {
                const videoCard = document.createElement('div');
                videoCard.className = 'video-card';
                videoCard.innerHTML = \`
                    <div class="video-thumbnail" onclick="playVideo('\${video.id}', \${index})">
                        <img src="\${video.thumbnail}" alt="\${video.title}">
                        <div class="video-duration">\${video.duration}</div>
                    </div>
                    <div class="video-info">
                        <div class="video-title">\${video.title}</div>
                        <div class="video-channel">\${video.channel}</div>
                        <div class="video-actions">
                            <button class="mp3-btn" onclick="downloadFromSearch('\${video.id}', '\${encodeURIComponent(video.title)}', 'mp3', event)">
                                <i class="fas fa-music"></i> MP3
                            </button>
                            <button class="mp4-btn" onclick="downloadFromSearch('\${video.id}', '\${encodeURIComponent(video.title)}', 'mp4', event)">
                                <i class="fas fa-video"></i> MP4
                            </button>
                        </div>
                    </div>
                \`;
                resultsContainer.appendChild(videoCard);
            });
        }
        
        function playVideo(videoId, index) {
            const video = currentSearchResults[index];
            if (!video) return;
            
            const playerContainer = document.getElementById('videoPlayerContainer');
            const player = document.getElementById('videoPlayer');
            
            player.innerHTML = \`<iframe src="https://www.youtube.com/embed/\${videoId}?autoplay=1" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>\`;
            
            document.getElementById('downloadMp3BtnPlayer').setAttribute('data-video-id', videoId);
            document.getElementById('downloadMp3BtnPlayer').setAttribute('data-video-title', video.title);
            document.getElementById('downloadMp4BtnPlayer').setAttribute('data-video-id', videoId);
            document.getElementById('downloadMp4BtnPlayer').setAttribute('data-video-title', video.title);
            
            playerContainer.style.display = 'block';
            window.scrollTo({
                top: playerContainer.offsetTop - 20,
                behavior: 'smooth'
            });
        }
        
        function downloadFromSearch(videoId, videoTitle, format, event) {
            event.stopPropagation();
            startDownload(videoId, decodeURIComponent(videoTitle), format);
        }
        
        function downloadFromPlayer(format) {
            const videoId = document.getElementById(\`downloadMp4BtnPlayer\`).getAttribute('data-video-id');
            const videoTitle = document.getElementById(\`downloadMp4BtnPlayer\`).getAttribute('data-video-title');
            
            if (!videoId) {
                showResult('No video selected', 'error');
                return;
            }
            
            startDownload(videoId, videoTitle, format);
        }
        
        function startDownload(videoId, videoTitle, format) {
            currentFormat = format;
            showResult('Preparing download...', 'success');
            document.getElementById('progress').style.display = 'block';
            
            // Setup progress updates via SSE
            eventSource = new EventSource(\`/download-progress?id=\${videoId}&title=\${encodeURIComponent(videoTitle)}&format=\${format}\`);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.progress) {
                    const progress = Math.round(data.progress);
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                }
                if (data.url) {
                    // Download complete
                    eventSource.close();
                    window.location.href = data.url;
                    document.getElementById('progress').style.display = 'none';
                }
                if (data.error) {
                    showResult(data.error, 'error');
                    eventSource.close();
                    document.getElementById('progress').style.display = 'none';
                }
            };
            
            eventSource.onerror = function() {
                showResult('Download failed', 'error');
                document.getElementById('progress').style.display = 'none';
                eventSource.close();
            };
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
        
        document.getElementById('searchQuery').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                searchVideos();
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

        const apiResponse = await axios.get(`https://audio-recon-api.onrender.com/adil?url=${videoUrl}`, {
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

// Video search endpoint
app.get("/search-videos", async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: "Search query is required." });
    }

    try {
        // Use YouTube search API or scraping method
        // Note: In a production environment, you should use the official YouTube API
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        // Parse the HTML response to extract video information
        const html = response.data;
        const results = [];
        
        // This is a simplified parser - in reality you'd need a more robust solution
        const videoPattern = /"videoRenderer":\{"videoId":"([^"]+)","thumbnail":\{"thumbnails":\[\{"url":"([^"]+)","width":\d+,"height":\d+\}.*?"title":\{"runs":\[\{"text":"([^"]+)"\}.*?"longBylineText":\{"runs":\[\{"text":"([^"]+)"\}.*?"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"\}.*?\}/g;
        
        let match;
        while ((match = videoPattern.exec(html)) !== null && results.length < 10) {
            results.push({
                id: match[1],
                thumbnail: match[2].replace('\\u0026', '&'),
                title: match[3],
                channel: match[4],
                duration: match[5]
            });
        }

        return res.json({ results });
    } catch (error) {
        console.error("Search error:", error);
        return res.status(500).json({ error: "Failed to search videos" });
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
    
