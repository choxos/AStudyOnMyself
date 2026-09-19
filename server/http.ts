// Request handling: routing, authentication, CSRF, body parsing, static files
// and security headers. No framework; everything the app does is visible here.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { deviceUser, loadSession, type Session, type User } from "./auth.ts";
import { ALLOWED_HOSTS, ROOT, SECURE_COOKIES } from "./config.ts";
import type { Html } from "./html.ts";

export const SESSION_COOKIE = "asom_session";
export const ANON_CSRF_COOKIE = "asom_csrf";
const MAX_BODY = 64 * 1024;

/**
 * public: anyone; session: signed-in pages (redirect to login otherwise);
 * api: JSON for a signed-in session; api-write: JSON that a device token may POST to.
 */
export type Access = "public" | "session" | "api" | "api-write";

export interface Req {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: IncomingMessage["headers"];
  cookies: Record<string, string>;
  params: Record<string, string>;
  body: Record<string, unknown>;
  session: Session | null;
  user: User | null;
  viaDevice: boolean;
}

export interface Res {
  status: number;
  headers: Record<string, string | string[]>;
  body: string | Buffer;
}

export type Handler = (req: Req) => Res | Promise<Res>;

export const page = (body: Html | string, status = 200): Res => ({
  status, headers: { "content-type": "text/html; charset=utf-8" }, body: String(body),
});
export const json = (data: unknown, status = 200): Res => ({
  status, headers: { "content-type": "application/json" }, body: JSON.stringify(data),
});
export const text = (body: string, status = 200, type = "text/plain; charset=utf-8"): Res => ({
  status, headers: { "content-type": type }, body,
});
export const redirect = (location: string): Res => ({ status: 303, headers: { location }, body: "" });

