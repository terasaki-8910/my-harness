import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"], [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"], [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"], [".svg", "image/svg+xml"], [".png", "image/png"],
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".gif", "image/gif"], [".webp", "image/webp"],
  [".avif", "image/avif"], [".mp4", "video/mp4"], [".webm", "video/webm"], [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"], [".wav", "audio/wav"], [".woff", "font/woff"], [".woff2", "font/woff2"],
  [".ttf", "font/ttf"], [".otf", "font/otf"], [".txt", "text/plain; charset=utf-8"],
]);

export function mimeType(extension) {
  const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
  return TYPES.get(ext) ?? "application/octet-stream";
}

export function resolveSafe(root, urlPath) {
  if (typeof urlPath !== "string" || urlPath.includes("\0")) return null;
  let pathname;
  try {
    const rawPath = urlPath.split(/[?#]/, 1)[0];
    pathname = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (pathname.includes("\0") || pathname.includes("\\") || /^\/{2,}/.test(pathname) || /^\/?[A-Za-z]:/.test(pathname)) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((part) => part === ".." || part === ".")) return null;
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, ...segments);
  const relative = path.relative(rootPath, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return target;
}

export function parseRange(header, size) {
  if (typeof header !== "string" || !Number.isInteger(size) || size < 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start >= size) return null;
    end = match[2] === "" ? size - 1 : Number(match[2]);
    if (!Number.isSafeInteger(end) || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

export async function startServer(root, { createServer = http.createServer, stat = fs.promises.stat, createReadStream = fs.createReadStream } = {}) {
  const server = createServer(async (request, response) => {
    const file = resolveSafe(root, request.url ?? "/");
    if (!file) {
      response.writeHead(404).end("Not found");
      return;
    }
    let info;
    try {
      info = await stat(file);
    } catch {
      response.writeHead(404).end("Not found");
      return;
    }
    if (!info.isFile()) {
      response.writeHead(404).end("Not found");
      return;
    }
    const headers = { "Content-Type": mimeType(path.extname(file)), "Accept-Ranges": "bytes" };
    const range = request.headers.range ? parseRange(request.headers.range, info.size) : null;
    if (request.headers.range && !range) {
      response.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` }).end();
      return;
    }
    if (range) {
      response.writeHead(206, { ...headers, "Content-Length": range.end - range.start + 1, "Content-Range": `bytes ${range.start}-${range.end}/${info.size}` });
      createReadStream(file, range).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "Content-Length": info.size });
    createReadStream(file).pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
