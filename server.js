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

app.use(cors());
app.use(express.static('public'));
app.use(express.json());

// Helper to delay
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to identify video resources
const isVideoResource = (url, contentType) => {
    const cleanUrl = url.split('?')[0].toLowerCase();
    const ext = path.extname(cleanUrl);

    // Check extensions
    if (['.mp4', '.webm', '.mkv', '.mov', '.avi'].includes(ext)) return 'direct';
    if (['.m3u8', '.ts'].includes(ext)) return 'm3u8';

    // Check Content-Type if extension is ambiguous or missing
    if (contentType) {
        contentType = contentType.toLowerCase();
        if (contentType.includes('video/mp4') || contentType.includes('video/webm') || contentType.includes('video/ogg')) return 'direct';
        if (contentType.includes('application/x-mpegurl') || contentType.includes('application/vnd.apple.mpegurl') || contentType.includes('video/mp2t')) return 'm3u8';
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
        console.log('Launching Puppeteer to fetch YouTube cookies...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
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
            return res.status(500).json({ error: 'Failed to process YouTube video: ' + error.message });
        }
    }

    // PUPPETEER HANDLER (Existing generic logic)
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new', // Use new headless mode
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
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

                foundVideos.set(url, {
                    videoUrl: url,
                    type: type,
                    contentType: contentType,
                    size: contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'
                });
            }
        });

        console.log(`Navigating to ${targetUrl}...`);
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
            res.status(404).json({ error: 'No video found on this page' });
        }

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ error: error.message || 'Failed to resolve video' });
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
                    if (!res.headersSent) res.status(500).send('Download failed: ' + err.message);
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
            // Download to temp file using spawn directly
            const tempFileName = `video-${Date.now()}.mp4`;
            const tempFilePath = path.join(__dirname, 'temp', tempFileName);
            const { spawn } = require('child_process');

            console.log(`Starting transcoding to ${tempFilePath}...`);

            // Arguments for ffmpeg-static
            // -y: overwrite
            // -i: input
            // -c: copy (stream copy)
            // -bsf:a: audio bitstream filter
            const args = [
                '-y',
                '-i', videoUrl,
                '-c', 'copy',
                '-bsf:a', 'aac_adtstoasc',
                tempFilePath
            ];

            const ffmpegProcess = spawn(ffmpegPath, args);

            let stderr = '';
            ffmpegProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('FFmpeg transcoding finished successfully');
                    // Allow browser to download
                    res.download(tempFilePath, 'video.mp4', (err) => {
                        if (err) {
                            console.error('Download sending error:', err);
                        }
                        // Clean up
                        fs.unlink(tempFilePath, () => { });
                    });
                } else {
                    console.error('FFmpeg process exited with code:', code);
                    console.error('FFmpeg stderr:', stderr);
                    // Clean up temp file if exists
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                    if (!res.headersSent) {
                        res.status(500).send('Conversion failed with code ' + code);
                    }
                }
            });

            // Handle error on spawn itself
            ffmpegProcess.on('error', (err) => {
                console.error('Failed to start FFmpeg process:', err);
                if (!res.headersSent) res.status(500).send('Failed to start conversion');
            });

        } else {
            res.status(400).send('Unsupported video type');
        }

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) res.status(500).send('Download failed');
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
