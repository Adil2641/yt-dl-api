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
const TITLE_CACHE_TTL = 3600000; // 1 hour

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

// HTML Template
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Audio Downloader</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; text-align: center; }
        .container { background-color: #f9f9f9; border-radius: 8px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        input { padding: 10px; width: 70%; margin-right: 10px; border: 1px solid #ddd; border-radius: 4px; }
        button { padding: 10px 20px; background-color: #ff0000; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background-color: #cc0000; }
        button:disabled { background-color: #cccccc; cursor: not-allowed; }
        #result { margin-top: 20px; padding: 10px; border-radius: 4px; }
        .success { background-color: #d4edda; color: #155724; }
        .error { background-color: #f8d7da; color: #721c24; }
        #title { margin-top: 10px; font-weight: bold; }
        #progress { width: 100%; margin-top: 20px; display: none; }
        .progress-bar { height: 20px; background-color: #e0e0e0; border-radius: 10px; overflow: hidden; }
        .progress { height: 100%; background-color: #4CAF50; width: 0%; transition: width 0.3s; }
    </style>
</head>
<body>
    <div class="container">
        <h1>YouTube Audio Downloader</h1>
        <p>Enter YouTube Video ID or URL:</p>
        <input type="text" id="videoId" placeholder="e.g., dQw4w9WgXcQ or https://youtu.be/dQw4w9WgXcQ">
        <button onclick="getVideoInfo()">Get Info</button>
        <div id="title"></div>
        <button id="downloadBtn" style="display:none;" onclick="downloadAudio()">Download MP3</button>
        
        <div id="progress" style="display:none;">
            <p>Download Progress:</p>
            <div class="progress-bar">
                <div class="progress" id="progressBar"></div>
            </div>
            <p id="progressText">0%</p>
        </div>
        
        <div id="result"></div>
    </div>
    
    <script>
        let videoTitle = '';
        let videoId = '';
        let eventSource = null;
        
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
            document.getElementById('downloadBtn').disabled = true;
            
            fetch(\`/get-title?id=\${videoId}\`)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    videoTitle = data.title;
                    document.getElementById('title').textContent = data.title;
                    document.getElementById('downloadBtn').style.display = 'inline-block';
                    document.getElementById('downloadBtn').disabled = false;
                    showResult('Ready to download', 'success');
                })
                .catch(error => {
                    showResult('Failed to get video information', 'error');
                    console.error(error);
                });
        }
        
        function downloadAudio() {
            if (!videoId) {
                showResult('Please enter a valid YouTube video ID or URL', 'error');
                return;
            }
            
            showResult('Preparing download...', 'success');
            document.getElementById('downloadBtn').disabled = true;
            document.getElementById('progress').style.display = 'block';
            
            // Setup progress updates via SSE
            eventSource = new EventSource(\`/download-progress?id=\${videoId}&title=\${encodeURIComponent(videoTitle)}\`);
            
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
                    document.getElementById('downloadBtn').disabled = false;
                }
                if (data.error) {
                    showResult(data.error, 'error');
                    eventSource.close();
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadBtn').disabled = false;
                }
            };
            
            eventSource.onerror = function() {
                showResult('Download failed', 'error');
                document.getElementById('progress').style.display = 'none';
                document.getElementById('downloadBtn').disabled = false;
                eventSource.close();
            };
        }
        
        function showResult(message, type) {
            const resultDiv = document.getElementById('result');
            resultDiv.textContent = message;
            resultDiv.className = type;
            resultDiv.style.display = 'block';
        }
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

// SSE endpoint for progress updates
app.get("/download-progress", (req, res) => {
    const videoId = req.query.id;
    let title = req.query.title || videoId;
    
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
    const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.mp3`);
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

    // Optimized yt-dlp command
    const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments ${CPU_COUNT} --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

    console.log("Running optimized download command:", command);
    
    const child = exec(command, { timeout: DOWNLOAD_TIMEOUT });

    // Progress tracking
    let progress = 0;
    child.stderr.on('data', (data) => {
        const progressMatch = data.match(/\[download\]\s+(\d+\.\d+)%/);
        if (progressMatch) {
            progress = parseFloat(progressMatch[1]);
            res.write(`data: ${JSON.stringify({ progress })}\n\n`);
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
        
        // Schedule cleanup after 1 hour
        setTimeout(() => {
            try {
                fs.unlinkSync(filePath);
            } catch (err) {
                console.error("Cleanup error:", err);
            }
        }, 3600000);
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
