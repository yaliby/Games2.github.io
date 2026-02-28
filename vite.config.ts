import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const CROSSY_ROUTE_PREFIX = "/expo-crossy-road";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".obj": "text/plain; charset=utf-8",
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function crossyStaticDevPlugin(): Plugin {
  const crossyPublicDir = path.resolve(process.cwd(), "public", "expo-crossy-road");

  return {
    name: "crossy-static-dev",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const rawUrl = req.url ?? "";
        const [pathname] = rawUrl.split("?");
        if (!pathname.startsWith(CROSSY_ROUTE_PREFIX)) {
          next();
          return;
        }

        let relativePath = pathname.slice(CROSSY_ROUTE_PREFIX.length).replace(/^\/+/, "");
        if (!relativePath) {
          relativePath = "index.html";
        }

        const resolvedPath = path.resolve(crossyPublicDir, relativePath);
        if (!resolvedPath.startsWith(crossyPublicDir)) {
          res.statusCode = 403;
          res.end("Forbidden");
          return;
        }

        if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
          res.statusCode = 404;
          res.end("Not Found");
          return;
        }

        res.setHeader("Content-Type", getContentType(resolvedPath));
        if (relativePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store");
        }

        fs.createReadStream(resolvedPath).pipe(res);
      });
    },
  };
}

// https://vite.dev/config/
// For GitHub Pages: if repo is username.github.io, use '/'
// If repo is any other name, use '/repo-name/'
// IMPORTANT: Set this to match your GitHub Pages URL path
// If your site is at: yaliby.github.io/Games2.github.io/
// Then set BASE_PATH to '/Games2.github.io/'
// If your site is at: yaliby.github.io/ (root), set to '/'
// If your site is at: yaliby.github.io/repo-name/, set to '/repo-name/'

export default defineConfig({
  plugins: [crossyStaticDevPlugin(), react()],
  base: "/",
});

