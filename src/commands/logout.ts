import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const SESSION_DIR = path.join(os.homedir(), ".gemini-server");
const COOKIES_FILE = path.join(SESSION_DIR, "cookies.json");

export async function logout(): Promise<void> {
  console.log("Logging out from Gemini...");

  try {
    if (fs.existsSync(COOKIES_FILE)) {
      fs.unlinkSync(COOKIES_FILE);
      console.log(`✓ Removed session cookies: ${COOKIES_FILE}`);
    } else {
      console.log("No active session found.");
    }

    // Clean up any other session files
    if (fs.existsSync(SESSION_DIR)) {
      const files = fs.readdirSync(SESSION_DIR);
      for (const file of files) {
        if (file !== "cookies.json") {
          const filePath = path.join(SESSION_DIR, file);
          fs.unlinkSync(filePath);
          console.log(`✓ Removed: ${filePath}`);
        }
      }
    }

    console.log("\n✓ Logout complete! All session data has been cleared.");
  } catch (error) {
    console.error("Error during logout:", error);
    throw error;
  }
}
