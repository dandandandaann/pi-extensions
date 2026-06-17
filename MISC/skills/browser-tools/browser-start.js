#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import puppeteer from "puppeteer-core";

// Detect OS and find Chrome
function getChromePath() {
	const platform = process.platform;
	
	if (platform === "darwin") {
		return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
	}
	
	if (platform === "win32") {
		// Check common Windows Chrome locations
		const locations = [
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
			process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
		];
		
		for (const loc of locations) {
			try {
				execSync(`test -f "${loc}"`, { stdio: "ignore" });
				return loc;
			} catch {}
		}
		
		// Try using where command
		try {
			const result = execSync("where chrome", { stdio: "pipe" }).toString().trim().split("\n")[0];
			if (result) return result;
		} catch {}
	}
	
	// Linux fallback
	if (platform === "linux") {
		const locations = [
			"/usr/bin/google-chrome",
			"/usr/bin/google-chrome-stable",
			"/snap/bin/google-chrome",
		];
		for (const loc of locations) {
			try {
				execSync(`test -f "${loc}"`, { stdio: "ignore" });
				return loc;
			} catch {}
		}
	}
	
	return null;
}

function getCacheDir() {
	const platform = process.platform;
	if (platform === "win32") {
		return process.env.APPDATA + "\\browser-tools";
	}
	return process.env.HOME + "/.cache/browser-tools";
}

function getProfileSource() {
	const platform = process.platform;
	if (platform === "darwin") {
		return process.env.HOME + "/Library/Application Support/Google/Chrome/";
	}
	if (platform === "win32") {
		return process.env.LOCALAPPDATA + "\\Google\\Chrome\\User Data\\";
	}
	return process.env.HOME + "/.config/google-chrome/";
}

const useProfile = process.argv[2] === "--profile";

if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: browser-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your default Chrome profile (cookies, logins)");
	process.exit(1);
}

const chromePath = getChromePath();
const SCRAPING_DIR = getCacheDir();

if (!chromePath) {
	console.error("✗ Chrome not found. Please install Google Chrome.");
	process.exit(1);
}

// Check if already running on :9222
try {
	const browser = await puppeteer.connect({
		browserURL: "http://localhost:9222",
		defaultViewport: null,
	});
	await browser.disconnect();
	console.log("✓ Chrome already running on :9222");
	process.exit(0);
} catch {}

// Setup profile directory
if (process.platform === "win32") {
	execSync(`if not exist "${SCRAPING_DIR}" mkdir "${SCRAPING_DIR}"`, { stdio: "ignore" });
} else {
	execSync(`mkdir -p "${SCRAPING_DIR}"`, { stdio: "ignore" });
}

// Remove SingletonLock to allow new instance
try {
	if (process.platform === "win32") {
		execSync(`del /F /Q "${SCRAPING_DIR}\\SingletonLock" 2>nul`, { stdio: "ignore" });
	} else {
		execSync(`rm -f "${SCRAPING_DIR}/SingletonLock" "${SCRAPING_DIR}/SingletonSocket" "${SCRAPING_DIR}/SingletonCookie"`, { stdio: "ignore" });
	}
} catch {}

if (useProfile) {
	console.log("Syncing profile...");
	const srcDir = getProfileSource();
	try {
		if (process.platform === "win32") {
			execSync(`xcopy /E /I /Y "${srcDir}" "${SCRAPING_DIR}\\"`, { stdio: "pipe" });
		} else {
			execSync(
				`rsync -a --delete \
				--exclude='SingletonLock' \
				--exclude='SingletonSocket' \
				--exclude='SingletonCookie' \
				--exclude='*/Sessions/*' \
				--exclude='*/Current Session' \
				--exclude='*/Current Tabs' \
				--exclude='*/Last Session' \
				--exclude='*/Last Tabs' \
				"${srcDir}" "${SCRAPING_DIR}/"`,
				{ stdio: "pipe" },
			);
		}
	} catch (e) {
		console.log("Profile sync skipped (may need manual setup)");
	}
}

// Start Chrome with flags to force new instance
spawn(
	chromePath,
	[
		"--remote-debugging-port=9222",
		`--user-data-dir=${SCRAPING_DIR}`,
		"--no-first-run",
		"--no-default-browser-check",
	],
	{ detached: true, stdio: "ignore" },
).unref();

// Wait for Chrome to be ready
let connected = false;
for (let i = 0; i < 30; i++) {
	try {
		const browser = await puppeteer.connect({
			browserURL: "http://localhost:9222",
			defaultViewport: null,
		});
		await browser.disconnect();
		connected = true;
		break;
	} catch {
		await new Promise((r) => setTimeout(r, 500));
	}
}

if (!connected) {
	console.error("✗ Failed to connect to Chrome");
	process.exit(1);
}

console.log(`✓ Chrome started on :9222${useProfile ? " with your profile" : ""}`);
