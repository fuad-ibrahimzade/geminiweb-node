# Project Memory

## Current Implementation

- Node.js project with TypeScript
- Playwright for browser automation
- Express.js for API server
- Commander.js for CLI
- Tab pool for concurrent request handling

## Patterns Used

- Session persistence via cookies stored in ~/.gemini-server/
- OpenAI-compatible API format (v1/chat/completions)
- Stream and non-stream response support
- Tab pool pattern for managing concurrent requests

## Dependencies

- playwright
- express
- commander
- dotenv
- typescript/ts-node/tsx for dev

## Notes

- Browser runs with --disable-blink-features=AutomationControlled to avoid detection
- User agent mimics real Chrome on Mac
- Pool maintenance refreshes idle tabs every 30 seconds
