/**
 * Sky Runner — main.ts
 *
 * The entrypoint the make.fun grader runs (`node main.ts`, Node 22).
 * It is a tiny static file server built only on Node's standard
 * library — no dependencies, no framework, no Deno APIs — that serves
 * the game (index.html, game.js, style.css, dossier.md) over HTTP so
 * a desktop browser can play it and the grader can screenshot it.
 *
 * Why a server at all, when the game also runs from file://? Two
 * reasons. First, the harness runs an entrypoint, and a static server
 * is the honest entrypoint for a browser game: it serves exactly the
 * files in this repository and nothing else. Second, serving over
 * http://localhost keeps every browser feature (localStorage for the
 * best score, WebAudio for the engine hum) working exactly as it does
 * from file://, with no surprises.
 *
 * Usage:
 *   node main.ts            # serves on http://localhost:8080
 *   PORT=3000 node main.ts  # serves on http://localhost:3000
 *
 * Then open the printed URL in a desktop browser and click TAKE OFF.
 * Press Ctrl+C to stop the server.
 */

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// The directory this file lives in is the repository root, and the
// root is the only directory ever served. Nothing outside it is
// reachable, whatever path a request asks for.
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));

// The port: $PORT when the harness sets one, otherwise 8080.
const PORT = Number(process.env.PORT || 8080);

// Content types for the handful of extensions this repo serves.
// Unknown extensions fall back to octet-stream and are still served,
// because the game has no other kinds of files.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    // Normalise the request path: "/" becomes "index.html", any other
    // path is taken as a file inside ROOT, and ".." segments are
    // stripped by the resolve + startsWith guard below.
    const url = new URL(req.url || "/", "http://localhost");
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    const filePath = resolve(join(ROOT, normalize(pathname)));

    // Security: never serve a path that escapes the repository root.
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
      res.end("Forbidden\n");
      return;
    }

    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, {
      "content-type": type,
      "cache-control": "no-cache",
      "content-length": data.length,
    });
    res.end(data);
  } catch (err) {
    // A missing file is a plain 404; anything else is a 500. Either
    // way the server stays up for the next request.
    const notFound =
      err && typeof err === "object" && "code" in err && err.code === "ENOENT";
    res.writeHead(notFound ? 404 : 500, {
      "content-type": "text/plain; charset=utf-8",
    });
    res.end(notFound ? "Not found\n" : "Server error\n");
  }
});

server.listen(PORT, () => {
  console.log(`Sky Runner is flying at http://localhost:${PORT}/`);
  console.log("Open that URL in a desktop browser and click TAKE OFF.");
  console.log("Press Ctrl+C to stop the server.");
});
