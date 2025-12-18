# Render Deployment Guide

## Step-by-Step Instructions to Update Your Code on Render

### 1. Prepare Your Local Repository

First, ensure all your changes are committed and pushed to your Git repository:

```bash
# Add all files to git
git add .

# Commit your changes
git commit -m "Add Puppeteer deployment fixes and environment configuration"

# Push to your repository (GitHub, GitLab, etc.)
git push origin main
```

### 2. Update Render Service Configuration

#### A. Access Your Render Dashboard
1. Go to [render.com](https://render.com)
2. Sign in to your account
3. Find your video scraper service in the dashboard

#### B. Update Build & Start Commands
1. Click on your service name
2. Go to **Settings** tab
3. Update the following:

**Build Command:**
```bash
npm install && npx puppeteer browsers install chrome
```

**Start Command:**
```bash
npm start
```

### 3. Configure Environment Variables

In your Render service settings, go to **Environment** section and add these variables:

#### Required Environment Variables:
```
NODE_ENV=production
PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
CHROME_BIN=/usr/bin/google-chrome-stable
DEBUG_PUPPETEER=false
DEBUG_FFMPEG=false
VERBOSE_LOGGING=false
```

#### Optional Performance Variables:
```
MAX_VIDEO_SIZE_MB=500
DOWNLOAD_TIMEOUT_MS=300000
PUPPETEER_TIMEOUT_MS=30000
```

### 4. Deploy the Updates

#### Option A: Auto-Deploy (Recommended)
If you have auto-deploy enabled:
1. Your service will automatically redeploy when you push to your repository
2. Monitor the build logs in the Render dashboard

#### Option B: Manual Deploy
If auto-deploy is disabled:
1. Go to your service dashboard
2. Click **Manual Deploy** button
3. Select **Deploy latest commit**

### 5. Monitor the Deployment

#### Watch Build Logs:
1. In your service dashboard, click on **Logs** tab
2. Monitor the build process for any errors
3. Look for these success indicators:
   ```
   ✓ npm install completed
   ✓ Chrome browser installed
   ✓ Server running on port 10000
   ✓ Puppeteer executable found
   ```

#### Check for Common Issues:
- **Chrome installation**: Should see "Chrome browser installed" in logs
- **Environment variables**: Should see config loaded without errors
- **Server startup**: Should see "🚀 Server running on http://localhost:10000"

### 6. Test Your Deployment

#### A. Basic Health Check:
Visit your Render URL (e.g., `https://your-app-name.onrender.com`)
- Should see the video scraper interface

#### B. Test Video Scraping:
1. Enter a video URL in the interface
2. Check if videos are detected properly
3. Try downloading a video to ensure full functionality

#### C. Check Logs for Errors:
Monitor the **Logs** tab for any runtime errors:
```
# Good indicators:
✓ Puppeteer launched successfully
✓ Video detection working
✓ Download process completed

# Error indicators to watch for:
✗ Chrome not found
✗ Puppeteer launch failed
✗ FFmpeg errors
```

### 7. Troubleshooting Common Issues

#### Issue: "Could not find Chrome"
**Solution:**
1. Verify environment variables are set correctly
2. Check build logs for Chrome installation
3. Add this to environment variables:
   ```
   PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
   ```

#### Issue: "Memory limit exceeded"
**Solution:**
1. Upgrade to a higher Render plan
2. Add memory optimization flags:
   ```
   CHROME_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--memory-pressure-off,--max_old_space_size=2048
   ```

#### Issue: "Build timeout"
**Solution:**
1. The Chrome installation might be taking too long
2. Try splitting the build command:
   ```
   Build Command: npm install
   ```
   Then add a startup script that installs Chrome on first run

#### Issue: "FFmpeg not working"
**Solution:**
1. FFmpeg-static should work automatically
2. If issues persist, check the logs for specific FFmpeg errors
3. Some video formats might not be supported

### 8. Performance Optimization

#### A. Enable Compression:
Add to environment variables:
```
COMPRESSION_ENABLED=true
```

#### B. Set Appropriate Timeouts:
```
PUPPETEER_TIMEOUT_MS=30000
DOWNLOAD_TIMEOUT_MS=300000
```

#### C. Monitor Resource Usage:
1. Check **Metrics** tab in Render dashboard
2. Monitor CPU and memory usage
3. Upgrade plan if consistently hitting limits

### 9. Security Considerations

#### A. Environment Variables:
- Never commit `.env` file to your repository
- Use Render's environment variable system
- Keep sensitive data in environment variables only

#### B. CORS Configuration:
If needed, add your domain:
```
CORS_ORIGIN=https://yourdomain.com
```

### 10. Maintenance

#### A. Regular Updates:
1. Keep dependencies updated
2. Monitor Render service health
3. Check logs regularly for errors

#### B. Backup Strategy:
1. Keep your code in version control
2. Document your environment variable configuration
3. Test deployments in a staging environment first

## Quick Deployment Checklist

- [ ] Code committed and pushed to repository
- [ ] Build command updated: `npm install && npx puppeteer browsers install chrome`
- [ ] Start command updated: `npm start`
- [ ] Environment variables configured
- [ ] Auto-deploy enabled (optional)
- [ ] Deployment monitored via logs
- [ ] Application tested after deployment
- [ ] Error monitoring set up

## Support

If you encounter issues:
1. Check Render's status page
2. Review build and runtime logs
3. Test locally with production environment variables
4. Contact Render support if infrastructure issues persist

## Useful Render URLs

- **Dashboard**: https://dashboard.render.com
- **Documentation**: https://render.com/docs
- **Status Page**: https://status.render.com
- **Support**: https://render.com/support