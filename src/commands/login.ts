import { chromium, firefox, Browser, Page, BrowserType } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const GEMINI_URL = "https://gemini.google.com";
const SESSION_DIR = path.join(os.homedir(), ".gemini-server");
const COOKIES_FILE = path.join(SESSION_DIR, "cookies.json");

interface LoginOptions {
  headless: boolean;
  browser: "chromium" | "firefox";
  chromiumPath?: string;
  firefoxPath?: string;
}

// Detect if we're on NixOS
function isNixOS(): boolean {
  return fs.existsSync("/etc/nixos/nixexprs") || fs.existsSync("/etc/NIXOS");
}

// Get recommended browser for the current OS
function getRecommendedBrowser(): "chromium" | "firefox" {
  if (isNixOS()) {
    console.log("Detected NixOS: Using Firefox (works without system library dependencies)");
    return "firefox";
  }
  return "chromium";
}

// Install Firefox on NixOS if needed
async function ensureFirefoxInstalled(): Promise<void> {
  if (isNixOS()) {
    console.log("Note: On NixOS, you may need to install Firefox with:");
    console.log("  nix-env -iA nixpkgs.firefox");
    console.log("Or add to your shell.nix/home-manager config.\n");
  }
}

export async function login(options: LoginOptions): Promise<void> {
  // Determine which browser to use
  const browserType: BrowserType = options.browser === "firefox" ? firefox : chromium;
  
  console.log("Starting Gemini login process...");
  console.log(`Using browser: ${options.browser === "firefox" ? "Firefox" : "Chromium"}`);
  
  if (options.browser === "chromium" && isNixOS()) {
    console.log("\n⚠️  Warning: Chromium on NixOS requires system libraries.");
    console.log("If this fails, try: npm run login -- --browser firefox");
    console.log("Or install Firefox: nix-env -iA nixpkgs.firefox\n");
  }

  // Log custom browser paths if provided
  if (options.browser === "chromium" && options.chromiumPath) {
    console.log(`Custom Chromium path: ${options.chromiumPath}`);
  } else if (options.browser === "firefox" && options.firefoxPath) {
    console.log(`Custom Firefox path: ${options.firefoxPath}`);
  }

  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  let browser: Browser | null = null;
  
  try {
    const launchOptions: any = {
      headless: options.headless,
      args: options.browser === "chromium" 
        ? ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"]
        : [],
    };

    // Use custom executable path if provided
    if (options.browser === "chromium" && options.chromiumPath) {
      launchOptions.executablePath = options.chromiumPath;
    } else if (options.browser === "firefox" && options.firefoxPath) {
      launchOptions.executablePath = options.firefoxPath;
    }

    browser = await browserType.launch(launchOptions);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page = await context.newPage();

    // Navigate to Gemini
    console.log(`Navigating to ${GEMINI_URL}...`);
    await page.goto(GEMINI_URL, { waitUntil: "networkidle" });

    // Check if already logged in
    const isLoggedIn = await checkIfLoggedIn(page);

    if (isLoggedIn) {
      console.log("✓ Already logged in to Gemini!");
    } else {
      console.log("\n========================================");
      console.log("Please log in to Gemini in the browser.");
      console.log("The browser will stay open until you complete the login.");
      console.log("========================================\n");

      // Wait for login to complete
      await waitForLogin(page);
      console.log("✓ Login detected!");
    }

    // Save cookies for later use
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIES_FILE, JSON.stringify(cookies, null, 2));
    console.log(`✓ Session saved to ${COOKIES_FILE}`);

    console.log("\n✓ Login complete! You can now use 'npm run serve' to start the API server.");
  } catch (error: any) {
    // Provide helpful error messages
    if (error.message?.includes("libnspr4.so") || error.message?.includes("shared libraries")) {
      console.error("\n❌ Missing system libraries for Chromium.");
      console.error("\nSolutions:");
      console.error("1. Use Firefox instead: npm run login -- --browser firefox");
      console.error("2. Install Chromium dependencies on NixOS:");
      console.error("   nix-env -iA nixpkgs.chromedriver");
      console.error("   Or use steam-run: sr npm run login");
      console.error("3. Install Firefox: nix-env -iA nixpkgs.firefox");
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close();
      console.log("Browser closed.");
    }
  }
}

async function checkIfLoggedIn(page: Page): Promise<boolean> {
  try {
    // Check for elements that indicate logged-in state
    const loggedInIndicators = [
      '[data-testid="chat-input"]',
      '[placeholder*="Ask anything"]',
      ".chat-input",
      "[data-typing-enable-id]",
    ];

    for (const selector of loggedInIndicators) {
      const element = await page.$(selector);
      if (element) {
        return true;
      }
    }

    // Check if URL contains app (indicates logged in)
    const url = page.url();
    if (url.includes("/app") || url.includes("gemini.google.com/app")) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function waitForLogin(page: Page): Promise<void> {
  // Poll every 2 seconds to check if logged in
  const maxWaitTime = 10 * 60 * 1000; // 10 minutes
  const pollInterval = 2000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const isLoggedIn = await checkIfLoggedIn(page);
    if (isLoggedIn) {
      return;
    }
    await page.waitForTimeout(pollInterval);
  }

  throw new Error("Login timeout: Did not detect successful login within 10 minutes");
}
