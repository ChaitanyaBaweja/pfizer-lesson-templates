// Tiny zero-dependency static server for local testing.
//   npm run serve   ->   http://localhost:8765/concept.html?lesson=lists
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, sep } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = Number(process.env.PORT || 8765);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

http
  .createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
      let file = normalize(join(root, path));
      if (file !== root.replace(/[\/]$/, "") && !file.startsWith(root)) throw Object.assign(new Error("no"), { code: 403 });
      if (file.split(sep).includes("node_modules") || file.split(sep).includes("tests")) throw Object.assign(new Error("no"), { code: 404 });
      if ((await stat(file)).isDirectory()) file = join(file, "index.html");
      const body = await readFile(file);
      res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (e) {
      res.writeHead(e.code === 403 ? 403 : 404, { "content-type": "text/plain" });
      res.end("Not found");
    }
  })
  .listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/concept.html?lesson=lists`));
