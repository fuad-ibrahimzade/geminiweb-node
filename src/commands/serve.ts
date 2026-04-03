import express, { Request, Response } from "express";
import { GeminiBrowser } from "../services/gemini-browser";
import { TabPool } from "../services/tab-pool";
import { ChatCompletionRequest, ChatCompletionResponse, ModelInfo } from "../types";

interface ServeOptions {
  port: string;
  host: string;
  headless: boolean;
  poolSize: string;
}

const MODELS: ModelInfo[] = [
  {
    id: "gemini",
    object: "model",
    created: Date.now(),
    owned_by: "google",
  },
  {
    id: "gemini-pro",
    object: "model",
    created: Date.now(),
    owned_by: "google",
  },
  {
    id: "gemini-ultra",
    object: "model",
    created: Date.now(),
    owned_by: "google",
  },
];

export async function serve(options: ServeOptions): Promise<void> {
  const port = parseInt(options.port, 10);
  const host = options.host;
  const poolSize = parseInt(options.poolSize, 10);

  console.log("Starting Gemini API server...");
  console.log(`Configuration: host=${host}, port=${port}, headless=${options.headless}, poolSize=${poolSize}`);

  // Initialize browser and tab pool
  const geminiBrowser = new GeminiBrowser(options.headless);
  await geminiBrowser.initialize();

  const tabPool = new TabPool(geminiBrowser, poolSize);
  await tabPool.initialize();

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
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // List models endpoint
  app.get("/v1/models", (req: Request, res: Response) => {
    res.json({
      object: "list",
      data: MODELS,
    });
  });

  // Chat completions endpoint
  app.post("/v1/chat/completions", async (req: Request, res: Response) => {
    const requestBody: ChatCompletionRequest = req.body;

    // Validate request
    if (!requestBody.messages || !Array.isArray(requestBody.messages) || requestBody.messages.length === 0) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
        },
      });
      return;
    }

    const stream = requestBody.stream ?? false;

    try {
      if (stream) {
        // Handle streaming response
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const tab = await tabPool.acquireTab();
        try {
          const generator = await tab.sendMessageStream(requestBody.messages);

          let index = 0;
          for await (const chunk of generator) {
            const responseChunk: ChatCompletionResponse = {
              id: `chatcmpl-${Date.now()}`,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: requestBody.model || "gemini",
              choices: [
                {
                  index: index++,
                  delta: {
                    content: chunk,
                  },
                  finish_reason: null,
                },
              ],
            };

            res.write(`data: ${JSON.stringify(responseChunk)}\n\n`);
          }

          // Send final chunk
          const finalChunk: ChatCompletionResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: requestBody.model || "gemini",
            choices: [
              {
                index: index,
                delta: {},
                finish_reason: "stop",
              },
            ],
          };
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        } finally {
          tabPool.releaseTab(tab);
        }
      } else {
        // Handle non-streaming response
        const tab = await tabPool.acquireTab();
        try {
          const content = await tab.sendMessage(requestBody.messages);

          const response: ChatCompletionResponse = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: requestBody.model || "gemini",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: content,
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 0,
              completion_tokens: 0,
              total_tokens: 0,
            },
          };

          res.json(response);
        } finally {
          tabPool.releaseTab(tab);
        }
      }
    } catch (error) {
      console.error("Error processing chat completion:", error);
      res.status(500).json({
        error: {
          message: error instanceof Error ? error.message : "Internal server error",
          type: "internal_error",
        },
      });
    }
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: express.NextFunction) => {
    console.error("Express error:", err);
    res.status(500).json({
      error: {
        message: err.message || "Internal server error",
        type: "internal_error",
      },
    });
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
      await tabPool.destroy();
      await geminiBrowser.close();
      console.log("Server stopped.");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
