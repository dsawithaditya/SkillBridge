import handleAppRequest from "../server.js";

/**
 * Vercel rewrites /api/* to this function, which replaces req.url with the
 * function path. vercel.json passes the original sub-path as ?__path=...,
 * so restore /api/<path> before handing off to the app router.
 */
export function restoreOriginalUrl(rawUrl) {
  const url = new URL(rawUrl || "/", "http://localhost");
  const original = url.searchParams.get("__path");
  if (original === null) return rawUrl;
  url.searchParams.delete("__path");
  const query = url.searchParams.toString();
  return `/api/${original.replace(/^\/+/, "")}${query ? `?${query}` : ""}`;
}

export default function handler(req, res) {
  req.url = restoreOriginalUrl(req.url);
  return handleAppRequest(req, res);
}
