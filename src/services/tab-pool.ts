import { GeminiBrowser, GeminiTab } from "./gemini-browser";

interface PooledTab {
  tab: GeminiTab;
  inUse: boolean;
  lastUsed: number;
}

export class TabPool {
  private browser: GeminiBrowser;
  private poolSize: number;
  private tabs: PooledTab[] = [];
  private initialized: boolean = false;
  private waitQueue: Array<(tab: GeminiTab) => void> = [];

  constructor(browser: GeminiBrowser, poolSize: number) {
    this.browser = browser;
    this.poolSize = poolSize;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log(`Initializing tab pool with ${this.poolSize} tabs...`);

    for (let i = 0; i < this.poolSize; i++) {
      try {
        const page = await this.browser.createPage();
        const tab = new GeminiTab(page);
        await tab.initialize();

        this.tabs.push({
          tab,
          inUse: false,
          lastUsed: Date.now(),
        });

        console.log(`✓ Tab ${i + 1}/${this.poolSize} initialized`);
      } catch (error) {
        console.error(`Failed to initialize tab ${i + 1}:`, error);
        throw error;
      }
    }

    this.initialized = true;
    console.log("✓ Tab pool initialized");

    // Start maintenance interval
    this.startMaintenance();
  }

  async acquireTab(): Promise<GeminiTab> {
    if (!this.initialized) {
      throw new Error("Tab pool not initialized");
    }

    // Try to find an available tab
    const availableTab = this.tabs.find((t) => !t.inUse);

    if (availableTab) {
      availableTab.inUse = true;
      availableTab.lastUsed = Date.now();
      return availableTab.tab;
    }

    // If no tabs available, wait for one
    return new Promise((resolve) => {
      this.waitQueue.push((tab: GeminiTab) => {
        resolve(tab);
      });
    });
  }

  releaseTab(tab: GeminiTab): void {
    const pooledTab = this.tabs.find((t) => t.tab === tab);

    if (pooledTab) {
      pooledTab.inUse = false;
      pooledTab.lastUsed = Date.now();

      // Reset the tab for next use
      pooledTab.tab.reset().catch((err) => {
        console.error("Error resetting tab:", err);
      });

      // Check if there's a waiting request
      const waiter = this.waitQueue.shift();
      if (waiter) {
        pooledTab.inUse = true;
        pooledTab.lastUsed = Date.now();
        waiter(pooledTab.tab);
      }
    }
  }

  private startMaintenance(): void {
    // Periodic maintenance every 30 seconds
    setInterval(() => {
      this.performMaintenance();
    }, 30000);
  }

  private async performMaintenance(): Promise<void> {
    const now = Date.now();
    const maxIdleTime = 5 * 60 * 1000; // 5 minutes

    for (const pooledTab of this.tabs) {
      // Check for tabs that have been idle for too long
      if (!pooledTab.inUse && now - pooledTab.lastUsed > maxIdleTime) {
        console.log("Refreshing idle tab...");
        try {
          await pooledTab.tab.reset();
          pooledTab.lastUsed = now;
        } catch (error) {
          console.error("Error refreshing idle tab:", error);
        }
      }
    }
  }

  getStats(): { total: number; available: number; inUse: number; waiting: number } {
    return {
      total: this.tabs.length,
      available: this.tabs.filter((t) => !t.inUse).length,
      inUse: this.tabs.filter((t) => t.inUse).length,
      waiting: this.waitQueue.length,
    };
  }

  async destroy(): Promise<void> {
    console.log("Destroying tab pool...");

    // Clear any pending waiters
    this.waitQueue = [];

    // Close all tabs
    for (const pooledTab of this.tabs) {
      try {
        await pooledTab.tab.close();
      } catch (error) {
        console.error("Error closing tab:", error);
      }
    }

    this.tabs = [];
    this.initialized = false;

    console.log("✓ Tab pool destroyed");
  }
}
