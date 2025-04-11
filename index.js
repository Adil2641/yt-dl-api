const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

app.get("/download", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const outputPath = path.join(DOWNLOAD_FOLDER, `${videoId}.mp3`);

    const command = `${ytDlpPath} -f bestaudio -o "${outputPath}" --extract-audio --audio-format mp3 ${videoUrl}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error("yt-dlp error:", stderr);
            return res.status(500).json({ error: "Failed to download audio." });
        }

        res.download(outputPath, `${videoId}.mp3`, (err) => {
            if (err) {
                console.error("Error sending file:", err);
            }
            fs.unlinkSync(outputPath); // Clean up
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
