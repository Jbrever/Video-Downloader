// Load environment variables
require('dotenv').config();

const express = require('express');
const puppeteer = require('puppeteer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const axios = require('axios');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;
// console.log('-__>',process.env.PUPPETEER_EXECUTABLE_PATH);

// Configuration from environment variables
const config = {
    port: PORT,
    nodeEnv: process.env.NODE_ENV || 'development',
    puppeteer: {
        skipDownload: process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true',
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_BIN,
        cacheDir: process.env.PUPPETEER_CACHE_DIR,
        timeout: parseInt(process.env.PUPPETEER_TIMEOUT_MS) || 30000,
        args: process.env.CHROME_ARGS ? process.env.CHROME_ARGS.split(',') : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor'
        ]
    },
    debug: {
        puppeteer: process.env.DEBUG_PUPPETEER === 'true',
        ffmpeg: process.env.DEBUG_FFMPEG === 'true',
        verbose: process.env.VERBOSE_LOGGING === 'true'
    },
    limits: {
        maxVideoSizeMB: parseInt(process.env.MAX_VIDEO_SIZE_MB) || 500,
        downloadTimeoutMs: parseInt(process.env.DOWNLOAD_TIMEOUT_MS) || 300000
    }
};

// Log configuration in development
if (config.nodeEnv === 'development' && config.debug.verbose) {
    console.log('Configuration:', JSON.stringify(config, null, 2));
}

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Helper to delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to identify video resources
const isVideoResource = (url, contentType) => {
    const cleanUrl = url.split('?')[0].toLowerCase();
    const ext = path.extname(cleanUrl);

    // Skip font files and other non-video files
    if (['.woff', '.woff2', '.ttf', '.eot', '.css', '.js', '.json', '.xml', '.txt'].includes(ext)) {
        return null;
    }

    // Check extensions
    if (['.mp4', '.webm', '.mkv', '.mov', '.avi'].includes(ext)) return 'direct';
    
    // Only consider .m3u8 files as M3U8, not .ts segments or .txt files
    if (ext === '.m3u8') return 'm3u8';
    
    // Skip individual .ts segments - we want the main playlist
    if (ext === '.ts') return null;

    // Check for HLS patterns in URL even without .m3u8 extension
    if (cleanUrl.includes('m3u8') || cleanUrl.includes('playlist') || cleanUrl.includes('master')) {
        // But make sure it's not a .txt file pretending to be HLS
        if (ext === '.txt') return null;
        return 'm3u8';
    }

    // Check Content-Type if extension is ambiguous or missing
    if (contentType) {
        contentType = contentType.toLowerCase();
        if (contentType.includes('video/mp4') || contentType.includes('video/webm') || contentType.includes('video/ogg')) return 'direct';
        if (contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl')) return 'm3u8';
        // Skip font content types and text files
        if (contentType.includes('font') || contentType.includes('woff') || contentType.includes('text/plain')) return null;
        // Fallback: If content-type starts with video/ but isn't an image/font
        if (contentType.startsWith('video/') && !contentType.includes('html')) return 'direct';
    }

    return null;
};

const ytdl = require('@distube/ytdl-core');

// Helper: Get YTDL Agent with cookies from Puppeteer
const getYtdlAgent = async (url) => {
    let browser;
    try {
        if (config.debug.puppeteer) {
            console.log('Launching Puppeteer to fetch YouTube cookies...');
        }
        
        // Enhanced launch options from config
        const launchOptions = {
            headless: 'new',
            args: config.puppeteer.args
        };

        // Use custom executable path if provided
        if (config.puppeteer.executablePath) {
            launchOptions.executablePath = config.puppeteer.executablePath;
            if (config.debug.puppeteer) {
                console.log('Using Chrome at:', config.puppeteer.executablePath);
            }
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Go to the video page to get fresher cookies specific to the video context
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Try to handle consent popup if it exists (basic check)
        try {
            const consentSelectors = ['button[aria-label="Accept all"]', 'button[aria-label="Agree to the use of cookies and other data for the purposes described"]'];
            for (const selector of consentSelectors) {
                if (await page.$(selector)) {
                    await page.click(selector);
                    await new Promise(r => setTimeout(r, 1000));
                    break;
                }
            }
        } catch (e) { }

        const cookies = await page.cookies();
        console.log(`Extracted ${cookies.length} cookies`);

        return ytdl.createAgent(cookies);
    } catch (error) {
        console.error('Failed to get cookies:', error);
        return undefined;
    } finally {
        if (browser) await browser.close();
    }
};

// API: Resolve video URL from page
app.get('/api/resolve', async (req, res) => {
    const targetUrl = req.query.url;

    if (!targetUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    // YOUTUBE HANDLER
    if (ytdl.validateURL(targetUrl)) {
        try {
            console.log('Detected YouTube URL, fetching info with cookies...');

            // Get fresh agent with cookies for every request to ensure reliability
            // Optimization: In prod, you'd cache this agent, but for a scraper, freshness is key.
            const agent = await getYtdlAgent(targetUrl);
            const info = await ytdl.getInfo(targetUrl, { agent });

            // Filter: MP4 container, has audio and video
            let formats = ytdl.filterFormats(info.formats, 'audioandvideo');

            // If strict MP4 filter returns nothing, try allowing others but prefer proper containers
            if (formats.length === 0) {
                formats = info.formats.filter(f => f.hasVideo && f.hasAudio);
            }

            // Map to our structure
            const videos = formats.map(f => ({
                videoUrl: `${targetUrl}&itag=${f.itag}`,
                type: 'youtube',
                quality: f.qualityLabel || 'Unknown',
                size: f.contentLength ? (parseInt(f.contentLength) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown',
                thumbnail: info.videoDetails.thumbnails.length ? info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url : ''
            }));

            console.log(`Found ${videos.length} YouTube formats`);
            return res.json({ videos });

        } catch (error) {
            console.error('YouTube error:', error);
            let msg = 'Failed to process YouTube video.';
            if (error.message.includes('410')) msg = 'Video is age-restricted or private/deleted.';
            if (error.message.includes('429')) msg = 'Too many requests. Please try again later.';
            return res.status(500).json({ error: msg });
        }
    }

    // PUPPETEER HANDLER (Existing generic logic)
    let browser;
    try {
        if (config.debug.puppeteer) {
            console.log('Launching Puppeteer for page scraping...');
        }
        
        // Enhanced launch options from config
        const launchOptions = {
            headless: 'new', // Use new headless mode
            args: config.puppeteer.args
        };

        // Use custom executable path if provided
        if (config.puppeteer.executablePath) {
            launchOptions.executablePath = config.puppeteer.executablePath;
            if (config.debug.puppeteer) {
                console.log('Using Chrome at:', config.puppeteer.executablePath);
            }
        }

        browser = await puppeteer.launch(launchOptions);
        const page = await browser.newPage();

        // Set User Agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        const foundVideos = new Map(); // Use Map to deduplicate by URL

        // Enable Request Interception
        await page.setRequestInterception(true);

        page.on('request', (request) => {
            const resourceType = request.resourceType();
            // Abort images, fonts, styles to speed up load
            if (['image', 'font', 'stylesheet'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });

        // Listen to responses
        page.on('response', async (response) => {
            const url = response.url();
            const status = response.status();

            // Filter valid responses
            if (status >= 300 && status < 400) return;
            if (status !== 200 && status !== 206) return;

            // Simple dedupe check before heavy parsing
            if (foundVideos.has(url)) return;

            const headers = response.headers();
            const contentType = headers['content-type'];
            const contentLength = headers['content-length'];

            const type = isVideoResource(url, contentType);
            if (type) {
                // Filter by size if it's a direct file (ignore for m3u8 as playlists are small)
                if (type === 'direct' && contentLength) {
                    const sizeInBytes = parseInt(contentLength, 10);
                    // 2 MB = 2 * 1024 * 1024 bytes
                    if (!isNaN(sizeInBytes) && sizeInBytes < 2 * 1024 * 1024) {
                        return; // Skip small files
                    }
                }

                // For M3U8, try to find the master playlist by looking for common patterns
                if (type === 'm3u8') {
                    // Look for master playlist indicators
                    const urlLower = url.toLowerCase();
                    if (urlLower.includes('master') || urlLower.includes('playlist') || urlLower.includes('index')) {
                        // This is likely a master playlist
                        foundVideos.set(url, {
                            videoUrl: url,
                            type: type,
                            contentType: contentType,
                            size: 'HLS Stream',
                            quality: 'Adaptive'
                        });
                    } else {
                        // Regular M3U8 file
                        foundVideos.set(url, {
                            videoUrl: url,
                            type: type,
                            contentType: contentType,
                            size: 'HLS Stream'
                        });
                    }
                } else {
                    foundVideos.set(url, {
                        videoUrl: url,
                        type: type,
                        contentType: contentType,
                        size: contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'
                    });
                }
            }
        });

        // console.log(`Navigating to ${targetUrl}...`);
        try {
            await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        } catch (e) {
            console.log('Navigation timeout or error, continuing to capture requests...', e.message);
        }

        // Wait a bit more for dynamic content/players to load requests
        console.log('Waiting for video requests...');
        // Try to find video element and scroll to it to trigger loading
        let pageThumbnail = null;
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

            // Extract thumbnail
            pageThumbnail = await page.evaluate(() => {
                // Try og:image
                const ogImage = document.querySelector('meta[property="og:image"]');
                if (ogImage && ogImage.content) return ogImage.content;

                // Try video poster
                const video = document.querySelector('video');
                if (video && video.poster) return video.poster;

                return null;
            });
        } catch (e) { }

        // Wait for 5 seconds to collect streams
        await delay(5000);

        if (foundVideos.size > 0) {
            const videos = Array.from(foundVideos.values()).map(v => ({
                ...v,
                thumbnail: pageThumbnail || 'https://via.placeholder.com/150?text=No+Preview'
            }));
            console.log(`Found ${videos.length} videos`);
            res.json({ videos });
        } else {
            // Try to find HLS streams by looking for common video player patterns
            try {
                const hlsUrls = await page.evaluate(() => {
                    const urls = [];
                    
                    // Look for video elements with src
                    const videos = document.querySelectorAll('video');
                    videos.forEach(video => {
                        if (video.src && (video.src.includes('.m3u8') || video.src.includes('hls'))) {
                            urls.push(video.src);
                        }
                    });
                    
                    // Look for source elements
                    const sources = document.querySelectorAll('source');
                    sources.forEach(source => {
                        if (source.src && (source.src.includes('.m3u8') || source.src.includes('hls'))) {
                            urls.push(source.src);
                        }
                    });
                    
                    // Look in script tags for HLS URLs
                    const scripts = document.querySelectorAll('script');
                    scripts.forEach(script => {
                        if (script.textContent) {
                            const m3u8Matches = script.textContent.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/g);
                            if (m3u8Matches) {
                                urls.push(...m3u8Matches);
                            }
                        }
                    });
                    
                    return [...new Set(urls)]; // Remove duplicates
                });
                
                if (hlsUrls.length > 0) {
                    const videos = hlsUrls.map((url, index) => ({
                        videoUrl: url,
                        type: 'm3u8',
                        contentType: 'application/x-mpegurl',
                        size: 'HLS Stream',
                        thumbnail: pageThumbnail || 'https://via.placeholder.com/150?text=No+Preview'
                    }));
                    console.log(`Found ${videos.length} HLS streams in page content`);
                    res.json({ videos });
                } else {
                    res.status(404).json({ error: 'No downloadable video found on this page. It might be encrypted (DRM) or unsupported.' });
                }
            } catch (e) {
                console.error('Error searching for HLS URLs:', e);
                res.status(404).json({ error: 'No downloadable video found on this page. It might be encrypted (DRM) or unsupported.' });
            }
        }

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: 'Failed to analyze page: ' + (error.message || 'Unknown error') });
    } finally {
        if (browser) await browser.close();
    }
});

// API: Download video
app.get('/api/download', async (req, res) => {
    const { videoUrl, type } = req.query;

    if (!videoUrl || !type) {
        return res.status(400).send('Missing videoUrl or type');
    }

    try {
        if (type === 'youtube') {
            // Parse actual URL and itag
            const realUrl = videoUrl.split('&itag=')[0];
            const urlObj = new URL(videoUrl);
            const itag = urlObj.searchParams.get('itag') || videoUrl.split('&itag=')[1];

            console.log(`Downloading YouTube video: ${realUrl} (itag: ${itag})`);

            res.setHeader('Content-Disposition', 'attachment; filename="youtube_video.mp4"');
            res.setHeader('Content-Type', 'video/mp4');

            // Get agent (will use cache if recent)
            const agent = await getYtdlAgent(realUrl);

            ytdl(realUrl, { quality: itag, agent })
                .on('error', (err) => {
                    console.error('YTDL error:', err);
                    if (!res.headersSent) res.status(500).send('Download failed. The video might be restricted.');
                })
                .pipe(res);

        } else if (type === 'direct') {
            // Direct stream pipe
            const response = await axios({
                method: 'GET',
                url: videoUrl,
                responseType: 'stream'
            });

            res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');

            response.data.pipe(res);

        } else if (type === 'm3u8') {
            // Ensure temp directory exists
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            // Download to temp file using spawn directly
            const tempFileName = `video-${Date.now()}.mp4`;
            const tempFilePath = path.join(tempDir, tempFileName);
            const { spawn } = require('child_process');

            console.log(`Starting M3U8 transcoding from: ${videoUrl}`);
            console.log(`Output file: ${tempFilePath}`);

            // Validate the M3U8 URL and check if it's actually a valid playlist
            try {
                console.log('Validating M3U8 URL:', videoUrl);
                
                // Get the first part of the file to check if it's actually M3U8 content
                const testResponse = await axios.get(videoUrl, { 
                    timeout: 10000,
                    headers: { 'Range': 'bytes=0-1023' }, // Just get first 1KB
                    validateStatus: (status) => status < 500
                });
                
                const content = testResponse.data;
                console.log('M3U8 content preview:', content.substring(0, 200));
                
                // Check if it's actually M3U8 content
                if (typeof content === 'string' && content.includes('#EXTM3U')) {
                    console.log('Valid M3U8 content detected');
                } else {
                    console.error('Invalid M3U8 content - does not contain #EXTM3U header');
                    return res.status(400).send('Invalid M3U8 stream - the file does not contain valid HLS playlist data.');
                }
                
            } catch (error) {
                console.error('M3U8 URL validation failed:', error.message);
                return res.status(400).send('Invalid M3U8 stream URL. The stream may be expired, inaccessible, or not a valid HLS stream.');
            }

            // Enhanced FFmpeg arguments with better error handling
            const args = [
                '-y', // Overwrite output file
                '-i', videoUrl, // Input M3U8 URL
                '-c', 'copy', // Stream copy (no re-encoding)
                '-bsf:a', 'aac_adtstoasc', // Audio bitstream filter for AAC
                '-f', 'mp4', // Force MP4 format
                '-movflags', 'faststart', // Optimize for web playback
                '-timeout', '60000000', // 1 mint timeout (in microseconds)
                '-reconnect', '1', // Enable reconnection
                '-reconnect_streamed', '1', // Reconnect for streamed content
                '-reconnect_delay_max', '5', // Max reconnect delay
                tempFilePath
            ];

            console.log('FFmpeg command:', ffmpegPath, args.join(' '));

            const ffmpegProcess = spawn(ffmpegPath, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            let stderr = '';
            let stdout = '';

            ffmpegProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            ffmpegProcess.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                // Log progress for debugging
                if (chunk.includes('time=') || chunk.includes('frame=')) {
                    console.log('FFmpeg progress:', chunk.trim());
                }
            });

            // Set a timeout for the entire process
            const processTimeout = setTimeout(() => {
                console.log('FFmpeg process timeout - killing process');
                ffmpegProcess.kill('SIGKILL');
            }, 300000); // 5 minutes timeout

            ffmpegProcess.on('close', (code, signal) => {
                clearTimeout(processTimeout);
                
                console.log(`FFmpeg process closed with code: ${code}, signal: ${signal}`);
                
                if (code === 0) {
                    console.log('FFmpeg transcoding finished successfully');
                    
                    // Check if file exists and has content
                    if (fs.existsSync(tempFilePath)) {
                        const stats = fs.statSync(tempFilePath);
                        if (stats.size > 1024) { // At least 1KB
                            console.log(`Output file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
                            
                            // Set proper headers for download
                            res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
                            res.setHeader('Content-Type', 'video/mp4');
                            res.setHeader('Content-Length', stats.size);
                            
                            // Stream the file to the client
                            const fileStream = fs.createReadStream(tempFilePath);
                            fileStream.pipe(res);
                            
                            // Clean up after streaming is complete
                            fileStream.on('end', () => {
                                console.log('File streaming completed');
                                setTimeout(() => {
                                    fs.unlink(tempFilePath, (unlinkErr) => {
                                        if (unlinkErr) console.error('Cleanup error:', unlinkErr);
                                        else console.log('Temp file cleaned up');
                                    });
                                }, 2000);
                            });
                            
                            fileStream.on('error', (streamErr) => {
                                console.error('File streaming error:', streamErr);
                                if (!res.headersSent) {
                                    res.status(500).send('Error streaming video file.');
                                }
                            });
                            
                        } else {
                            console.error('Output file is too small:', stats.size, 'bytes');
                            fs.unlinkSync(tempFilePath);
                            if (!res.headersSent) {
                                res.status(500).send('Video conversion produced invalid file. The stream may be corrupted or empty.');
                            }
                        }
                    } else {
                        console.error('Output file does not exist');
                        if (!res.headersSent) {
                            res.status(500).send('Video conversion failed to create output file.');
                        }
                    }
                } else {
                    console.error(`FFmpeg process failed with code: ${code}, signal: ${signal}`);
                    console.error('FFmpeg stderr:', stderr);
                    
                    // Clean up temp file if exists
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                    
                    if (!res.headersSent) {
                        let errorMessage = 'Video conversion failed.';
                        
                        if (stderr.includes('Connection refused') || stderr.includes('Network is unreachable')) {
                            errorMessage = 'Cannot connect to video stream. The stream may be offline or blocked.';
                        } else if (stderr.includes('403') || stderr.includes('Forbidden')) {
                            errorMessage = 'Access denied to video stream. The stream may require authentication.';
                        } else if (stderr.includes('404') || stderr.includes('Not Found')) {
                            errorMessage = 'Video stream not found. The stream may have expired.';
                        } else if (stderr.includes('timeout') || stderr.includes('timed out')) {
                            errorMessage = 'Video stream timeout. The stream may be too slow or unstable.';
                        } else if (code === null || signal === 'SIGKILL') {
                            errorMessage = 'Video conversion was interrupted. The stream may be too large or corrupted.';
                        }
                        
                        res.status(500).send(errorMessage);
                    }
                }
            });

            // Handle error on spawn itself
            ffmpegProcess.on('error', (err) => {
                clearTimeout(processTimeout);
                console.error('Failed to start FFmpeg process:', err);
                if (!res.headersSent) {
                    res.status(500).send('Failed to start video conversion process.');
                }
            });

        } else {
            res.status(400).send('Unsupported video type');
        }

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) res.status(500).send('Download failed');
    }
});

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
    console.log('Created temp directory');
}

app.listen(config.port, () => {
    console.log(`🚀 Server running on http://localhost:${config.port}`);
    console.log(`📁 Temp directory: ${tempDir}`);
    console.log(`🎬 FFmpeg path: ${ffmpegPath}`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);
    
    if (config.debug.verbose) {
        console.log(`🔧 Puppeteer executable: ${config.puppeteer.executablePath || 'default'}`);
        console.log(`⚙️  Chrome args: ${config.puppeteer.args.join(' ')}`);
    }
});
