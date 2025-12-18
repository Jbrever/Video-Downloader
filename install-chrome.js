#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔍 Checking Chrome installation...');

// Common Chrome paths to check
const chromePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/opt/google/chrome/chrome',
    '/opt/render/project/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome'
];

// Check if Chrome is already installed
let chromeFound = false;
for (const chromePath of chromePaths) {
    try {
        if (fs.existsSync(chromePath)) {
            console.log(`✅ Found Chrome at: ${chromePath}`);
            chromeFound = true;
            break;
        }
    } catch (error) {
        // Continue checking
    }
}

// If Chrome not found, try to install it
if (!chromeFound) {
    console.log('❌ Chrome not found, attempting installation...');
    
    try {
        // Method 1: Try Puppeteer's Chrome installation
        console.log('📦 Installing Chrome via Puppeteer...');
        execSync('npx puppeteer browsers install chrome', { 
            stdio: 'inherit',
            timeout: 300000 // 5 minutes timeout
        });
        console.log('✅ Puppeteer Chrome installation completed');
        
        // Check if Puppeteer Chrome was installed
        const puppeteerChromePath = path.join(__dirname, '.cache', 'puppeteer');
        if (fs.existsSync(puppeteerChromePath)) {
            console.log('✅ Puppeteer Chrome cache found');
        }
        
    } catch (error) {
        console.log('⚠️  Puppeteer Chrome installation failed, trying system installation...');
        
        try {
            // Method 2: Try system Chrome installation (for Ubuntu/Debian)
            console.log('📦 Installing system Chrome...');
            execSync('apt-get update && apt-get install -y wget gnupg', { stdio: 'inherit' });
            execSync('wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -', { stdio: 'inherit' });
            execSync('echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list', { stdio: 'inherit' });
            execSync('apt-get update && apt-get install -y google-chrome-stable', { stdio: 'inherit' });
            console.log('✅ System Chrome installation completed');
            
        } catch (systemError) {
            console.log('⚠️  System Chrome installation failed, will use Puppeteer bundled Chromium');
            console.log('This is normal on some hosting platforms like Render');
        }
    }
} else {
    console.log('✅ Chrome already installed, skipping installation');
}

// Final verification
console.log('🔍 Final Chrome verification...');
let finalChromeFound = false;

// Check all possible Chrome locations again
const allPossiblePaths = [
    ...chromePaths,
    // Add Puppeteer cache paths
    path.join(__dirname, '.cache', 'puppeteer', 'chrome', 'linux-*', 'chrome-linux*', 'chrome'),
    path.join(__dirname, 'node_modules', 'puppeteer', '.local-chromium', 'linux-*', 'chrome-linux', 'chrome')
];

for (const chromePath of allPossiblePaths) {
    try {
        if (chromePath.includes('*')) {
            // Handle glob patterns
            const { glob } = require('glob');
            const matches = glob.sync(chromePath);
            if (matches.length > 0 && fs.existsSync(matches[0])) {
                console.log(`✅ Final verification: Found Chrome at ${matches[0]}`);
                finalChromeFound = true;
                break;
            }
        } else if (fs.existsSync(chromePath)) {
            console.log(`✅ Final verification: Found Chrome at ${chromePath}`);
            finalChromeFound = true;
            break;
        }
    } catch (error) {
        // Continue checking
    }
}

if (!finalChromeFound) {
    console.log('⚠️  No Chrome installation detected, but Puppeteer may still work with bundled Chromium');
    console.log('The application will attempt to use Puppeteer\'s bundled browser');
}

console.log('🎉 Chrome installation check completed');