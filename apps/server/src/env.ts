import { config } from "dotenv";
import { fileURLToPath } from "node:url";

// Always load the repository-root .env, even when npm -w changes cwd.
// Existing shell variables take precedence (dotenv's default behavior).
config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
