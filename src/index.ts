#!/usr/bin/env node

import { program } from "commander";
import { login } from "./commands/login";
import { serve } from "./commands/serve";
import { logout } from "./commands/logout";

program
  .name("gemini-server")
  .description("Gemini browser automation with OpenAI-compatible API")
  .version("1.0.0");

program
  .command("login")
  .description("Login to Gemini by opening browser for authentication")
  .option("-h, --headless", "Run browser in headless mode", false)
  .action(async (options) => {
    try {
      await login(options);
    } catch (error) {
      console.error("Login failed:", error);
      process.exit(1);
    }
  });

program
  .command("serve")
  .description("Start the OpenAI-compatible API server")
  .option("-p, --port <port>", "Port to run the server on", "3000")
  .option("-h, --host <host>", "Host to bind the server to", "localhost")
  .option("--headless", "Run browser in headless mode", true)
  .option("--pool-size <size>", "Number of browser tabs to maintain in pool", "3")
  .action(async (options) => {
    try {
      await serve(options);
    } catch (error) {
      console.error("Server failed to start:", error);
      process.exit(1);
    }
  });

program
  .command("logout")
  .description("Logout and clear all sessions/cookies")
  .action(async () => {
    try {
      await logout();
    } catch (error) {
      console.error("Logout failed:", error);
      process.exit(1);
    }
  });

program.parse();
