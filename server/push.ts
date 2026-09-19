// Reminder notifications by web push, with node:crypto only: delivery as in
// RFC 8030, the payload encrypted as in RFC 8291 (aes128gcm), and the server
// identified by a VAPID key (RFC 8292). The phone's browser gives the app a push
// endpoint; a reminder is an encrypted message posted to it. On an iPhone this
// needs iOS 16.4 or later and the app opened from the Home Screen.
//
// A reminder goes out once per slot, at the participant's time for that slot,
// and only while the slot has no report. The Mac must be awake to send it.
import { createCipheriv, createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, type KeyObject, randomBytes, sign } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, PUSH_CONTACT } from "./config.ts";
import { all, get, nowIso, run } from "./db.ts";
import { SLOTS, type Slot, studyDayAndSlot } from "./study.ts";

// Each slot's window in minutes from midnight; the evening runs past midnight
// until the study day starts. A reminder time must fall inside its slot.
const SLOT_RANGES: Record<Slot, [number, number]> = { morning: [4 * 60, 12 * 60], afternoon: [12 * 60, 18 * 60], evening: [18 * 60, 28 * 60] };

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Three HH:MM times, one inside each slot, or an error message. */
export function validateReminderTimes(times: unknown[]): { times?: string[]; error?: string } {
  if (times.length !== 3 || !times.every((t) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    return { error: "Give three times as HH:MM." };
  }
  for (const [k, slot] of SLOTS.entries()) {
    let m = minutes(times[k] as string);
    if (slot === "evening" && m < 4 * 60) m += 24 * 60;
    const [from, to] = SLOT_RANGES[slot];
    if (m < from || m >= to) return { error: `The ${slot} time must fall in the ${slot} slot.` };
  }
  return { times: times as string[] };
}

// ---------------------------------------------------------------- keys

interface Vapid {
  privateKey: KeyObject;
  publicKey: Buffer; // uncompressed P-256 point, 65 bytes
}

let vapid: Vapid | null = null;

/** The server's VAPID key pair, created once and kept in the private data folder. */
export function vapidKeys(): Vapid {
  if (vapid) return vapid;
  const file = path.join(DATA_DIR, "vapid.json");
  let jwk: Record<string, string>;
  if (existsSync(file)) {
    jwk = JSON.parse(readFileSync(file, "utf8"));
  } else {
    jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ format: "jwk" }) as Record<string, string>;
    writeFileSync(file, JSON.stringify(jwk), { mode: 0o600 });
  }
  const privateKey = createPrivateKey({ key: jwk, format: "jwk" });
  const pub = createPublicKey(privateKey).export({ format: "jwk" }) as Record<string, string>;
  vapid = {
    privateKey,
    publicKey: Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]),
  };
  return vapid;
}

export const vapidPublicKey = () => vapidKeys().publicKey.toString("base64url");

/** The Authorization header for one push service: a short-lived ES256 token. */
export function vapidAuthorization(endpoint: string, now = Date.now()): string {
  const { privateKey, publicKey } = vapidKeys();
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: PUSH_CONTACT })}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${signature.toString("base64url")}, k=${publicKey.toString("base64url")}`;
}

// ---------------------------------------------------------------- encryption

/**
 * RFC 8291: one record, encrypted for the subscription's key and secret. The
 * salt and the sender's key are random; tests pass the RFC's example values.
 */
export function encryptPayload(payload: Buffer, uaPublic: Buffer, authSecret: Buffer, salt = randomBytes(16), asPrivate?: Buffer): Buffer {
  const ecdh = createECDH("prime256v1");
  if (asPrivate) ecdh.setPrivateKey(asPrivate);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]), 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", key, nonce);
  // The 0x02 byte marks the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// ---------------------------------------------------------------- sending

export interface Subscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Post one encrypted message; returns the push service's status code. */
export async function sendPush(sub: Subscription, message: Record<string, string>): Promise<number> {
  const body = encryptPayload(Buffer.from(JSON.stringify(message)), Buffer.from(sub.p256dh, "base64url"), Buffer.from(sub.auth, "base64url"));
  const response = await fetch(sub.endpoint, {
    method: "POST", body: new Uint8Array(body), signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: vapidAuthorization(sub.endpoint), TTL: "3600", Urgency: "high",
      "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
    },
  });
  return response.status;
}

/** Send to every subscription of a user; drops subscriptions the push service no longer knows. */
export async function notify(userId: number, message: Record<string, string>): Promise<number[]> {
  const statuses: number[] = [];
  for (const sub of all<Subscription>("SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", userId)) {
    const status = await sendPush(sub, message).catch(() => 0);
    statuses.push(status);
    if (status === 404 || status === 410) run("DELETE FROM push_subscriptions WHERE id = ?", sub.id);
    else run("UPDATE push_subscriptions SET last_status = ? WHERE id = ?", status, sub.id);
  }
  return statuses;
}

const PROMPTS: Record<Slot, string> = {
  morning: "Morning check-in: how do you feel right now?",
  afternoon: "Afternoon check-in: how do you feel right now?",
  evening: "Evening check-in: how do you feel right now? And how was today?",
};

/**
 * Called every minute: for each participant with notifications on, remind of the
 * current slot once its time has come, unless it already has a report or a
 * reminder. Every reminder is recorded, so reports can later be told apart as
 * answering a reminder or not.
 */
export async function sendDueReminders(now = new Date()): Promise<number> {
  let sent = 0;
  const users = all<{ id: number; time_zone: string; day_start_hour: number; reminder_times: string }>(
    `SELECT DISTINCT u.id, u.time_zone, u.day_start_hour, u.reminder_times
     FROM users u JOIN push_subscriptions p ON p.user_id = u.id WHERE u.reminders_on = 1`,
  );
  for (const user of users) {
    const { studyDate, slot } = studyDayAndSlot(now, user.time_zone, user.day_start_hour);
    const due = (JSON.parse(user.reminder_times) as string[])[SLOTS.indexOf(slot)];
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: user.time_zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
    // Minutes since the study day began, so the evening slot can run past midnight.
    const sinceStart = (m: number) => (m - user.day_start_hour * 60 + 24 * 60) % (24 * 60);
    if (!due || sinceStart(minutes(clock)) < sinceStart(minutes(due))) continue;
    if (get("SELECT 1 FROM ratings WHERE user_id = ? AND study_date = ? AND slot = ?", user.id, studyDate, slot)) continue;
    const claimed = run(
      "INSERT INTO reminders (user_id, study_date, slot, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      user.id, studyDate, slot, nowIso(),
    ).changes;
    if (!claimed) continue;
    const statuses = await notify(user.id, { title: "A Study On Myself", body: PROMPTS[slot], slot, url: "/rate/" });
    const delivered = statuses.some((s) => s >= 200 && s < 300);
    run("UPDATE reminders SET delivered = ? WHERE user_id = ? AND study_date = ? AND slot = ?", delivered ? 1 : 0, user.id, studyDate, slot);
    if (delivered) sent++;
  }
  return sent;
}
