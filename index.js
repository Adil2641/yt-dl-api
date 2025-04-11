const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// Folder for temporary audio storage
const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");

// Ensure the download folder exists
if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

// API route to download YouTube audio
app.get("/download", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    try {
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
        const outputPath = path.join(DOWNLOAD_FOLDER, `${videoId}.mp3`);

        // Use yt-dlp to download audio
        const command = `yt-dlp -f bestaudio -o "${outputPath}" --extract-audio --audio-format mp3 ${videoUrl}`;
        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("Error:", stderr);
                return res.status(500).json({ error: "Failed to download audio." });
            }

            // Send the downloaded file
            res.download(outputPath, `${videoId}.mp3`, (err) => {
                if (err) {
                    console.error("Error sending file:", err);
                }
                // Delete the file after sending
                fs.unlinkSync(outputPath);
            });
        });
    } catch (error) {
        console.error("Error:", error.message);
        res.status(500).json({ error: "Internal server error." });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
