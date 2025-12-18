# Deployment Guide

This guide helps you deploy the Video Scraper application to various cloud platforms.

## Environment Variables

The application uses a `.env` file for configuration. Copy `.env.example` to `.env` and adjust the values:

```bash
cp .env.example .env
```

### Required Environment Variables for Production:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production

# Puppeteer Configuration for Production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
CHROME_BIN=/usr/bin/google-chrome-stable

# Chrome Launch Arguments (comma-separated)
CHROME_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-accelerated-2d-canvas,--no-first-run,--no-zygote,--single-process,--disable-gpu,--disable-web-security,--disable-features=VizDisplayCompositor

# Application Settings
MAX_VIDEO_SIZE_MB=500
DOWNLOAD_TIMEOUT_MS=300000
PUPPETEER_TIMEOUT_MS=30000

# Debug Settings (set to false in production)
DEBUG_PUPPETEER=false
DEBUG_FFMPEG=false
VERBOSE_LOGGING=false
```

### Optional Environment Variables:

```bash
# Custom FFmpeg path (uses ffmpeg-static by default)
FFMPEG_PATH=/usr/bin/ffmpeg

# Puppeteer cache directory
PUPPETEER_CACHE_DIR=./.cache/puppeteer

# Security settings
CORS_ORIGIN=https://yourdomain.com
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW_MS=900000
```

## Platform-Specific Instructions

### Render.com

1. **Build Command:**
   ```bash
   npm install && npx puppeteer browsers install chrome
   ```

2. **Start Command:**
   ```bash
   npm start
   ```

3. **Environment Variables:**
   ```
   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
   ```

### Heroku

1. **Add Buildpacks:**
   ```bash
   heroku buildpacks:add jontewks/puppeteer
   heroku buildpacks:add heroku/nodejs
   ```

2. **Environment Variables:**
   ```bash
   heroku config:set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
   heroku config:set PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
   ```

### Railway

1. **Environment Variables:**
   ```
   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
   NIXPACKS_INSTALL_CMD=npm ci && npx puppeteer browsers install chrome
   ```

### Vercel (Serverless)

Note: This app requires long-running processes and may not work well on Vercel's serverless platform. Consider using Render or Railway instead.

### Docker Deployment

1. **Build the image:**
   ```bash
   docker build -t video-scraper .
   ```

2. **Run the container:**
   ```bash
   docker run -p 3000:3000 video-scraper
   ```

## Troubleshooting

### Chrome Not Found Error

If you get "Could not find Chrome" error:

1. **Check if Chrome is installed:**
   ```bash
   which google-chrome-stable
   ```

2. **Install Chrome manually (Ubuntu/Debian):**
   ```bash
   wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -
   echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list
   apt-get update
   apt-get install -y google-chrome-stable
   ```

3. **Set the executable path:**
   ```bash
   export PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
   ```

### Memory Issues

If you encounter memory issues:

1. **Add these Chrome flags in server.js:**
   ```javascript
   '--memory-pressure-off',
   '--max_old_space_size=4096'
   ```

2. **Increase platform memory limits** (if available)

### FFmpeg Issues

If FFmpeg fails:

1. **Check if FFmpeg is available:**
   ```bash
   which ffmpeg
   ```

2. **The app uses ffmpeg-static** which should work on most platforms

## Testing Deployment

1. **Health Check Endpoint:**
   ```
   GET /
   ```

2. **Test Video Resolution:**
   ```
   GET /api/resolve?url=https://example.com/video-page
   ```

## Performance Optimization

1. **Enable compression** (already included)
2. **Set appropriate timeouts** for your platform
3. **Monitor memory usage** during video processing
4. **Consider adding rate limiting** for production use