#!/usr/bin/env node
/**
 * Serves console/dist with the exact headers from vercel.json.
 *
 * The point is that the production header set - the CSP in particular - is testable before it
 * ships. A Content-Security-Policy that blocks the app's own bundle is indistinguishable from a
 * broken deploy, and it is not something you want to discover on the hosted URL.
 *
 *   node console/scripts/serve-static.mjs [port]
 */
import {createReadStream, existsSync, readFileSync, statSync} from "node:fs";
import {createServer} from "node:http";
import {dirname, extname, join, normalize, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../dist");
const config = JSON.parse(readFileSync(resolve(here, "../../vercel.json"), "utf8"));
const port = Number(process.argv[2] ?? 4180);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".map": "application/json",
  ".svg": "image/svg+xml",
};

/** Translates vercel.json's `source` globs to the subset of matching this server needs. */
function headersFor(pathname) {
  const out = {};
  for (const rule of config.headers ?? []) {
    const pattern = "^" + rule.source.replace(/\/\(\.\*\)$/, "/.*").replace(/\/$/, "/$") + "$";
    if (!new RegExp(pattern).test(pathname)) continue;
    for (const {key, value} of rule.headers) out[key] = value;
  }
  return out;
}

createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const relative = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, relative);

  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, {"content-type": "text/plain"});
    response.end("not found");
    return;
  }

  response.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    ...headersFor(pathname),
  });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`serving console/dist with vercel.json headers on http://127.0.0.1:${port}`);
});
