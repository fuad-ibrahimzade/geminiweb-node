import express, { Request, Response } from "express";
import { chromium, firefox, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ChatCompletionRequest, ChatCompletionResponse, ModelInfo } from "../types";

interface ServeOptions {
  port: string;
  host: string;
  headless: boolean;
  poolSize: string;
  browser: "chromium" | "firefox";
  chromiumPath?: string;
  firefoxPath?: string;
}

const GEMINI_URL = "https://gemini.google.com";
const SESSION_DIR = path.join(os.homedir(), ".gemini-server");
const COOKIES_FILE = path.join(SESSION_DIR, "cookies.json");

const MODELS: ModelInfo[] = [
  { id: "gemini", object: "model", created: Date.now(), owned_by: "google" },
  { id: "gemini-pro", object: "model", created: Date.now(), owned_by: "google" },
  { id: "gemini-ultra", object: "model", created: Date.now(), owned_by: "google" },
];

class TabManager {
  private browser: Browser | null = null;
  private contexts: BrowserContext[] = [];
  private pages: Page[] = [];
  private availablePages: Page[] = [];
  private busyPages: Set<Page> = new Set();
  private browserType: "chromium" | "firefox";
  private chromiumPath?: string;
  private firefoxPath?: string;

  constructor(browserType: "chromium" | "firefox", chromiumPath?: string, firefoxPath?: string) {
    this.browserType = browserType;
    this.chromiumPath = chromiumPath;
    this.firefoxPath = firefoxPath;
  }

  async initialize(poolSize: number, headless: boolean): Promise<void> {
    const browserType = this.browserType === "firefox" ? firefox : chromium;
    
    console.log(`Initializing ${this.browserType} browser with ${poolSize} tabs...`);
    
    const launchOptions: any = {
      headless,
      args: this.browserType === "chromium" 
        ? ["--disable-blink-features=AutomationControlled", "--no-sandbox", "--disable-setuid-sandbox"]
        : ["--width=1280", "--height=800"],
    };

    // Use custom executable path if provided
    if (this.browserType === "chromium" && this.chromiumPath) {
      launchOptions.executablePath = this.chromiumPath;
    } else if (this.browserType === "firefox" && this.firefoxPath) {
      launchOptions.executablePath = this.firefoxPath;
    }

    if (this.browserType === "firefox") {
      launchOptions.firefoxUserPrefs = {
        "remote.active-port": 0,
        "dom.webdriver.enabled": false,
        "useAutomationExtension": false,
        "webgl.disabled": true,
        "webgl.disable-extensions": true,
        "gfx.driver.disabled": true,
        "security.insecure_connection.enabled": true,
        "security.insecure_connection.warn": false,
      };
    }

    this.browser = await browserType.launch(launchOptions);

    // Load cookies if they exist
    let cookies: any[] = [];
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        const cookiesData = fs.readFileSync(COOKIES_FILE, "utf-8");
        cookies = JSON.parse(cookiesData);
      } catch (e) {
        console.warn("Failed to load cookies:", e);
      }
    }

    const userAgent = this.browserType === "firefox"
      ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0"
      : "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

    // Create contexts and pages
    for (let i = 0; i < poolSize; i++) {
      const context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });
      
      if (cookies.length > 0) {
        await context.addCookies(cookies);
      }

      this.contexts.push(context);
      const page = await context.newPage();
      this.pages.push(page);
      this.availablePages.push(page);
    }

    console.log(`✓ Browser initialized with ${poolSize} tabs`);
  }

  async acquirePage(): Promise<Page> {
    if (this.availablePages.length === 0) {
      // Wait for a page to become available
      await new Promise(resolve => setTimeout(resolve, 500));
      return this.acquirePage();
    }
    const page = this.availablePages.pop()!;
    this.busyPages.add(page);
    return page;
  }

  releasePage(page: Page): void {
    this.busyPages.delete(page);
    this.availablePages.push(page);
  }

  async destroy(): Promise<void> {
    for (const page of this.pages) {
      await page.close();
    }
    for (const context of this.contexts) {
      await context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
    console.log("✓ Browser closed");
  }

  getStats() {
    return {
      available: this.availablePages.length,
      busy: this.busyPages.size,
      total: this.pages.length
    };
  }
}

