import { chromium, Browser, BrowserContext, Page } from "playwright";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const GEMINI_URL = "https://gemini.google.com";
const SESSION_DIR = path.join(os.homedir(), ".gemini-server");
const COOKIES_FILE = path.join(SESSION_DIR, "cookies.json");

export class GeminiBrowser {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private headless: boolean;

  constructor(headless: boolean) {
    this.headless = headless;
  }

  async initialize(): Promise<void> {
    console.log("Initializing browser...");

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    });

    const contextOptions: Parameters<typeof this.browser.newContext>[0] = {
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };

    this.context = await this.browser.newContext(contextOptions);

    // Load cookies if they exist
    if (fs.existsSync(COOKIES_FILE)) {
      try {
        const cookiesData = fs.readFileSync(COOKIES_FILE, "utf-8");
        const cookies = JSON.parse(cookiesData);
        await this.context.addCookies(cookies);
        console.log("✓ Loaded existing session cookies");
      } catch (error) {
        console.warn("Failed to load cookies:", error);
      }
    }

    console.log("✓ Browser initialized");
  }

  async createPage(): Promise<Page> {
    if (!this.context) {
      throw new Error("Browser not initialized");
    }
    return await this.context.newPage();
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      console.log("✓ Browser closed");
    }
  }

  getContext(): BrowserContext {
    if (!this.context) {
      throw new Error("Browser not initialized");
    }
    return this.context;
  }
}

export class GeminiTab {
  private page: Page;
  private initialized: boolean = false;
  private lastMessageTimestamp: number = 0;

  constructor(page: Page) {
    this.page = page;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.page.goto(GEMINI_URL, { waitUntil: "networkidle" });

    // Wait for the page to be ready
    await this.waitForPageReady();

    this.initialized = true;
    console.log("✓ Tab initialized");
  }

  async sendMessage(messages: { role: string; content: string }[]): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Format messages into a single prompt
    const prompt = this.formatMessages(messages);

    // Send the message
    await this.submitPrompt(prompt);

    // Wait for and get the response
    const response = await this.waitForResponse();

    return response;
  }

  async *sendMessageStream(
    messages: { role: string; content: string }[]
  ): AsyncGenerator<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const prompt = this.formatMessages(messages);
    await this.submitPrompt(prompt);

    // Stream the response
    yield* this.streamResponse();
  }

  private formatMessages(messages: { role: string; content: string }[]): string {
    return messages
      .map((m) => {
        if (m.role === "system") {
          return `System: ${m.content}`;
        } else if (m.role === "user") {
          return m.content;
        } else if (m.role === "assistant") {
          return `Assistant: ${m.content}`;
        }
        return m.content;
      })
      .join("\n\n");
  }

  private async submitPrompt(prompt: string): Promise<void> {
    // Find the input field and enter the prompt
    const inputSelectors = [
      '[data-testid="chat-input"]',
      '[placeholder*="Ask anything"]',
      ".chat-input textarea",
      'textarea[aria-label*="chat"]',
      "rich-textarea",
    ];

    let inputElement = null;
    for (const selector of inputSelectors) {
      try {
        inputElement = await this.page.$(selector);
        if (inputElement) {
          break;
        }
      } catch {
        continue;
      }
    }

    if (!inputElement) {
      throw new Error("Could not find chat input field");
    }

    // Clear any existing content and type the prompt
    await inputElement.fill(prompt);

    // Submit the message
    const submitSelectors = [
      '[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
    ];

    let submitted = false;
    for (const selector of submitSelectors) {
      try {
        const submitButton = await this.page.$(selector);
        if (submitButton) {
          await submitButton.click();
          submitted = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!submitted) {
      // Try pressing Enter as fallback
      await this.page.keyboard.press("Enter");
    }

    this.lastMessageTimestamp = Date.now();
  }

  private async waitForResponse(): Promise<string> {
    // Wait for the response to appear
    const responseSelectors = [
      ".response-content",
      '[data-testid="response"]',
      ".conversation-response",
      '[data-message-author-role="model"]',
    ];

    // Wait a bit for the response to start generating
    await this.page.waitForTimeout(1000);

    // Poll for response completion
    const maxWaitTime = 120000; // 2 minutes
    const pollInterval = 1000;
    const startTime = Date.now();

    let lastResponseText = "";

    while (Date.now() - startTime < maxWaitTime) {
      for (const selector of responseSelectors) {
        try {
          const responseElement = await this.page.$(selector);
          if (responseElement) {
            const text = await responseElement.textContent();
            if (text && text !== lastResponseText) {
              lastResponseText = text;
              // Check if response is complete (no loading indicator)
              const isComplete = await this.isResponseComplete();
              if (isComplete) {
                return text.trim();
              }
            }
          }
        } catch {
          continue;
        }
      }

      await this.page.waitForTimeout(pollInterval);
    }

    if (lastResponseText) {
      return lastResponseText.trim();
    }

    throw new Error("Timeout waiting for response");
  }

  private async *streamResponse(): AsyncGenerator<string> {
    const responseSelectors = [
      ".response-content",
      '[data-testid="response"]',
      ".conversation-response",
      '[data-message-author-role="model"]',
    ];

    const maxWaitTime = 120000;
    const pollInterval = 100;
    const startTime = Date.now();

    let lastText = "";

    while (Date.now() - startTime < maxWaitTime) {
      let currentText = "";

      for (const selector of responseSelectors) {
        try {
          const responseElement = await this.page.$(selector);
          if (responseElement) {
            currentText = (await responseElement.textContent()) || "";
            break;
          }
        } catch {
          continue;
        }
      }

      if (currentText.length > lastText.length) {
        const newText = currentText.slice(lastText.length);
        lastText = currentText;
        yield newText;
      }

      const isComplete = await this.isResponseComplete();
      if (isComplete && currentText.length > 0) {
        break;
      }

      await this.page.waitForTimeout(pollInterval);
    }
  }

  private async isResponseComplete(): Promise<boolean> {
    // Check for loading indicators
    const loadingSelectors = [
      ".loading-indicator",
      '[data-testid="loading"]',
      ".generating",
      ".thinking",
    ];

    for (const selector of loadingSelectors) {
      try {
        const loadingElement = await this.page.$(selector);
        if (loadingElement && (await loadingElement.isVisible())) {
          return false;
        }
      } catch {
        continue;
      }
    }

    // If no loading indicator found, response is likely complete
    return true;
  }

  private async waitForPageReady(): Promise<void> {
    // Wait for the chat interface to be ready
    const readySelectors = [
      '[data-testid="chat-input"]',
      '[placeholder*="Ask anything"]',
      ".chat-input",
    ];

    for (const selector of readySelectors) {
      try {
        await this.page.waitForSelector(selector, { timeout: 30000 });
        return;
      } catch {
        continue;
      }
    }

    throw new Error("Page did not become ready within timeout");
  }

  async reset(): Promise<void> {
    // Navigate to a new conversation
    await this.page.goto(GEMINI_URL, { waitUntil: "networkidle" });
    await this.waitForPageReady();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
