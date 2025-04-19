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
        /* Your CSS styles here (unchanged) */
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
            <div class="tab active" data-tab="direct">Direct Download</div>
            <div class="tab" data-tab="search">Search Videos</div>
        </div>
        
        <!-- Direct Download Tab -->
        <div id="direct-tab" class="tab-content active">
            <div class="input-group">
                <input type="text" id="videoId" placeholder="Enter YouTube URL or Video ID (e.g., dQw4w9WgXcQ)">
                <button class="get-info-btn">Get Info</button>
            </div>
            
            <div id="title"></div>
            
            <div class="download-options" id="downloadOptions">
                <button id="downloadMp3Btn" class="mp3-btn">
                    <i class="fas fa-music"></i> Download MP3
                </button>
                <button id="downloadMp4Btn" class="mp4-btn">
                    <i class="fas fa-video"></i> Download MP4
                </button>
            </div>
        </div>
        
        <!-- Search Videos Tab -->
        <div id="search-tab" class="tab-content">
            <div class="input-group">
                <input type="text" id="searchQuery" placeholder="Search for YouTube videos...">
                <button class="search-btn">
                    <i class="fas fa-search"></i> Search
                </button>
            </div>
            
            <div id="searchResults" class="search-results"></div>
            
            <div class="video-player-container" id="videoPlayerContainer">
                <div class="video-player" id="videoPlayer"></div>
                <div class="player-actions">
                    <button id="downloadMp3BtnPlayer" class="mp3-btn">
                        <i class="fas fa-music"></i> Download MP3
                    </button>
                    <button id="downloadMp4BtnPlayer" class="mp4-btn">
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
        // Define all variables and functions first
        let videoTitle = '';
        let videoId = '';
        let eventSource = null;
        let currentFormat = '';
        let currentSearchResults = [];
        
        // Helper function to show results
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = message;
            resultDiv.className = type;
            resultDiv.style.display = 'block';
        }
        
        // Tab switching function
        function switchTab(tabName) {
            // Update tab UI
            document.querySelectorAll('.tab').forEach(function(tab) {
                tab.classList.remove('active');
            });
            document.querySelectorAll('.tab-content').forEach(function(content) {
                content.classList.remove('active');
            });
            
            document.querySelector('.tab[data-tab="' + tabName + '"]').classList.add('active');
            document.getElementById(tabName + '-tab').classList.add('active');
        }
        
        // Get video info function
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
            
            fetch('/get-title?id=' + videoId)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    videoTitle = data.title;
                    document.getElementById('title').textContent = data.title;
                    document.getElementById('downloadOptions').classList.add('show');
                    showResult('Ready to download', 'success');
                })
                .catch(function(error) {
                    showResult('Failed to get video information', 'error');
                    console.error(error);
                });
        }
        
        // Download media function
        function downloadMedia(format) {
            if (!videoId) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                return;
            }
            
            currentFormat = format;
            showResult('Preparing download...', 'success');
            document.getElementById('progress').style.display = 'block';
            
            // Setup progress updates via SSE
            eventSource = new EventSource('/download-progress?id=' + videoId + '&title=' + encodeURIComponent(videoTitle) + '&format=' + format);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.progress) {
                    const progress = Math.round(data.progress);
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                }
                if (data.url) {
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
        }
        
        // Search videos function
        function searchVideos() {
            const query = document.getElementById('searchQuery').value.trim();
            if (!query) {
                showResult('Please enter a search term', 'error');
                return;
            }
            
            showResult('Searching for videos...', 'success');
            document.getElementById('searchResults').innerHTML = '';
            document.getElementById('videoPlayerContainer').style.display = 'none';
            
            fetch('/search-videos?q=' + encodeURIComponent(query))
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    
                    currentSearchResults = data.results || [];
                    renderSearchResults(currentSearchResults);
                    showResult('Found ' + currentSearchResults.length + ' videos', 'success');
                })
                .catch(function(error) {
                    showResult('Failed to search videos', 'error');
                    console.error(error);
                });
        }
        
        // Render search results
        function renderSearchResults(results) {
            const resultsContainer = document.getElementById('searchResults');
            resultsContainer.innerHTML = '';
            
            if (results.length === 0) {
                resultsContainer.innerHTML = '<p>No videos found. Try a different search term.</p>';
                return;
            }
            
            results.forEach(function(video, index) {
                const videoCard = document.createElement('div');
                videoCard.className = 'video-card';
                
                // Properly escape strings
                const thumbnailSrc = video.thumbnail;
                const titleEscaped = video.title.replace(/"/g, '&quot;');
                const titleEncoded = encodeURIComponent(video.title);
                
                videoCard.innerHTML = [
                    '<div class="video-thumbnail">',
                    '<img src="' + thumbnailSrc + '" alt="' + titleEscaped + '">',
                    '<div class="video-duration">' + video.duration + '</div>',
                    '</div>',
                    '<div class="video-info">',
                    '<div class="video-title">' + video.title + '</div>',
                    '<div class="video-channel">' + video.channel + '</div>',
                    '<div class="video-actions">',
                    '<button class="mp3-btn" data-video-id="' + video.id + '" data-video-title="' + titleEncoded + '">',
                    '<i class="fas fa-music"></i> MP3',
                    '</button>',
                    '<button class="mp4-btn" data-video-id="' + video.id + '" data-video-title="' + titleEncoded + '">',
                    '<i class="fas fa-video"></i> MP4',
                    '</button>',
                    '</div>',
                    '</div>'
                ].join('');
                
                resultsContainer.appendChild(videoCard);
                
                // Add event listeners
                videoCard.querySelector('.mp3-btn').addEventListener('click', function(e) {
                    e.stopPropagation();
                    downloadFromSearch(video.id, titleEncoded, 'mp3', e);
                });
                
                videoCard.querySelector('.mp4-btn').addEventListener('click', function(e) {
                    e.stopPropagation();
                    downloadFromSearch(video.id, titleEncoded, 'mp4', e);
                });
                
                videoCard.querySelector('.video-thumbnail').addEventListener('click', function() {
                    playVideo(video.id, index);
                });
            });
        }
        
        // Play video function
        function playVideo(videoId, index) {
            const video = currentSearchResults[index];
            if (!video) return;
            
            const playerContainer = document.getElementById('videoPlayerContainer');
            const player = document.getElementById('videoPlayer');
            
            player.innerHTML = '<iframe src="https://www.youtube.com/embed/' + videoId + '?autoplay=1" frameborder="0" allowfullscreen></iframe>';
            
            document.getElementById('downloadMp3BtnPlayer').setAttribute('data-video-id', videoId);
            document.getElementById('downloadMp3BtnPlayer').setAttribute('data-video-title', video.title);
            document.getElementById('downloadMp4BtnPlayer').setAttribute('data-video-id', videoId);
            document.getElementById('downloadMp4BtnPlayer').setAttribute('data-video-title', video.title);
            
            playerContainer.style.display = 'block';
        }
        
        // Download from search results
        function downloadFromSearch(videoId, videoTitle, format, event) {
            event.stopPropagation();
            startDownload(videoId, decodeURIComponent(videoTitle), format);
        }
        
        // Download from player
        function downloadFromPlayer(format) {
            const videoId = document.getElementById('downloadMp4BtnPlayer').getAttribute('data-video-id');
            const videoTitle = document.getElementById('downloadMp4BtnPlayer').getAttribute('data-video-title');
            
            if (!videoId) {
                showResult('No video selected', 'error');
                return;
            }
            
            startDownload(videoId, videoTitle, format);
        }
        
        // Start download function
        function startDownload(videoId, videoTitle, format) {
            currentFormat = format;
            showResult('Preparing download...', 'success');
            document.getElementById('progress').style.display = 'block';
            
            eventSource = new EventSource('/download-progress?id=' + videoId + '&title=' + encodeURIComponent(videoTitle) + '&format=' + format);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                if (data.progress) {
                    document.getElementById('progressBar').style.width = data.progress + '%';
                    document.getElementById('progressText').textContent = data.progress + '%';
                }
                if (data.url) {
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
        }
        
        // Initialize event listeners
        document.addEventListener('DOMContentLoaded', function() {
            // Tab switching
            document.querySelectorAll('.tab').forEach(function(tab) {
                tab.addEventListener('click', function() {
                    switchTab(this.getAttribute('data-tab'));
                });
            });
            
            // Get Info button
            document.querySelector('.get-info-btn').addEventListener('click', getVideoInfo);
            
            // Search button
            document.querySelector('.search-btn').addEventListener('click', searchVideos);
            
            // Download buttons
            document.getElementById('downloadMp3Btn').addEventListener('click', function() {
                downloadMedia('mp3');
            });
            
            document.getElementById('downloadMp4Btn').addEventListener('click', function() {
                downloadMedia('mp4');
            });
            
            // Player download buttons
            document.getElementById('downloadMp3BtnPlayer').addEventListener('click', function() {
                downloadFromPlayer('mp3');
            });
            
            document.getElementById('downloadMp4BtnPlayer').addEventListener('click', function() {
                downloadFromPlayer('mp4');
            });
            
            // Enter key handlers
            document.getElementById('videoId').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') getVideoInfo();
            });
            
            document.getElementById('searchQuery').addEventListener('keypress', function(e) {
                if (e.key === 'Enter') searchVideos();
            });
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
        const response = await axios.get(`https://audio-recon-api.onrender.com/adil?url=${videoUrl}`);
        
        if (response.data?.title) {
            titleCache.set(videoId, {
                title: response.data.title,
                timestamp: Date.now()
            });
            return res.json({ title: response.data.title });
        }
        return res.status(500).json({ error: "Could not retrieve video title" });
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Failed to get video title from API" });
    }
});