export function cookie(name: string, value: string, maxAgeSeconds: number, sameSite = "Lax"): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${SECURE_COOKIES ? "; Secure" : ""}`;
}

export function withCookie(res: Res, setCookie: string): Res {
  const existing = res.headers["set-cookie"];
  res.headers["set-cookie"] = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), setCookie];
  return res;
}

/** Only same-site paths, so ?next= can never send someone to another site. */
export const safeNext = (next: unknown, fallback = "/"): string =>
  typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : fallback;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  access: Access;
  handler: Handler;
}

export class Router {
  routes: Route[] = [];

  add(method: string, pathPattern: string, access: Access, handler: Handler): void {
    const keys: string[] = [];
    const source = pathPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return "([^/]+)";
    });
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, access, handler });
  }

  match(method: string, urlPath: string): { route?: Route; params: Record<string, string>; pathExists: boolean } {
    let pathExists = false;
    for (const route of this.routes) {
      const m = route.pattern.exec(urlPath);
      if (!m) continue;
      pathExists = true;
      if (route.method === method || (method === "HEAD" && route.method === "GET")) {
        // urlPath is already decoded; decoding parameters again would double-decode.
        return { route, params: Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]])), pathExists };
      }
    }
    return { params: {}, pathExists };
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sameToken(a: unknown, b: string | undefined): boolean {
  if (typeof a !== "string" || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type BodyResult = { ok: true; body: Record<string, unknown> } | { ok: false; res: Res };

async function readBody(raw: IncomingMessage): Promise<BodyResult> {
  const fail = (message: string, status: number): BodyResult => ({ ok: false, res: text(message, status) });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of raw) {
    size += chunk.length;
    if (size > MAX_BODY) return fail("Request too large.", 413);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body) return { ok: true, body: {} };
  const type = (raw.headers["content-type"] ?? "").split(";")[0].trim();
  if (type === "application/json") {
    try {
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { ok: true, body: parsed as Record<string, unknown> };
      return fail("Expected a JSON object.", 400);
    } catch {
      return fail("Malformed JSON.", 400);
    }
  }
  if (type === "application/x-www-form-urlencoded") return { ok: true, body: Object.fromEntries(new URLSearchParams(body)) };
  return fail("Unsupported content type.", 415);
}

const STATIC_ROOT = path.join(ROOT, "static");
const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(relative: string): Res {
  const file = path.resolve(STATIC_ROOT, relative);
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(STATIC_ROOT + path.sep) || !type || !existsSync(file) || !statSync(file).isFile()) {
    return text("Not found", 404);
  }
  return { status: 200, headers: { "content-type": type, "cache-control": "no-cache" }, body: readFileSync(file) };
}

const isApi = (access: Access) => access === "api" || access === "api-write";

async function dispatch(router: Router, raw: IncomingMessage): Promise<Res> {
  const host = (raw.headers.host ?? "").replace(/:\d+$/, "");
  if (!ALLOWED_HOSTS.has(host)) return text("Unknown host.", 400);
  const method = raw.method ?? "GET";
  const url = new URL(raw.url ?? "/", "http://localhost");
  let urlPath: string;
  try {
    urlPath = decodeURIComponent(url.pathname);
  } catch {
    return text("Bad path.", 400);
  }
  if (method === "GET" || method === "HEAD") {
    if (urlPath.startsWith("/static/")) return serveStatic(urlPath.slice("/static/".length));
    // The service worker must be served from the root to control the whole site.
    if (urlPath === "/sw.js" || urlPath === "/manifest.webmanifest") return serveStatic(urlPath.slice(1));
  }

  const { route, params, pathExists } = router.match(method, urlPath);
  if (!route) return pathExists ? text("Method not allowed.", 405) : text("Not found.", 404);

  const cookies = parseCookies(raw.headers.cookie);
  const session = loadSession(cookies[SESSION_COOKIE]);
  let user = session?.user ?? null;
  let viaDevice = false;

  const authorization = raw.headers.authorization ?? "";
  if (/^bearer /i.test(authorization)) {
    // A lost phone token can add data but never read the history.
    if (route.access !== "api-write" || method !== "POST") return json({ detail: "Device tokens can only add data." }, 403);
    const tokenUser = deviceUser(authorization.slice(7).trim());
    if (!tokenUser) return { ...json({ detail: "Invalid token." }, 401), headers: { "content-type": "application/json", "www-authenticate": "Bearer" } };
    user = tokenUser;
    viaDevice = true;
  }

  if (route.access === "session" && !session) {
    return redirect(`/accounts/login/?next=${encodeURIComponent(urlPath + url.search)}`);
  }
  if (isApi(route.access) && !user) return json({ detail: "Sign in first." }, 403);

  let body: Record<string, unknown> = {};
  if (method !== "GET" && method !== "HEAD") {
    const parsed = await readBody(raw);
    if (!parsed.ok) return parsed.res;
    body = parsed.body;
    if (!viaDevice) {
      // Browsers label cross-site requests; refuse them outright.
      const site = raw.headers["sec-fetch-site"];
      const crossSite = site !== undefined && site !== "same-origin" && site !== "none";
      const expected = session ? session.csrf : cookies[ANON_CSRF_COOKIE];
      if (crossSite || !sameToken(raw.headers["x-csrftoken"] ?? body.csrf, expected)) {
        return isApi(route.access) ? json({ detail: "CSRF check failed." }, 403) : text("Security check failed. Go back, reload the page and try again.", 403);
      }
    }
  }

  return route.handler({ method, path: urlPath, query: url.searchParams, headers: raw.headers, cookies, params, body, session, user, viaDevice });
}

// Everything is served from this origin: no CDNs, no inline scripts.
const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
    "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join("; "),
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

export function createHandler(router: Router) {
  return async (raw: IncomingMessage, res: ServerResponse): Promise<void> => {
    let out: Res;
    try {
      out = await dispatch(router, raw);
    } catch (error) {
      console.error(new Date().toISOString(), raw.method, raw.url, error);
      out = text("Something went wrong.", 500);
    }
    // Pages with personal data must never sit in shared or browser caches.
    const headers = { ...SECURITY_HEADERS, "cache-control": "no-store", ...out.headers };
    const body = typeof out.body === "string" ? Buffer.from(out.body) : out.body;
    res.writeHead(out.status, { ...headers, "content-length": String(body.length) });
    res.end(raw.method === "HEAD" ? undefined : body);
  };
}

export const newAnonToken = (): string => randomBytes(32).toString("base64url");
