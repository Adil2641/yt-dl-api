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
        #status { margin-top: 20px; padding: 10px; border-radius: 4px; }
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
        .video-info { margin-top: 15px; text-align: left; padding: 15px; background: #f0f0f0; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>YouTube Video Downloader</h1>
        <p>Enter YouTube Video URL:</p>
        <input type="text" id="videoUrl" placeholder="e.g., https://www.youtube.com/watch?v=dQw4w9WgXcQ">
        <button onclick="getVideoInfo()">Get Video Info</button>
        
        <div id="videoInfo" style="display:none;">
            <div class="video-info">
                <img id="thumbnail" class="thumbnail" src="" alt="Video thumbnail">
                <div id="title"></div>
                <div id="duration"></div>
                <div id="views"></div>
            </div>
            
            <div class="format-selector">
                <h3>Select Download Format:</h3>
                <label><input type="radio" name="format" value="mp4" checked> MP4 (Best Quality)</label>
                <label><input type="radio" name="format" value="720"> MP4 (720p HD)</label>
                <label><input type="radio" name="format" value="480"> MP4 (480p)</label>
                <label><input type="radio" name="format" value="360"> MP4 (360p)</label>
                <label><input type="radio" name="format" value="mp3"> MP3 (Audio Only)</label>
            </div>
            
            <button id="downloadBtn" onclick="downloadVideo()">Download</button>
        </div>
        
        <div id="progress" style="display:none;">
            <p>Download Progress:</p>
            <div class="progress-bar">
                <div class="progress" id="progressBar"></div>
            </div>
            <p id="progressText">0%</p>
        </div>
        
        <div id="status"></div>
    </div>
    
    <script>
        let videoInfo = {};
        let eventSource = null;
        
        function showStatus(message, type) {
            const statusDiv = document.getElementById('status');
            statusDiv.textContent = message;
            statusDiv.className = type;
            statusDiv.style.display = 'block';
        }
        
        function clearStatus() {
            document.getElementById('status').style.display = 'none';
        }
        
        function getVideoInfo() {
            const videoUrl = document.getElementById('videoUrl').value.trim();
            
            if (!videoUrl || !videoUrl.includes('youtube.com')) {
                showStatus('Please enter a valid YouTube URL', 'error');
                return;
            }
            
            showStatus('Fetching video information...', 'success');
            
            fetch('/get-video-info?url=' + encodeURIComponent(videoUrl))
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.error) {
                        showStatus(data.error, 'error');
                        return;
                    }
                    
                    console.log('Received data:', data); // Debug log
                    
                    videoInfo = data;
                    
                    // Display video info
                    if (data.thumbnail) {
                        document.getElementById('thumbnail').src = data.thumbnail;
                        document.getElementById('thumbnail').style.display = 'block';
                    }
                    if (data.title) {
                        document.getElementById('title').textContent = 'Title: ' + data.title;
                    }
                    if (data.duration) {
                        document.getElementById('duration').textContent = 'Duration: ' + data.duration;
                    }
                    if (data.views) {
                        document.getElementById('views').textContent = 'Views: ' + data.views.toLocaleString();
                    }
                    
                    document.getElementById('videoInfo').style.display = 'block';
                    document.getElementById('downloadBtn').disabled = false;
                    clearStatus();
                })
                .catch(error => {
                    console.error('Error:', error);
                    showStatus('Failed to get video information: ' + error.message, 'error');
                });
        }
        
        function downloadVideo() {
            if (!videoInfo.id) {
                showStatus('Please get video information first', 'error');
                return;
            }
            
            const format = document.querySelector('input[name="format"]:checked').value;
            
            showStatus('Starting download...', 'success');
            document.getElementById('downloadBtn').disabled = true;
            document.getElementById('progress').style.display = 'block';
            
            eventSource = new EventSource('/download-video?id=' + videoInfo.id + '&title=' + encodeURIComponent(videoInfo.title) + '&format=' + format);
            
            eventSource.onmessage = function(event) {
                const data = JSON.parse(event.data);
                
                if (data.progress) {
                    const progress = Math.round(data.progress);
                    document.getElementById('progressBar').style.width = progress + '%';
                    document.getElementById('progressText').textContent = progress + '%';
                }
                
                if (data.url) {
                    eventSource.close();
                    showStatus('Download complete!', 'success');
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadBtn').disabled = false;
                    
                    // Start download automatically
                    window.location.href = data.url;
                }
                
                if (data.error) {
                    showStatus(data.error, 'error');
                    eventSource.close();
                    document.getElementById('progress').style.display = 'none';
                    document.getElementById('downloadBtn').disabled = false;
                }
            };
            
            eventSource.onerror = function() {
                showStatus('Download failed', 'error');
                document.getElementById('progress').style.display = 'none';
                document.getElementById('downloadBtn').disabled = false;
                eventSource.close();
            };
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
            views: videoInfo.view_count,
            formats: []
        };

        console.log('Sending video info:', response); // Debug log
        
        return res.json(response);
    } catch (error) {
        console.error("Error getting video info:", error);
        return res.status(500).json({ error: "Failed to get video information: " + error.message });
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

// [Rest of your server code remains the same...]

app.listen(PORT, () => {
    console.log(`YouTube Video Downloader running on port ${PORT}`);
});