app.get("/search-videos", async (req, res) => {
    const query = req.query.q;
    if (!query) {
        return res.status(400).json({ error: "Search query is required." });
    }

    try {
        const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });

        const html = response.data;
        const results = [];
        const videoPattern = /"videoRenderer":\{"videoId":"([^"]+)","thumbnail":\{"thumbnails":\[\{"url":"([^"]+)","width":\d+,"height":\d+\}.*?"title":\{"runs":\[\{"text":"([^"]+)"\}.*?"longBylineText":\{"runs":\[\{"text":"([^"]+)"\}.*?"lengthText":\{"accessibility":\{"accessibilityData":\{"label":"([^"]+)"\}.*?\}/g;
        
        let match;
        while ((match = videoPattern.exec(html)) !== null && results.length < 10) {
            results.push({
                id: match[1],
                thumbnail: match[2].replace(/\\u0026/g, '&'),
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

app.get("/download-audio", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    try {
        const titleResponse = await axios.get(`http://localhost:${PORT}/get-title?id=${videoId}`);
        const title = titleResponse.data.title || videoId;
        const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.mp3`);
        
        if (fs.existsSync(outputPath)) {
            return res.download(outputPath, `${cleanTitle}.mp3`);
        }

        if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            return res.status(429).json({ error: "Server busy. Please try again later." });
        }

        activeDownloads++;

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

        await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
        
        activeDownloads--;
        return res.download(outputPath, `${cleanTitle}.mp3`, (err) => {
            if (err) console.error("Download error:", err);
            setTimeout(() => {
                try { fs.unlinkSync(outputPath); } catch (err) { console.error("Cleanup error:", err); }
            }, 10080000);
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
        const titleResponse = await axios.get(`http://localhost:${PORT}/get-title?id=${videoId}`);
        const title = titleResponse.data.title || videoId;
        const cleanTitle = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
        const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.mp4`);
        
        if (fs.existsSync(outputPath)) {
            return res.download(outputPath, `${cleanTitle}.mp4`);
        }

        if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
            return res.status(429).json({ error: "Server busy. Please try again later." });
        }

        activeDownloads++;

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const command = `${ytDlpPath} --cookies ${cookiePath} -f "best" --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

        await execPromise(command, { timeout: DOWNLOAD_TIMEOUT });
        
        activeDownloads--;
        return res.download(outputPath, `${cleanTitle}.mp4`, (err) => {
            if (err) console.error("Download error:", err);
            setTimeout(() => {
                try { fs.unlinkSync(outputPath); } catch (err) { console.error("Cleanup error:", err); }
            }, 10080000);
        });
    } catch (error) {
        activeDownloads--;
        console.error("Video download error:", error);
        return res.status(500).json({ error: "Failed to download video" });
    }
});

app.get("/download-progress", (req, res) => {
    const videoId = req.query.id;
    let title = req.query.title || videoId;
    const format = req.query.format || 'mp4';
    
    if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: "Invalid YouTube video ID format." });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    title = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.${format}`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    if (fs.existsSync(outputPath)) {
        res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
        res.end();
        return;
    }

    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
        res.write(`data: ${JSON.stringify({ error: "Server busy. Please try again later." })}\n\n`);
        res.end();
        return;
    }

    activeDownloads++;

    let command;
    if (format === 'mp3') {
        command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
    } else {
        command = `${ytDlpPath} --cookies ${cookiePath} -f "best" --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;
    }

    const child = exec(command, { timeout: DOWNLOAD_TIMEOUT });

    child.stderr.on('data', (data) => {
        const progressMatch = data.match(/\[download\]\s+(\d+\.\d+)%/);
        if (progressMatch) {
            res.write(`data: ${JSON.stringify({ progress: parseFloat(progressMatch[1]) })}\n\n`);
        }
    });

    child.on('close', (code) => {
        activeDownloads--;
        if (code === 0) {
            res.write(`data: ${JSON.stringify({ url: `/download-file?path=${encodeURIComponent(outputPath)}` })}\n\n`);
        } else {
            res.write(`data: ${JSON.stringify({ error: "Download failed. Please try again." })}\n\n`);
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (err) { console.error("Cleanup error:", err); }
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
        if (err) console.error("Download error:", err);
        setTimeout(() => {
            try { fs.unlinkSync(filePath); } catch (err) { console.error("Cleanup error:", err); }
        }, 10080000);
    });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`CPU Cores: ${CPU_COUNT}`);
    console.log(`Max concurrent downloads: ${MAX_CONCURRENT_DOWNLOADS}`);
});
