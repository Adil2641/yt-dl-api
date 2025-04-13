const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");
const cookiePath = path.join(__dirname, "cookies.txt");

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

// Serve static files (CSS, JS if needed)
app.use(express.static('public'));

// Main page route
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>YouTube Audio Downloader</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    text-align: center;
                    background-color: #f5f5f5;
                    color: #333;
                }
                .container {
                    background-color: white;
                    border-radius: 12px;
                    padding: 25px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                    margin-bottom: 20px;
                }
                input {
                    padding: 12px;
                    width: 70%;
                    margin-right: 10px;
                    border: 2px solid #ddd;
                    border-radius: 6px;
                    font-size: 16px;
                    transition: border 0.3s;
                }
                input:focus {
                    border-color: #ff0000;
                    outline: none;
                }
                button {
                    padding: 12px 24px;
                    background-color: #ff0000;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                    transition: all 0.3s;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                button:hover {
                    background-color: #cc0000;
                    transform: translateY(-2px);
                    box-shadow: 0 4px 8px rgba(0,0,0,0.15);
                }
                #result {
                    margin-top: 20px;
                    padding: 15px;
                    border-radius: 6px;
                    font-size: 16px;
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
                #title {
                    margin: 15px 0;
                    font-weight: bold;
                    font-size: 18px;
                    color: #333;
                }
                .owner-footer {
                    margin-top: 30px;
                    font-size: 14px;
                    color: #666;
                    position: relative;
                    padding-top: 15px;
                }
                .owner-footer::before {
                    content: "";
                    position: absolute;
                    top: 0;
                    left: 25%;
                    right: 25%;
                    height: 1px;
                    background: linear-gradient(to right, transparent, #ff0000, transparent);
                }
                .owner-name {
                    font-weight: bold;
                    color: #ff0000;
                    font-size: 16px;
                    letter-spacing: 1px;
                    text-transform: uppercase;
                    margin-left: 5px;
                }
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
                <div id="result"></div>
            </div>
            
            <div class="owner-footer">
                Developed with ❤️ by <span class="owner-name">ADIL</span>
            </div>
            
            <script>
                let videoTitle = '';
                let videoId = '';
                
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
                    
                    showResult('Downloading... please wait', 'success');
                    window.location.href = \`/download?id=\${videoId}&title=\${encodeURIComponent(videoTitle)}\`;
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
    `);
});

// ... [rest of your existing code remains the same] ...

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
