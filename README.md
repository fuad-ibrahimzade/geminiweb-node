# Gemini Playwright Server

A Node.js project with Playwright-based Gemini browser automation and OpenAI-compatible API server.

## Features

- **OpenAI-compatible API**: Drop-in replacement for OpenAI's chat completions API
- **Playwright-based automation**: Uses Playwright to interact with Gemini's web interface
- **Tab pool management**: Efficient handling of concurrent requests using a pool of browser tabs
- **Session persistence**: Saves and reuses login sessions between server restarts
- **Streaming support**: Supports both streaming and non-streaming chat completions

## Prerequisites

- Node.js 18+ and npm
- Playwright browsers installed

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd gemini-playwright-server

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium

# Build the project
npm run build
```

## Usage

### 1. Login to Gemini

First, you need to authenticate with Gemini:

```bash
# Interactive login (opens browser)
npm run login

# Or with CLI
node dist/index.js login
```

This will open a browser window where you can log in to your Google account. The session will be saved for later use.

### 2. Start the API Server

```bash
# Start the server
npm run serve

# Or with custom options
node dist/index.js serve --port 8080 --pool-size 5
```

### 3. Logout (Optional)

To clear saved sessions:

```bash
npm run logout
```

## API Endpoints

The server provides OpenAI-compatible endpoints:

### Health Check
```bash
GET /health
```

### List Models
```bash
GET /v1/models
```

### Chat Completions
```bash
POST /v1/chat/completions
```

Example request:
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ]
  }'
```

### Streaming Example
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini",
    "messages": [
      {"role": "user", "content": "Tell me a story"}
    ],
    "stream": true
  }'
```

## CLI Commands

```bash
# Login
node dist/index.js login [--headless]

# Start server
node dist/index.js serve [options]
  Options:
    -p, --port <port>       Port to run the server on (default: 3000)
    -h, --host <host>       Host to bind the server to (default: localhost)
    --headless              Run browser in headless mode (default: true)
    --pool-size <size>      Number of browser tabs to maintain in pool (default: 3)

# Logout
node dist/index.js logout
```

## Environment Variables

Create a `.env` file in the project root:

```env
# Optional: Set custom session directory
GEMINI_SESSION_DIR=/path/to/sessions

# Optional: Debug mode
DEBUG=true
```

## Development

```bash
# Run in development mode
npm run dev

# Build
npm run build

# Start built version
npm start
```

## Project Structure

```
├── src/
│   ├── commands/        # CLI commands
│   │   ├── login.ts     # Login command
│   │   ├── logout.ts    # Logout command
│   │   └── serve.ts     # Serve command
│   ├── services/        # Core services
│   │   ├── gemini-browser.ts  # Browser automation
│   │   └── tab-pool.ts        # Tab pool management
│   ├── types/           # TypeScript types
│   │   └── index.ts
│   └── index.ts         # CLI entry point
├── dist/                # Compiled output
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

1. **Login**: The `login` command opens a browser window and navigates to Gemini. After you log in manually, the session cookies are saved.

2. **Server**: The `serve` command starts an Express server with OpenAI-compatible endpoints.

3. **Tab Pool**: The server maintains a pool of browser tabs for handling concurrent requests efficiently.

4. **Request Handling**: When a chat completion request comes in:
   - A tab is acquired from the pool
   - The message is sent to Gemini via Playwright
   - The response is captured and formatted as OpenAI-compatible JSON
   - The tab is released back to the pool

## Limitations

- Requires manual login initially
- Subject to Gemini's rate limits
- Web interface may change, potentially breaking selectors
- Not suitable for high-throughput production use

## License

MIT
