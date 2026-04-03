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

    await this.navigateToGemini();

    this.initialized = true;
    console.log("✓ Tab initialized");
  }

  private async navigateToGemini(): Promise<void> {
    // Check if already on Gemini to use reload instead of goto
    const currentUrl = this.page.url();
    if (currentUrl.includes("gemini.google.com")) {
      // Use reload to force a fresh page load
      await this.page.reload({ waitUntil: "networkidle" });
    } else {
      await this.page.goto(GEMINI_URL, { waitUntil: "networkidle" });
    }

    // Wait for the page to be ready
    await this.waitForPageReady();
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
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      '[data-testid="chat-input"]',
      '[placeholder*="Ask anything"]',
      ".chat-input textarea",
      'textarea[aria-label*="chat"]',
      "rich-textarea",
    ];

    let inputElement = null;
    let usedSelector = "";
    for (const selector of inputSelectors) {
      try {
        inputElement = await this.page.$(selector);
        if (inputElement) {
          usedSelector = selector;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!inputElement) {
      console.error("Failed to find chat input. Available selectors tried:", inputSelectors);
      throw new Error("Could not find chat input field");
    }

    console.log(`Found chat input using selector: ${usedSelector}`);

    // Clear any existing content and type the prompt
    try {
      // Click to focus the input
      await inputElement.click();
      await this.page.waitForTimeout(100);

      // Clear content - use Ctrl+A to select all then type to replace
      await this.page.keyboard.press('Control+A');
      await this.page.waitForTimeout(50);
      await this.page.keyboard.press('Delete');
      await this.page.waitForTimeout(50);

      // Type the new prompt
      await this.page.keyboard.type(prompt);
      await this.page.waitForTimeout(100);
    } catch (error: any) {
      console.warn(`Failed to fill/type prompt using ${usedSelector}: ${error.message}`);
      // Fallback to fill if available
      try {
        await inputElement.fill(prompt);
      } catch {
        // Last resort: click and type
        await inputElement.click();
        await this.page.keyboard.type(prompt);
      }
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
        const submitButton = await this.page.$(selector);
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
      ".model-response-text",
      '[class*="response"]',
    ];

    // Wait a bit for the response to start generating
    await this.page.waitForTimeout(1000);

    // First, wait for any response element to appear
    let responseElement = null;
    let foundSelector = "";
    const waitForElementStart = Date.now();
    const maxElementWaitTime = 30000; // 30 seconds to start seeing a response

    while (Date.now() - waitForElementStart < maxElementWaitTime) {
      for (const selector of responseSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const text = await element.textContent();
            // Only consider it found if it has content
            if (text && text.trim().length > 0) {
              responseElement = element;
              foundSelector = selector;
              break;
            }
          }
        } catch {
          continue;
        }
      }
      if (responseElement) break;
      await this.page.waitForTimeout(500);
    }

    if (!responseElement) {
      throw new Error("Timeout waiting for response element to appear");
    }

    console.log(`Found response element using selector: ${foundSelector}`);

    // Poll for response completion
    const maxWaitTime = 120000; // 2 minutes
    const pollInterval = 1000;
    const startTime = Date.now();

    let lastResponseText = "";

    while (Date.now() - startTime < maxWaitTime) {
      try {
        const text = await responseElement.textContent();
        if (text && text !== lastResponseText) {
          lastResponseText = text;
          // Check if response is complete (no loading indicator)
          const isComplete = await this.isResponseComplete();
          if (isComplete && text.trim().length > 0) {
            return text.trim();
          }
        }
      } catch {
        // Element might have been replaced, try to find it again
        for (const selector of responseSelectors) {
          try {
            const element = await this.page.$(selector);
            if (element) {
              responseElement = element;
              break;
            }
          } catch {
            continue;
          }
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
      ".model-response-text",
      '[class*="response"]',
    ];

    const maxWaitTime = 120000;
    const pollInterval = 100;
    const startTime = Date.now();

    let lastText = "";
    let responseElementFound = false;

    while (Date.now() - startTime < maxWaitTime) {
      let currentText = "";
      let responseElement = null;

      for (const selector of responseSelectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            const text = await element.textContent();
            if (text && text.trim().length > 0) {
              responseElement = element;
              currentText = text;
              responseElementFound = true;
              break;
            }
          }
        } catch {
          continue;
        }
      }

      // Only start yielding once we found a response element
      if (!responseElementFound) {
        await this.page.waitForTimeout(pollInterval);
        continue;
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

    if (!responseElementFound) {
      throw new Error("Timeout waiting for response element in stream");
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
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
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
    // Navigate to a new conversation using reload if already on Gemini
    await this.navigateToGemini();
  }

  async close(): Promise<void> {
    await this.page.close();
  }
}
