import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
const projectDir = path.dirname(fileURLToPath(import.meta.url));
function beagleBridgePlugin() {
  const enabled = process.env.BEAGLEDOCK_BROWSER_BRIDGE === "1";
  const token = randomBytes(32).toString("hex");
  return {
    name: "beagledock-bridge",
    apply: "serve" as const,
    transformIndexHtml() {
      return enabled
        ? [
            {
              tag: "meta",
              attrs: { name: "beagledock-bridge-token", content: token },
              injectTo: "head" as const,
            },
          ]
        : [];
    },
    configureServer(server: any) {
      if (!enabled) return;
      const require = createRequire(import.meta.url);
      const { createBridge } = require("./electron/bridge.js");
      const { createHttpBridge } = require("./electron/http-bridge.js");
      const bridge = createBridge();
      const http = createHttpBridge({
        bridge,
        token,
        origin: "http://127.0.0.1:5173",
      });
      server.middlewares.use(http.handle);
      server.httpServer?.once("close", () => {
        http.close();
        bridge.close();
      });
    },
  };
}
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    beagleBridgePlugin(),
    {
      name: "production-csp",
      apply: "build",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: {
              "http-equiv": "Content-Security-Policy",
              content:
                "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'",
            },
            injectTo: "head-prepend",
          },
        ];
      },
    },
  ],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
  resolve: { alias: { "@": path.join(projectDir, "src") } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    allowedHosts: [],
  },
});
