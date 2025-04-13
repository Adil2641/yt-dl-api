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

// AI-based malicious link detection function
async function isMaliciousLink(url) {
    try {
        // Check for common malicious patterns
        const maliciousPatterns = [
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

        // Check against patterns
        for (const pattern of maliciousPatterns) {
            if (pattern.test(url)) {
                return true;
            }
        }

        // You could add an actual AI API call here if you have one
        // For example:
        // const aiResponse = await axios.post('https://ai-malicious-link-detection.com/api', { url });
        // return aiResponse.data.isMalicious;

        return false;
    } catch (error) {
        console.error("AI detection error:", error);
        return true; // Fail-safe - if detection fails, assume malicious
    }
}

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
                    font-family: Arial, sans-serif;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                    text-align: center;
                }
                .container {
                    background-color: #f9f9f9;
                    border-radius: 8px;
                    padding: 20px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                }
                input {
                    padding: 10px;
                    width: 70%;
                    margin-right: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                button {
                    padding: 10px 20px;
                    background-color: #ff0000;
                    color: white;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }
                button:hover {
                    background-color: #cc0000;
                }
                #result {
                    margin-top: 20px;
                    padding: 10px;
                    border-radius: 4px;
                }
                .success {
                    background-color: #d4edda;
                    color: #155724;
                }
                .error {
                    background-color: #f8d7da;
                    color: #721c24;
                }
                #title {
                    margin-top: 10px;
                    font-weight: bold;
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

// Route to get video title from API
app.get("/get-title", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
        // Call the audio recognition API to get the real title
        const apiResponse = await axios.get(`https://audio-recon-api.onrender.com/adil?url=${videoUrl}`);
        
        if (apiResponse.data && apiResponse.data.title) {
            return res.json({ title: apiResponse.data.title });
        } else {
            return res.status(500).json({ error: "Could not retrieve video title" });
        }
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({ error: "Failed to get video title from API" });
    }
});

// Download route with security check
app.get("/download", async (req, res) => {
    const videoId = req.query.id;
    let title = req.query.title || videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    // Security check - verify this is a valid YouTube video ID
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: "Invalid YouTube video ID format." });
    }

    // AI-based malicious link detection
    const constructedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const isMalicious = await isMaliciousLink(constructedUrl);
    
    if (isMalicious) {
        console.log(`Blocked potentially malicious download request for ID: ${videoId}`);
        return res.status(403).json({ error: "Download request blocked for security reasons." });
    }

    // Clean the title to make it filesystem-safe
    title = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.mp3`);

    const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 -o "${outputPath}" "${videoUrl}"`;

    console.log("Running command:", command);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp error:", stderr);
            return res.status(500).json({
                error: "Failed to download audio.",
                details: stderr,
            });
        }

        res.download(outputPath, `${title}.mp3`, (err) => {
            if (err) {
                console.error("File send error:", err);
                res.status(500).send("Error sending file.");
            }
            try {
                fs.unlinkSync(outputPath); // Clean up file
            } catch (err) {
                console.warn("Failed to clean up:", err);
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
