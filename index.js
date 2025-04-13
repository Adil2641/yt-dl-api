const express = require("express");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const util = require("util");

const app = express();
const PORT = process.env.PORT || 3000;

const DOWNLOAD_FOLDER = path.join(__dirname, "downloads");
const ytDlpPath = path.join(__dirname, "bin", "yt-dlp");
const cookiePath = path.join(__dirname, "cookies.txt");

// Convert exec to promise-based for better async handling
const execPromise = util.promisify(exec);

// Create downloads folder if it doesn't exist
if (!fs.existsSync(DOWNLOAD_FOLDER)) {
    fs.mkdirSync(DOWNLOAD_FOLDER);
}

// Middleware to parse JSON and urlencoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Cache for video titles to reduce API calls
const titleCache = new Map();
const CACHE_TTL = 3600000; // 1 hour cache

// AI-based malicious link detection (optimized version)
async function isMaliciousLink(url) {
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

    return maliciousPatterns.some(pattern => pattern.test(url));
}

// Main page route (unchanged)
app.get("/", (req, res) => {
    res.send(/* same HTML as before */);
});

// Route to get video title from API (optimized)
app.get("/get-title", async (req, res) => {
    const videoId = req.query.id;
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    // Check cache first
    if (titleCache.has(videoId)) {
        const cached = titleCache.get(videoId);
        if (Date.now() - cached.timestamp < CACHE_TTL) {
            return res.json({ title: cached.title });
        }
    }

    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    
    try {
        // Timeout for the API request to prevent hanging
        const source = axios.CancelToken.source();
        const timeout = setTimeout(() => {
            source.cancel('API request timed out');
        }, 5000); // 5 second timeout

        const apiResponse = await axios.get(`https://audio-recon-api.onrender.com/adil?url=${videoUrl}`, {
            cancelToken: source.token
        });
        
        clearTimeout(timeout);

        if (apiResponse.data?.title) {
            // Cache the title
            titleCache.set(videoId, {
                title: apiResponse.data.title,
                timestamp: Date.now()
            });
            return res.json({ title: apiResponse.data.title });
        }
        return res.status(500).json({ error: "Could not retrieve video title" });
    } catch (error) {
        if (axios.isCancel(error)) {
            console.log("API request timed out");
            return res.status(504).json({ error: "API request timed out" });
        }
        console.error("API Error:", error);
        return res.status(500).json({ error: "Failed to get video title from API" });
    }
});

// Download route with optimizations
app.get("/download", async (req, res) => {
    const videoId = req.query.id;
    let title = req.query.title || videoId;
    
    if (!videoId) {
        return res.status(400).json({ error: "Video ID is required." });
    }

    // Validate video ID format first (quick check)
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        return res.status(400).json({ error: "Invalid YouTube video ID format." });
    }

    // Clean the title to make it filesystem-safe
    title = title.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const outputPath = path.join(DOWNLOAD_FOLDER, `${title}.mp3`);
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Check if file already exists (cache)
    if (fs.existsSync(outputPath)) {
        return res.download(outputPath, `${title}.mp3`);
    }

    try {
        // Run malicious check in parallel with other operations
        const [isMalicious] = await Promise.all([
            isMaliciousLink(videoUrl),
            // You could add other parallel operations here
        ]);

        if (isMalicious) {
            console.log(`Blocked potentially malicious download request for ID: ${videoId}`);
            return res.status(403).json({ error: "Download request blocked for security reasons." });
        }

        // Use yt-dlp with optimized parameters for faster downloads
        const command = `${ytDlpPath} --cookies ${cookiePath} -f bestaudio --extract-audio --audio-format mp3 --no-playlist --concurrent-fragments 5 --limit-rate 2M -o "${outputPath}" "${videoUrl}"`;

        console.log("Running optimized download command:", command);
        
        // Set timeout for the download process (10 minutes)
        const { stdout, stderr } = await execPromise(command, { timeout: 600000 });

        // Stream the file as it downloads (alternative approach)
        res.download(outputPath, `${title}.mp3`, (err) => {
            if (err) console.error("File send error:", err);
            // Cleanup after a delay to ensure download completes
            setTimeout(() => {
                try {
                    fs.unlinkSync(outputPath);
                } catch (err) {
                    console.warn("Failed to clean up:", err);
                }
            }, 30000); // 30 seconds delay
        });

    } catch (error) {
        console.error("Download error:", error);
        if (error.killed || error.signal === 'SIGTERM') {
            return res.status(504).json({ error: "Download timed out" });
        }
        return res.status(500).json({
            error: "Failed to download audio.",
            details: error.stderr || error.message,
        });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
