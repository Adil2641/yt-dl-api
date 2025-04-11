#!/bin/bash

# Make local bin folder
mkdir -p bin

# Install ffmpeg (Render allows this)
apt-get update && apt-get install -y ffmpeg

# Download yt-dlp into local bin directory
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod a+rx bin/yt-dlp
