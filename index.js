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

// Get CPU count for optimal parallel downloads
const CPU_COUNT = os.cpus().length;

// HTML Template with format selection
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>YouTube Video Downloader</title>
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
        .format-selector { margin: 15px 0; }
        .format-selector label { margin: 0 10px; cursor: pointer; }
        .format-selector input { width: auto; margin-right: 5px; }
        .thumbnail { max-width: 100%; margin-top: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>YouTube Video Downloader</h1>
        <p>Enter YouTube Video URL:</p>
        <input type="text" id="videoUrl" placeholder="e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ">
        <button onclick="getVideoInfo()">Get Video Info</button>
        
        <div id="videoInfo" style="display:none;">
            <img id="thumbnail" class="thumbnail" src="" alt="Video thumbnail">
            <div id="title"></div>
            <div id="duration"></div>
            
            <div class="format-selector">
                <h3>Select Download Format:</h3>
                <label><input type="radio" name="format" value="mp4" checked> MP4 (Video - Best Quality)</label>
                <label><input type="radio" name="format" value="720"> MP4 (720p HD)</label>
                <label><input type="radio" name="format" value="480"> MP4 (480p)</label>
                <label><input type="radio" name="format" value="360"> MP4 (360p)</label>
                <label><input type="radio" name="format" value="mp3"> MP3 (Audio Only)</label>
            </div>
            
            <button id="downloadBtn" onclick="downloadVideo()">Download Video</button>
        </div>
        
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
        let videoInfo = {};
        let eventSource = null;
        
        function getVideoInfo() {
            const videoUrl = document.getElementById('videoUrl').value.trim();
            
            if (!videoUrl || !videoUrl.includes('youtube.com')) {
                showResult('Please enter a valid YouTube URL', 'error');
                return;
            }
            
            showResult('Fetching video information...', 'success');
            
            fetch('/get-video-info?url=' + encodeURIComponent(videoUrl))
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        showResult(data.error, 'error');
                        return;
                    }
                    
                    videoInfo = data;
                    
                    // Display video info
                    document.getElementById('thumbnail').src = data.thumbnail;
                    document.getElementById('title').textContent = data.title;
                    document.getElementById('duration').textContent = 'Duration: ' + data.duration;
                    document.getElementById('videoInfo').style.display = 'block';
                    
                    showResult('Ready to download', 'success');
                })
                .catch(error => {
                    showResult('Failed to get video information', 'error');
                    console.error(error);
                });
        }
        
        function downloadVideo() {
            if (!videoInfo.id) {
                showResult('Please get video information first', 'error');
                return;
            }
            
            const format = document.querySelector('input[name="format"]:checked').value;
            
            showResult('Starting download...', 'success');
            document.getElementById('downloadBtn').disabled = true;
            document.getElementById('progress').style.display = 'block';
            
            // Setup progress updates via SSE
            eventSource = new EventSource('/download-video?id=' + videoInfo.id + '&title=' + encodeURIComponent(videoInfo.title) + '&format=' + format);
            
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
                    showResult('Download complete!', 'success');
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadBtn').disabled = false;
                    
                    // Create download link
                    const downloadLink = document.createElement('a');
                    downloadLink.href = data.url;
                    downloadLink.textContent = 'Click here if download does not start automatically';
                    downloadLink.style.display = 'block';
                    downloadLink.style.marginTop = '10px';
                    document.getElementById('result').appendChild(downloadLink);
                    
                    // Start download automatically
                    window.location.href = data.url;
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

app.get("/get-video-info", async (req, res) => {
    const videoUrl = req.query.url;
    
    if (!videoUrl) {
        return res.status(400).json({ error: "YouTube URL is required." });
    }

    try {
        // Extract video ID from URL
        let videoId;
        try {
            const url = new URL(videoUrl.includes('://') ? videoUrl : 'https://' + videoUrl);
            if (url.hostname === 'youtu.be') {
                videoId = url.pathname.slice(1);
            } else {
                videoId = url.searchParams.get('v');
            }
        } catch (e) {
            return res.status(400).json({ error: "Invalid YouTube URL" });
        }

        if (!videoId) {
            return res.status(400).json({ error: "Could not extract video ID from URL" });
        }

        // Get video info using yt-dlp
        const command = `${ytDlpPath} --dump-json --no-warnings "${videoUrl}"`;
        const { stdout } = await execPromise(command);
        
        const videoInfo = JSON.parse(stdout);
        
        // Format response
        const response = {
            id: videoInfo.id,
            title: videoInfo.title,
            thumbnail: videoInfo.thumbnail,
            duration: formatDuration(videoInfo.duration),
            formats: []
        };

        return res.json(response);
    } catch (error) {
        console.error("Error getting video info:", error);
        return res.status(500).json({ error: "Failed to get video information" });
    }
});

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    return [
        hours > 0 ? hours.toString().padStart(2, '0') : null,
        minutes.toString().padStart(2, '0'),
        secs.toString().padStart(2, '0')
    ].filter(Boolean).join(':');
}

// SSE endpoint for video download progress
app.get("/download-video", (req, res) => {
    const videoId = req.query.id;
    let title = req.query.title || videoId;
    const format = req.query.format || 'mp4';
    
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Clean title for filename
    title = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.${format === 'mp3' ? 'mp3' : 'mp4'}`);
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

    // Build command based on format
    let command;
    switch(format) {
        case 'mp3':
            command = `${ytDlpPath} -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${videoUrl}"`;
            break;
        case '360':
            command = `${ytDlpPath} -f "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]" --merge-output-format mp4 -o "${outputPath}" "${videoUrl}"`;
            break;
        case '480':
            command = `${ytDlpPath} -f "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]" --merge-output-format mp4 -o "${outputPath}" "${videoUrl}"`;
            break;
        case '720':
            command = `${ytDlpPath} -f "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]" --merge-output-format mp4 -o "${outputPath}" "${videoUrl}"`;
            break;
        default: // Best quality
            command = `${ytDlpPath} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 -o "${outputPath}" "${videoUrl}"`;
    }

    console.log("Running download command:", command);
    
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

    const filename = path.basename(filePath);
    
    res.download(filePath, filename, (err) => {
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
    res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
    console.log(`YouTube Video Downloader running on port ${PORT}`);
    console.log(`CPU Cores: ${CPU_COUNT}`);
    console.log(`Max concurrent downloads: ${MAX_CONCURRENT_DOWNLOADS}`);
});
