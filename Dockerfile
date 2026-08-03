FROM node:20-slim

# yt-dlp needs python; ffmpeg is needed for 1080p merging and MP3 extraction
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates \
 && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
 && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server.js index.html ./

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
