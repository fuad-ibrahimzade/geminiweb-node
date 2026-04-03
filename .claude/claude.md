# Gemini Playwright Server

## Project Overview

A Node.js project that provides an OpenAI-compatible API server using Playwright-based browser automation for Google Gemini.

## Architecture

### CLI Commands
- `login` - Opens browser for Gemini authentication, saves session cookies
- `serve` - Starts the OpenAI-compatible API server
- `logout` - Clears saved sessions

### Core Services
- **GeminiBrowser** - Manages Playwright browser instance and cookies
- **GeminiTab** - Handles individual tab operations (send messages, wait for responses)
- **TabPool** - Manages a pool of tabs for concurrent request handling

### API Endpoints
- `GET /health` - Health check
- `GET /v1/models` - List available models
- `POST /v1/chat/completions` - OpenAI-compatible chat completions

## Development Commands

```bash
npm run dev        # Run in development mode
npm run build      # Build TypeScript
npm start          # Run built version
npm run login      # Login to Gemini
npm run serve      # Start server
npm run logout     # Clear sessions
```

## Key Files

- `src/index.ts` - CLI entry point
- `src/commands/` - CLI command implementations
- `src/services/` - Core automation services
- `src/types/` - TypeScript type definitions
