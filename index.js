const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios"); // Add axios for API requests

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");
const cookiePath = path.join(__dirname, "cookies.txt");
const TITLE_API_URL = "https://audio-recon-api.onrender.com/adil?url=";

if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

app.use(express.static('public'));

app.get("/", (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <!-- [Previous HTML content remains exactly the same] -->
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
    
    try {
        // Get the real video title from the API
        const apiResponse = await axios.get(`${TITLE_API_URL}${encodeURIComponent(videoUrl)}`);
        const videoTitle = apiResponse.data.title || videoId;
        
        // Sanitize the title for filename use
        const sanitizedTitle = videoTitle.replace(/[^\w\s]/gi, '').trim().replace(/\s+/g, ' ');
        const outputFilename = `${sanitizedTitle}.mp3`;
        const outputPath = path.join(DOWNLOAD_FOLDER, outputFilename);

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

            res.download(outputPath, outputFilename, (err) => {
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
    } catch (apiError) {
        console.error("Title API error:", apiError);
        // Fallback to using video ID if API fails
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
    }
});

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
});
