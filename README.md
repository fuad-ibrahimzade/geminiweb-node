# Gemini Playwright Server

A Node.js project with Playwright-based Gemini browser automation and OpenAI-compatible API server.

## Features

- **OpenAI-compatible API**: Drop-in replacement for OpenAI's chat completions API
- **Playwright-based automation**: Uses Playwright to interact with Gemini's web interface
- **Tab pool management**: Efficient handling of concurrent requests using a pool of browser tabs
- **Session persistence**: Saves and reuses login sessions between server restarts
- **Streaming support**: Supports both streaming and non-streaming chat completions
- **Multi-browser support**: Works with Chromium or Firefox

## Prerequisites

- Node.js 18+ and npm
- Playwright browsers installed

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd bp6rdf22

# Install dependencies
npm install

# Install Playwright browsers (see OS-specific instructions below)
npx playwright install chromium firefox

# Build the project
npm run build
```

## Usage

### 1. Login to Gemini

First, you need to authenticate with Gemini:

```bash
# Interactive login with Chromium (default)
npm run login

# Use Firefox instead (recommended on NixOS)
npm run login -- --browser firefox
```

This will open a browser window where you can log in to your Google account. The session will be saved for later use.

### 2. Start the API Server

```bash
# Start the server with Chromium
npm run serve

# Use Firefox instead (recommended on NixOS)
npm run serve -- --browser firefox

# Or with custom options
npm run serve -- --port 8080 --pool-size 5 --browser firefox
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
npm run login
npm run login -- --browser firefox    # Use Firefox (recommended on NixOS)

# Start server
npm run serve
npm run serve -- --browser firefox --port 8080 --pool-size 5

# Logout
npm run logout
```

Options:
- `-p, --port <port>` - Port to run the server on (default: 3000)
- `-h, --host <host>` - Host to bind the server to (default: localhost)
- `--headless` - Run browser in headless mode (default: true)
- `--pool-size <size>` - Number of browser tabs to maintain in pool (default: 3)
- `-b, --browser <browser>` - Browser to use: chromium or firefox (default: chromium)

## Cross-Platform Compatibility

### Installation

#### Ubuntu/Debian
```bash
npx playwright install chromium --with-deps
npx playwright install firefox
```

#### NixOS
On NixOS, Chromium may fail with "libnspr4.so" errors. Use Firefox instead:
```bash
npx playwright install firefox
```

Or use the provided script:
```bash
./install-playwright.sh
```

#### macOS
```bash
npx playwright install chromium firefox
```

#### Windows (WSL or Git Bash)
```bash
npx playwright install chromium firefox
```

### Troubleshooting

**NixOS - Missing library errors (libnspr4.so)**:
If you get errors like `libnspr4.so: cannot open shared object file`, use Firefox instead:
```bash
npm run login -- --browser firefox
npm run serve -- --browser firefox
```

Firefox works on NixOS without requiring additional system libraries.

## How It Works

1. **Login**: The `login` command opens a browser window and navigates to Gemini. After you log in manually, the session cookies are saved.

2. **Server**: The `serve` command starts an Express server with OpenAI-compatible endpoints.

3. **Tab Pool**: The server maintains a pool of browser tabs for handling concurrent requests efficiently.

4. **Request Handling**: When a chat completion request comes in:
   - A tab is acquired from the pool
   - The message is sent to Gemini via Playwright
   - The response is captured and formatted as OpenAI-compatible JSON
   - The tab is released back to the pool

## License

MIT
