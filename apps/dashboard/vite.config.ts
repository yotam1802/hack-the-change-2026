import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => {
  // Vite runs within apps/dashboard; read the existing repo-root .env.
  // Only the PUBLIC Auth0 SPA configuration values go into the browser.
  const env = loadEnv(mode, resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "");
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __WAITWATCH_PUBLIC_AUTH0__: JSON.stringify({
        domain: (env.AUTH0_DOMAIN ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
        clientId: env.AUTH0_CLIENT_ID ?? "",
        audience: env.AUTH0_AUDIENCE ?? "https://waitwatch/api",
        demoMode: env.AUTH_DEMO_MODE === "1" && mode !== "production",
      }),
    },
    server: {
      port: 5173,
      proxy: {
        "/api": "http://127.0.0.1:8787",
        "/ws": { target: "ws://127.0.0.1:8787", ws: true },
      },
    },
  };
});
