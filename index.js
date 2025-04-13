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

app.use(express.json());
app.use(express.static('public'));

// API endpoint to get video title
app.get("/adil", async (req, res) => {
    const youtubeUrl = req.query.url;
    if (!youtubeUrl) {
        return res.status(400).json({ error: "YouTube URL is required." });
    }

    // Command to get video title in JSON format
    const command = `${ytDlpPath} --cookies ${cookiePath} --dump-json --no-warnings "${youtubeUrl}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error("Error getting video info:", stderr);
            return res.status(500).json({
                error: "Failed to fetch video information",
                details: stderr
            });
        }

        try {
            const videoInfo = JSON.parse(stdout);
            res.json({
                title: videoInfo.title,
                thumbnail: videoInfo.thumbnail,
                duration: videoInfo.duration,
                uploader: videoInfo.uploader
            });
        } catch (parseError) {
            console.error("Error parsing video info:", parseError);
            res.status(500).json({ error: "Failed to parse video information" });
        }
    });
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
    console.log(`API endpoint: http://localhost:${PORT}/adil?url=YOUTUBE_URL`);
});
