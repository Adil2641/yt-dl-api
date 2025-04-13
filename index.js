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
const TITLE_API = "https://audio-recon-api.onrender.com/adil?url=";

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

app.use(express.static('public'));

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>ADIL'S PREMIUM AUDIO</title>
            <link href="https://fonts.googleapis.com/css2?family=Pacifico&family=Poppins:wght@400;600&display=swap" rel="stylesheet">
            <style>
                :root {
                    --primary: #FF3E6C;
                    --secondary: #343a40;
                    --light: #f8f9fa;
                }
                body {
                    font-family: 'Poppins', sans-serif;
                    background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
                    min-height: 100vh;
                    margin: 0;
                    padding: 20px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    border-radius: 20px;
                    box-shadow: 0 15px 30px rgba(0,0,0,0.1);
                    width: 100%;
                    max-width: 600px;
                    padding: 40px;
                    text-align: center;
                    position: relative;
                    overflow: hidden;
                }
                .container::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    height: 10px;
                    background: linear-gradient(90deg, var(--primary), #FF8E53);
                }
                .owner-name {
                    font-family: 'Pacifico', cursive;
                    font-size: 3.5rem;
                    color: var(--primary);
                    margin: 10px 0 5px;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
                    line-height: 1;
                }
                .tagline {
                    color: var(--secondary);
                    font-size: 1rem;
                    margin-bottom: 30px;
                    font-weight: 400;
                    letter-spacing: 1px;
                }
                .input-group {
                    margin: 25px 0;
                }
                input {
                    width: 100%;
                    padding: 15px 20px;
                    border: 2px solid #e9ecef;
                    border-radius: 50px;
                    font-size: 1rem;
                    transition: all 0.3s;
                    box-sizing: border-box;
                }
                input:focus {
                    border-color: var(--primary);
                    outline: none;
                    box-shadow: 0 0 0 3px rgba(255, 62, 108, 0.2);
                }
                button {
                    background: linear-gradient(45deg, var(--primary), #FF8E53);
                    color: white;
                    border: none;
                    padding: 15px 40px;
                    font-size: 1.1rem;
                    border-radius: 50px;
                    cursor: pointer;
                    margin-top: 15px;
                    font-weight: 600;
                    transition: all 0.3s;
                    box-shadow: 0 4px 15px rgba(255, 62, 108, 0.3);
                    text-transform: uppercase;
                    letter-spacing: 1px;
                }
                button:hover {
                    transform: translateY(-3px);
                    box-shadow: 0 6px 20px rgba(255, 62, 108, 0.4);
                }
                #result {
                    margin: 25px 0;
                    padding: 15px;
                    border-radius: 10px;
                    display: none;
                    animation: fadeIn 0.5s;
                }
                .success {
                    background-color: #e6f7ee;
                    color: #28a745;
                    border: 1px solid #c3e6cb;
                }
                .error {
                    background-color: #fce8e6;
                    color: #dc3545;
                    border: 1px solid #f5c6cb;
                }
                .loader {
                    display: none;
                    margin: 20px auto;
                    border: 5px solid #f3f3f3;
                    border-top: 5px solid var(--primary);
                    border-radius: 50%;
                    width: 40px;
                    height: 40px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                .features {
                    display: flex;
                    justify-content: space-around;
                    margin: 30px 0;
                    flex-wrap: wrap;
                }
                .feature {
                    margin: 10px;
                    padding: 15px;
                    background: var(--light);
                    border-radius: 10px;
                    flex: 1;
                    min-width: 120px;
                }
                .feature i {
                    font-size: 1.5rem;
                    color: var(--primary);
                    margin-bottom: 10px;
                    display: block;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="owner-name">ADIL</div>
                <div class="tagline">PREMIUM YOUTUBE AUDIO DOWNLOADER</div>
                
                <div class="input-group">
                    <input type="text" id="videoId" placeholder="Paste YouTube link here...">
                    <button onclick="downloadAudio()">DOWNLOAD MP3</button>
                    <div class="loader" id="loader"></div>
                </div>
                
                <div id="result"></div>
                
                <div class="features">
                    <div class="feature">
                        <i>🎵</i>
                        High Quality
                    </div>
                    <div class="feature">
                        <i>⚡</i>
                        Fast Download
                    </div>
                    <div class="feature">
                        <i>🔒</i>
                        Secure
                    </div>
                </div>
            </div>
            
            <script>
                async function downloadAudio() {
                    const input = document.getElementById('videoId').value.trim();
                    const resultDiv = document.getElementById('result');
                    const loader = document.getElementById('loader');
                    
                    if (!input) {
                        showResult('Please enter a YouTube URL', 'error');
                        return;
                    }
                    
                    // Show loading indicator
                    loader.style.display = 'block';
                    resultDiv.style.display = 'none';
                    
                    try {
                        let videoId = extractVideoId(input);
                        if (!videoId) {
                            showResult('Invalid YouTube URL', 'error');
                            return;
                        }
                        
                        showResult('Fetching video info...', 'success');
                        
                        // Fetch video title from API
                        const response = await fetch('${TITLE_API}' + encodeURIComponent(input));
                        if (!response.ok) throw new Error('Failed to get video title');
                        
                        const data = await response.json();
                        if (!data.title) throw new Error('Title not found');
                        
                        // Start download
                        window.location.href = '/download-audio?url=' + encodeURIComponent(input) + '&title=' + encodeURIComponent(data.title);
                        
                    } catch (error) {
                        showResult('Error: ' + error.message, 'error');
                    } finally {
                        loader.style.display = 'none';
                    }
                }
                
                function extractVideoId(url) {
                    try {
                        if (url.includes('youtu.be/')) {
                            return url.split('youtu.be/')[1].split(/[?&#]/)[0];
                        }
                        const match = url.match(/[?&]v=([^&]+)/);
                        return match ? match[1] : null;
                    } catch {
                        return null;
                    }
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

// Audio download endpoint
app.get("/download-audio", async (req, res) => {
    try {
        const videoUrl = req.query.url;
        const title = req.query.title || 'audio';
        
        if (!videoUrl) {
            return res.status(400).json({ error: "YouTube URL is required." });
        }

        // Sanitize title for filename
        const cleanTitle = title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
        const outputPath = path.join(DOWNLOAD_FOLDER, `${cleanTitle}.mp3`);

        const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 -o "${outputPath}" "${videoUrl}"`;

        console.log("Running command:", command);

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error("yt-dlp error:", stderr);
                return res.status(500).json({
                    error: "Failed to download audio.",
                    details: stderr,
                });
            }

            res.download(outputPath, `${cleanTitle}.mp3`, (err) => {
                if (err) {
                    console.error("File send error:", err);
                    res.status(500).send("Error sending file.");
                }
                try {
                    fs.unlinkSync(outputPath);
                } catch (err) {
                    console.warn("Failed to clean up:", err);
                }
            });
        });
    } catch (error) {
        console.error("Download error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
