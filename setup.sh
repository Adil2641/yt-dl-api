#!/bin/bash

# Setup bin folder for yt-dlp
mkdir -p bin

# Install ffmpeg for audio conversion
apt-get update && apt-get install -y ffmpeg

# Download yt-dlp into bin folder
wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O bin/yt-dlp
chmod +x bin/yt-dl
