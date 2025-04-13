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
                /* ... (keep all your existing styles) ... */
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
                    window.location.href = '/download-audio?id=' + encodeURIComponent(videoId);
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
    
    // Use %(title)s placeholder for the original video title
    const outputTemplate = path.join(DOWNLOAD_FOLDER, "%(title)s.%(ext)s");

    const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 -o "${outputTemplate}" --get-filename --no-simulate "${videoUrl}"`;

    console.log("Running command:", command);

    // First get the actual filename that will be used
    exec(`${ytDlpPath} --get-filename -o "${outputTemplate}" "${videoUrl}"`, (error, stdout, stderr) => {
        if (error) {
            console.error("Error getting filename:", stderr);
            return res.status(500).json({
                error: "Failed to get video information.",
                details: stderr,
            });
        }

        const outputFilename = stdout.trim();
        const outputPath = path.join(DOWNLOAD_FOLDER, outputFilename);

        // Now perform the actual download
        exec(`${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 -o "${outputTemplate}" "${videoUrl}"`, (error, stdout, stderr) => {
            if (error) {
                console.error("yt-dlp error:", stderr);
                return res.status(500).json({
                    error: "Failed to download audio.",
                    details: stderr,
                });
            }

            res.download(outputPath, (err) => {
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
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
