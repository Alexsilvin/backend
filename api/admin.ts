import type { IncomingMessage, ServerResponse } from "http";

export default async function adminHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || "/api/admin", `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname;

  res.statusCode = 501;
  res.setHeader("Content-Type", "application/json");

  if (pathname === "/api/register-rom") {
    res.end(JSON.stringify({ error: "ROM registration not yet available on Vercel. Please use Netlify deployment." }));
    return;
  }

  if (pathname === "/api/rom-upload-url") {
    res.end(JSON.stringify({ error: "ROM upload not yet available on Vercel. Please use Netlify deployment." }));
    return;
  }

  if (pathname === "/api/enrich-posters") {
    res.end(JSON.stringify({ error: "Poster enrichment not yet available on Vercel. Please use Netlify deployment." }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "Admin endpoint not found" }));
}
