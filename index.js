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

app.get("/download", async (req, res) => {
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
                fs.unlinkSync(outputPath); // Clean up file
            } catch (err) {
                console.warn("Failed to clean up:", err);
            }
        });
    });
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
