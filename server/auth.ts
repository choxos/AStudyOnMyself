import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { get, nowIso, run } from "./db.ts";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD_LENGTH = 12;
export const SESSION_DAYS = 60;

export interface User {
  id: number;
  username: string;
  time_zone: string;
  day_start_hour: number;
  study_start: string | null;
}

export interface Session {
  user: User;
  csrf: string;
  flash: string;
  idHash: string;
}

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");
const token = (): string => randomBytes(32).toString("base64url");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scryptAsync(password, Buffer.from(salt, "base64"), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(actual, expected);
}

export async function createUser(username: string, password: string, timeZone: string): Promise<number> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  const result = run(
    "INSERT INTO users (username, password_hash, time_zone) VALUES (?, ?, ?)",
    username, await hashPassword(password), timeZone,
  );
  return Number(result.lastInsertRowid);
}

export async function setPassword(userId: number, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
  run("UPDATE users SET password_hash = ? WHERE id = ?", await hashPassword(password), userId);
}

// Sessions: the cookie holds a random ID, the database only its hash.
export function startSession(userId: number): { cookie: string; csrf: string } {
  const cookie = token();
  const csrf = token();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  run("DELETE FROM sessions WHERE expires_at < ?", nowIso());
  run("INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)", sha256(cookie), userId, csrf, expires);
  return { cookie, csrf };
}

export function loadSession(cookie: string | undefined): Session | null {
  if (!cookie) return null;
  const row = get<User & { csrf_token: string; flash: string; id_hash: string }>(
    `SELECT u.id, u.username, u.time_zone, u.day_start_hour, u.study_start, s.csrf_token, s.flash, s.id_hash
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ?`,
    sha256(cookie), nowIso(),
  );
  if (!row) return null;
  const { csrf_token, flash, id_hash, ...user } = row;
  return { user, csrf: csrf_token, flash, idHash: id_hash };
}

export const endSession = (session: Session): void => void run("DELETE FROM sessions WHERE id_hash = ?", session.idHash);

export const setFlash = (session: Session, message: string): void =>
  void run("UPDATE sessions SET flash = ? WHERE id_hash = ?", message, session.idHash);

export const clearFlash = (session: Session): void => void run("UPDATE sessions SET flash = '' WHERE id_hash = ?", session.idHash);

// Device tokens for phone shortcuts: write-only, stored as a hash.
export function issueDeviceToken(userId: number, name: string): string {
  const raw = token();
  run("INSERT INTO device_tokens (user_id, name, key_hash) VALUES (?, ?, ?)", userId, name, sha256(raw));
  return raw;
}

export function deviceUser(raw: string): User | null {
  const row = get<User & { token_id: number }>(
    `SELECT u.id, u.username, u.time_zone, u.day_start_hour, u.study_start, t.id AS token_id
     FROM device_tokens t JOIN users u ON u.id = t.user_id WHERE t.key_hash = ?`,
    sha256(raw),
  );
  if (!row) return null;
  run("UPDATE device_tokens SET last_used_at = ? WHERE id = ?", nowIso(), row.token_id);
  const { token_id, ...user } = row;
  return user;
}

// One account, one process: a global in-memory counter is enough. It resets on
// restart, which only shortens a lockout.
const failures: number[] = [];
const LOCKOUT = { limit: 10, windowMs: 15 * 60 * 1000 };

export function loginLocked(now = Date.now()): boolean {
  while (failures.length && failures[0] < now - LOCKOUT.windowMs) failures.shift();
  return failures.length >= LOCKOUT.limit;
}

export const recordLoginFailure = (now = Date.now()): void => void failures.push(now);
export const resetLoginFailures = (): void => void failures.splice(0);

let dummyHash: Promise<string> | undefined;

export async function authenticate(username: string, password: string): Promise<User | null> {
  const row = get<User & { password_hash: string }>(
    "SELECT id, username, time_zone, day_start_hour, study_start, password_hash FROM users WHERE username = ?",
    username,
  );
  // Check against a dummy hash for unknown users so timing does not reveal which names exist.
  dummyHash ??= hashPassword(token());
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash));
  if (!row || !ok) return null;
  const { password_hash, ...user } = row;
  return user;
}
