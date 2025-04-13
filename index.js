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

app.use(express.static('public'));

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Adil's Audio Downloader</title>
            <style>
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                    text-align: center;
                    background-color: #f8f9fa;
                }
                .container {
                    background-color: white;
                    border-radius: 10px;
                    padding: 30px;
                    box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                }
                .owner-name {
                    font-family: 'Brush Script MT', cursive;
                    font-size: 3rem;
                    color: #e63946;
                    margin: 10px 0;
                    text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
                    animation: fadeIn 1.5s;
                }
                h1 {
                    color: #333;
                    margin-bottom: 25px;
                    font-weight: 600;
                }
                .description {
                    color: #555;
                    margin-bottom: 30px;
                    font-size: 1.1rem;
                }
                input {
                    padding: 12px 15px;
                    width: 80%;
                    margin: 15px 0;
                    border: 2px solid #ddd;
                    border-radius: 30px;
                    font-size: 16px;
                    transition: all 0.3s;
                }
                input:focus {
                    border-color: #e63946;
                    outline: none;
                    box-shadow: 0 0 0 3px rgba(230, 57, 70, 0.2);
                }
                button {
                    padding: 14px 30px;
                    margin: 10px 0;
                    background-color: #e63946;
                    color: white;
                    border: none;
                    border-radius: 30px;
                    cursor: pointer;
                    font-size: 16px;
                    font-weight: bold;
                    transition: all 0.3s;
                    box-shadow: 0 4px 8px rgba(230, 57, 70, 0.3);
                }
                button:hover {
                    background-color: #d62839;
                    transform: translateY(-2px);
                    box-shadow: 0 6px 12px rgba(230, 57, 70, 0.4);
                }
                #result {
                    margin-top: 20px;
                    padding: 15px;
                    border-radius: 8px;
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
                @keyframes fadeIn {
                    from { opacity: 0; transform: scale(0.9); }
                    to { opacity: 1; transform: scale(1); }
                }
                .music-icon {
                    font-size: 2rem;
                    margin: 10px;
                    color: #e63946;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="owner-name">Adil's</div>
                <h1>YouTube Audio Downloader</h1>
                <div class="music-icon">♫</div>
                <div class="description">
                    Download high quality MP3 audio from YouTube
                </div>
                
                <input type="text" id="videoId" placeholder="Enter YouTube URL or video ID">
                <button onclick="downloadAudio()">Download MP3</button>
                
                <div id="result"></div>
            </div>
            
            <script>
                function downloadAudio() {
                    const input = document.getElementById('videoId').value.trim();
                    let videoId = input;
                    
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
                        showResult('Please enter a valid YouTube URL or video ID', 'error');
                        return;
                    }
                    
                    showResult('Preparing your audio download...', 'success');
                    window.location.href = `/download-audio?id=${videoId}`;
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
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOAD_FOLDER, `${videoId}.mp3`);

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

        res.download(outputPath, `${videoId}.mp3`, (err) => {
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
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
