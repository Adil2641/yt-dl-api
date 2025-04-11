#!/bin/bash

# Setup bin folder for yt-dlp
mkdir -p bin

# Install ffmpeg for audio conversion
apt-get update && apt-get install -y ffmpeg

# Download yt-dlp into bin folder
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
chmod a+rx bin/yt-dlp