export async function serve(options: ServeOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  const host = options.host;
  const poolSize = parseInt(options.poolSize, 10);

  console.log("Starting Gemini API server...");
  console.log(`Configuration: host=${host}, port=${port}, headless=${options.headless}, poolSize=${poolSize}, browser=${options.browser}`);
  if (options.chromiumPath) {
    console.log(`Custom Chromium path: ${options.chromiumPath}`);
  }
  if (options.firefoxPath) {
    console.log(`Custom Firefox path: ${options.firefoxPath}`);
  }

  // Initialize browser and tab pool
  const tabManager = new TabManager(options.browser, options.chromiumPath, options.firefoxPath);
  await tabManager.initialize(poolSize, options.headless);

  const app = express();
  app.use(express.json({ limit: "50mb" }));

  // CORS middleware
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString(), tabs: tabManager.getStats() });
  });

  // List models endpoint
  app.get("/v1/models", (req: Request, res: Response) => {
    res.json({ object: "list", data: MODELS });
  });

  // Chat completions endpoint
  app.post("/v1/chat/completions", async (req: Request, res: Response) => {
    const requestBody: ChatCompletionRequest = req.body;

    if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      res.status(400).json({
        error: { message: "messages is required and must be a non-empty array", type: "invalid_request_error" },
      });
      return;
    }

    const stream = requestBody.stream ?? false;
    const page = await tabManager.acquirePage();

    try {
      // Check if already on Gemini to use reload instead of goto
      const currentUrl = page.url();
      console.log(`[Debug] Current URL: ${currentUrl}`);

      let navigated = false;
      let navigationError = null;
      const waitStrategies: ("domcontentloaded" | "load" | "networkidle")[] = ["domcontentloaded", "load", "networkidle"];
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const waitStrategy = waitStrategies[attempt - 1];
          
          if (currentUrl.includes("gemini.google.com")) {
            // Use reload to force a fresh page load when already on Gemini
            console.log(`[Debug] Reloading page (attempt ${attempt}, waitUntil: ${waitStrategy})`);
            await page.reload({ waitUntil: waitStrategy, timeout: 30000 });
          } else {
            // Navigate to Gemini
            console.log(`[Debug] Navigating to Gemini (attempt ${attempt}, waitUntil: ${waitStrategy})`);
            await page.goto(GEMINI_URL, { waitUntil: waitStrategy, timeout: 30000 });
          }
          navigated = true;
          console.log(`[Debug] Navigation successful. Current URL: ${page.url()}`);
          break;
        } catch (err: any) {
          navigationError = err;
          console.warn(`Navigation attempt ${attempt} failed with ${waitStrategies[attempt-1]}: ${err.message}`);
          if (attempt < 3) await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }

      if (!navigated) {
        throw new Error(`Network error: Failed to reach Gemini after multiple attempts. ${navigationError?.message}`);
      }

      // Check for login prompt or session expiry - more specific check
      const currentUrlAfterNav = page.url();
      console.log(`[Debug] URL after navigation: ${currentUrlAfterNav}`);

      // Primary check: if we've been redirected to accounts.google.com, we're definitely on a login page
      if (currentUrlAfterNav.includes("accounts.google.com")) {
        console.error("[Error] Redirected to accounts.google.com - user not logged in");
        throw new Error("Authentication error: Not logged in or session expired. Please run 'npm run login' again.");
      }

      // Secondary check: look for specific login page elements, not just "Sign in" text
      const isLoginPrompt = await page.evaluate(() => {
        // Check for login page specific indicators
        const loginElements = [
          document.querySelector('input[type="email"]'),
          document.querySelector('input[type="password"]'),
          document.querySelector('[data-initial-focus="true"]'),
        ];
        
        const hasLoginElements = loginElements.some(el => el !== null);
        
        // Check for specific login page text combinations
        const bodyText = document.body.innerText;
        const hasLoginText = bodyText.includes("to continue to Gemini") || 
                           bodyText.includes("Use your Google Account");
        
        return hasLoginElements || hasLoginText;
      });

      if (isLoginPrompt) {
        console.error("[Error] Login page detected");
        throw new Error("Authentication error: Not logged in or session expired. Please run 'npm run login' again.");
      }

      console.log("[Debug] Authentication check passed");

      // Check for "browser not secure" warning
      const isNotSecure = await page.evaluate(() => {
        return document.body.innerText.includes("This browser or app may not be secure");
      });

      if (isNotSecure) {
        throw new Error("Browser security error: Google blocked this browser as 'not secure'. Try switching browser type or running login again.");
      }

      // Format prompt
      const prompt = requestBody.messages.map(m => {
        if (m.role === "system") return `System: ${m.content}`;
        if (m.role === "user") return m.content;
        return `Assistant: ${m.content}`;
      }).join("\n\n");

      // Find and fill input with custom wait strategy
      const inputSelectors = [
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        '[data-testid="chat-input"]',
        '[placeholder*="Ask anything"]',
        'textarea[aria-label*="chat"]',
        "rich-textarea",
      ];

      let inputElement = null;
      let inputReady = false;
      let usedSelector = "";
      for (let i = 0; i < 15; i++) { // 15 second timeout
        for (const selector of inputSelectors) {
          try {
            inputElement = await page.$(selector);
            if (inputElement && await inputElement.isVisible()) {
              inputReady = true;
              usedSelector = selector;
              break;
            }
          } catch { continue; }
        }
        if (inputReady) break;
        await page.waitForTimeout(1000);
      }

      if (!inputElement) {
        // One last check for login page if we couldn't find the input
        if (page.url().includes("accounts.google.com")) {
          throw new Error("Authentication error: Directed to login page. Please run 'npm run login'.");
        }
        console.error("Failed to find chat input. Available selectors tried:", inputSelectors);
        throw new Error("Timeout error: Could not find chat input field. Gemini might be slow or the UI has changed.");
      }

      console.log(`Found chat input using selector: ${usedSelector}`);

      try {
        if (usedSelector.includes('contenteditable="true"')) {
          await inputElement.click();
          // Clear content for contenteditable
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.keyboard.type(prompt);
        } else {
          await inputElement.fill(prompt);
        }
      } catch (error: any) {
        console.warn(`Failed to fill/type prompt using ${usedSelector}: ${error.message}`);
        // Fallback to click and type if fill fails
        await inputElement.click();
        await page.keyboard.type(prompt);
      }

      // Submit the message
      const submitSelectors = [
        'button._send_button',
        '[data-testid="send-button"]',
        'button[aria-label*="Send"]',
        'button[type="submit"]',
      ];

      let submitted = false;
      for (const selector of submitSelectors) {
        try {
          const submitButton = await page.$(selector);
          if (submitButton && await submitButton.isVisible() && await submitButton.isEnabled()) {
            console.log(`Clicking send button using selector: ${selector}`);
            await submitButton.click();
            submitted = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!submitted) {
        console.log("Could not find or click send button, pressing Enter as fallback");
        await page.keyboard.press("Enter");
      }

      // Wait for response with better detection logic
      console.log("[Debug] Waiting for response...");
      
      const responseSelectors = [".response-content", '[data-testid="response"]', ".conversation-response", '[data-message-author-role="model"]'];
      const loadingSelectors = [".loading-indicator", '[data-testid="loading"]', ".generating", ".thinking", "mat-progress-bar", "[aria-label='Thinking']"];
      
      let response = "";
      let responseElement = null;
      let foundSelector = "";
      const maxWaitTime = 60000; // 60 seconds
      const checkInterval = 500;
      const startTime = Date.now();
      let lastResponseLength = 0;
      let stableCount = 0;
      const requiredStableCount = 3; // Need 3 consecutive checks with same length

      // First, find the response element
      console.log("[Debug] Looking for response element...");
      while (Date.now() - startTime < maxWaitTime) {
        // Check if response is complete (no loading indicators)
        const isLoading = await page.evaluate((selectors) => {
          for (const selector of selectors) {
            const el = document.querySelector(selector);
            if (el && (el as HTMLElement).offsetParent !== null) { // Element exists and is visible
              return true;
            }
          }
          // Also check for loading text
          const bodyText = document.body.innerText;
          return bodyText.includes("Thinking...") || 
                 bodyText.includes("Gemini is thinking") ||
                 bodyText.includes("Generating response");
        }, loadingSelectors);

        if (!isLoading) {
          // Try to find response element
          for (const selector of responseSelectors) {
            try {
              const elements = await page.$$(selector);
              if (elements.length > 0) {
                // Get the last one (most recent response)
                const lastElement = elements[elements.length - 1];
                const text = await lastElement.textContent();
                if (text && text.trim().length > 0) {
                  responseElement = lastElement;
                  foundSelector = selector;
                  response = text.trim();
                  console.log(`[Debug] Response element found: ${selector}, length: ${response.length}`);
                  break;
                }
              }
            } catch { continue; }
          }

          if (responseElement) {
            // Check if response is stable
            if (response.length === lastResponseLength) {
              stableCount++;
              if (stableCount >= requiredStableCount) {
                console.log(`[Debug] Response stable for ${stableCount} checks. Final length: ${response.length}`);
                break;
              }
            } else {
              lastResponseLength = response.length;
              stableCount = 0;
              console.log(`[Debug] Response still generating... Current length: ${response.length}`);
            }
          }
        } else {
          console.log("[Debug] Still loading/thinking...");
        }
        
        await page.waitForTimeout(checkInterval);
      }

      // Final attempt to get response
      if (!response || response.length === 0) {
        console.log("[Debug] No response found during polling, making final attempt...");
        for (const selector of responseSelectors) {
          try {
            const elements = await page.$$(selector);
            if (elements.length > 0) {
              const lastElement = elements[elements.length - 1];
              const text = await lastElement.textContent();
              if (text && text.trim().length > 0) {
                response = text.trim();
                console.log(`[Debug] Final attempt found response: length ${response.length}`);
                break;
              }
            }
          } catch { continue; }
        }
      }

      if (!response) {
        throw new Error("Failed to get response from Gemini. The response may not have loaded properly.");
      }
      
      console.log(`[Debug] Final response length: ${response.length}`);

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        
        const words = response.split(" ");
        for (const word of words) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + " " } }] })}\n\n`);
          await new Promise(r => setTimeout(r, 50));
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        res.json({
          id: `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: requestBody.model || "gemini",
          choices: [{ index: 0, message: { role: "assistant", content: response }, finish_reason: "stop" }],
          usage: { prompt_tokens: prompt.length, completion_tokens: response.length, total_tokens: prompt.length + response.length }
        });
      }
    } catch (error: any) {
      console.error("Error processing chat completion:", error);
      res.status(500).json({
        error: { message: error.message || "Internal server error", type: "internal_error" },
      });
    } finally {
      tabManager.releasePage(page);
    }
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: express.NextFunction) => {
    console.error("Express error:", err);
    res.status(500).json({ error: { message: err.message || "Internal server error", type: "internal_error" } });
  });

  // Start server
  const server = app.listen(port, host, () => {
    console.log(`\n✓ Gemini API server running at http://${host}:${port}`);
    console.log(`\nEndpoints:`);
    console.log(`  - GET  /health          Health check`);
    console.log(`  - GET  /v1/models       List available models`);
    console.log(`  - POST /v1/chat/completions  Chat completions (OpenAI-compatible)`);
    console.log(`\nPress Ctrl+C to stop the server.`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down server...");
    server.close(async () => {
      await tabManager.destroy();
      console.log("Server stopped.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
