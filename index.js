const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");
const cookiePath = path.join(__dirname, "cookies.txt");

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

// Serve static files
app.use(express.static('public'));

// Main page route
app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>YouTube Downloader</title>
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
                    margin: 10px 0;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }
                .btn-group {
                    margin: 20px 0;
                }
                button {
                    padding: 10px 20px;
                    margin: 0 5px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-weight: bold;
                }
                #audioBtn {
                    background-color: #ff0000;
                    color: white;
                }
                #videoBtn {
                    background-color: #4285f4;
                    color: white;
                }
                button:hover {
                    opacity: 0.9;
                }
                #result {
                    margin-top: 20px;
                    padding: 10px;
                    border-radius: 4px;
                    display: none;
                }
                .success {
                    background-color: #d4edda;
                    color: #155724;
                }
                .error {
                    background-color: #f8d7da;
                    color: #721c24;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>YouTube Downloader</h1>
                <p>Enter YouTube Video ID or URL:</p>
                <input type="text" id="videoId" placeholder="e.g., dQw4w9WgXcQ or https://youtu.be/dQw4w9WgXcQ">
                
                <div class="btn-group">
                    <button id="audioBtn" onclick="download('audio')">Download MP3</button>
                    <button id="videoBtn" onclick="download('video')">Download MP4</button>
                </div>
                
                <div id="result"></div>
            </div>
            
            <script>
                function download(type) {
                    const input = document.getElementById('videoId').value.trim();
                    let videoId = input;
                    
                    // Extract ID from URL if URL was provided
                    if (input.includes('youtube.com') || input.includes('youtu.be')) {
                        try {
                            const url = new URL(input.includes('://') ? input : 'https://' + input);
                            if (url.hostname === 'youtu.be') {
                                videoId = url.pathname.slice(1);
                            } else {
                                videoId = url.searchParams.get('v');
                            }
                        } catch (e) {
                            showResult('Invalid URL format', 'error');
                            return;
                        }
                    }
                    
                    if (!videoId) {
                        showResult('Please enter a valid YouTube video ID or URL', 'error');
                        return;
                    }
                    
                    showResult('Preparing download...', 'success');
                    
                    const endpoint = type === 'audio' ? '/download-audio' : '/download-video';
                    window.location.href = \`\${endpoint}?id=\${videoId}\`;
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

// Download audio (MP3) route
app.get("/download-audio", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOAD_FOLDER, `${videoId}.mp3`);

    const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 -o "${outputPath}" "${videoUrl}"`;

    console.log("Running audio command:", command);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp error:", stderr);
            return res.status(500).json({
                error: "Failed to download audio.",
                details: stderr,
            });
        }

        res.download(outputPath, `${videoId}.mp3`, (err) => {
            if (err) {
                console.error("File send error:", err);
                res.status(500).send("Error sending file.");
            }
            try {
                fs.unlinkSync(outputPath); // Clean up file
            } catch (err) {
                console.warn("Failed to clean up audio file:", err);
            }
        });
    });
});

// Download video (MP4) route
app.get("/download-video", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOAD_FOLDER, `${videoId}.mp4`);

    const command = `${ytDlpPath} --cookies ${cookiePath} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${outputPath}" "${videoUrl}"`;

    console.log("Running video command:", command);

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp error:", stderr);
            return res.status(500).json({
                error: "Failed to download video.",
                details: stderr,
            });
        }

        res.download(outputPath, `${videoId}.mp4`, (err) => {
            if (err) {
                console.error("File send error:", err);
                res.status(500).send("Error sending file.");
            }
            try {
                fs.unlinkSync(outputPath); // Clean up file
            } catch (err) {
                console.warn("Failed to clean up video file:", err);
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
