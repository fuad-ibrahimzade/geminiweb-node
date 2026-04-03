import { chromium, Browser, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const GEMINI_URL = "https://gemini.google.com";
const SESSION_DIR = path.join(os.homedir(), ".gemini-server");
const COOKIES_FILE = path.join(SESSION_DIR, "cookies.json");

interface LoginOptions {
  headless: boolean;
}

export async function login(options: LoginOptions): Promise<void> {
  console.log("Starting Gemini login process...");
  console.log("Opening browser for authentication...");

  // Ensure session directory exists
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: options.headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });

  try {
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

    console.log("\n✓ Login complete! You can now use 'gemini-server serve' to start the API server.");
  } catch (error) {
    console.error("Error during login:", error);
    throw error;
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

async function checkIfLoggedIn(page: Page): Promise<boolean> {
  try {
    // Check for elements that indicate logged-in state
    // Look for the chat input or user profile elements
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
