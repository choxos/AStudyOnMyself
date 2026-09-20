import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, rmSync } from "node:fs";
import path from "node:path";
import { drawsPath, latestDone, latestFinished, latestRun, recentRuns, type Run, whatIf } from "./analysis.ts";
import * as auth from "./auth.ts";
import {
  ASOM_HOST, BACKUP_GPG_RECIPIENT, DATA_DIR, PORT, PUBLISH_DIR, ROOT, WEATHER_LATITUDE, WEATHER_LONGITUDE,
} from "./config.ts";
import { all, get, nowIso, run, transaction } from "./db.ts";
import type { Html } from "./html.ts";
import {
  ANON_CSRF_COOKIE, cookie, json, newAnonToken, page, redirect, type Req, type Res, Router, safeNext, SESSION_COOKIE, text, withCookie,
} from "./http.ts";
import { backupStale, lastBackup } from "./maintenance.ts";
import { notify, validateReminderTimes, vapidPublicKey } from "./push.ts";
import * as pages from "./pages.ts";
import * as stats from "./stats.ts";
import {
  addDays, CONFIRMATORY_FIELDS, DAILY_FIELDS, type DailyValue, isTimeZone, type RatingInput, studyDayAndSlot, validateDaily,
  validateRating,
} from "./study.ts";

export const router = new Router();
type Row = Record<string, unknown>;

/** Render a page for a signed-in user; a flash message is shown once. */
function show(req: Req, body: Html): Res {
  if (req.session?.flash) auth.clearFlash(req.session);
  return page(body);
}

function flashTo(req: Req, message: string, location: string): Res {
  if (req.session) auth.setFlash(req.session, message);
  return redirect(location);
}

function recentTags(userId: number, limit = 12): string[] {
  const counts = new Map<string, number>();
  const since = addDays(new Date().toISOString().slice(0, 10), -60);
  for (const { tags } of all<{ tags: string }>("SELECT tags FROM ratings WHERE user_id = ? AND study_date >= ?", userId, since)) {
    for (const tag of JSON.parse(tags) as string[]) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tag]) => tag);
}

// ---------------------------------------------------------------- ratings

const RATING_COLUMNS = "id, rating, recorded_at, time_zone, study_date, slot, note, tags, source, client_id, created_at";
const ratingJson = (row: Row) => ({ ...row, tags: JSON.parse(String(row.tags)) });

function insertRating(user: auth.User, v: RatingInput): { status: number; row: Row } {
  const timeZone = v.timeZone ?? user.time_zone;
  const { studyDate, slot } = studyDayAndSlot(v.recordedAt, timeZone, user.day_start_hour);
  try {
    const id = run(
      `INSERT INTO ratings (user_id, rating, recorded_at, time_zone, study_date, slot, note, tags, source, client_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      user.id, v.rating, v.recordedAt.toISOString(), timeZone, studyDate, slot, v.note, JSON.stringify(v.tags), v.source, v.clientId,
    ).lastInsertRowid;
    return { status: 201, row: get<Row>(`SELECT ${RATING_COLUMNS} FROM ratings WHERE id = ?`, id)! };
  } catch (error) {
    // A retried offline submission (same client_id): acknowledge the stored copy.
    if (!String(error).includes("UNIQUE constraint failed")) throw error;
    return { status: 200, row: get<Row>(`SELECT ${RATING_COLUMNS} FROM ratings WHERE user_id = ? AND client_id = ?`, user.id, v.clientId)! };
  }
}

router.add("POST", "/api/ratings/", "api-write", (req) => {
  const { value, errors } = validateRating(req.body);
  if (!value) return json(errors, 400);
  const { status, row } = insertRating(req.user!, value);
  // A device token can add data but never read it back, so it gets an acknowledgment only.
  if (req.viaDevice) return json({ id: row.id, study_date: row.study_date, slot: row.slot }, status);
  // The app shows the safety notice as soon as a report makes the rule true (protocol Section 2.11).
  return json({ ...ratingJson(row), safety: stats.safetyRuleMet(req.user!) }, status);
});

// For a page already open when it returns to the screen.
router.add("GET", "/api/safety/", "session", (req) => json({ safety: stats.safetyRuleMet(req.user!) }));

router.add("GET", "/api/ratings/", "api", (req) => {
  const since = req.query.get("since") ?? "0000-00-00";
  return json(all<Row>(`SELECT ${RATING_COLUMNS} FROM ratings WHERE user_id = ? AND study_date >= ? ORDER BY recorded_at DESC`, req.user!.id, since).map(ratingJson));
});

router.add("DELETE", "/api/ratings/:id/", "api", (req) => {
  const { changes } = run("DELETE FROM ratings WHERE id = ? AND user_id = ?", Number(req.params.id), req.user!.id);
  return changes ? { status: 204, headers: {}, body: "" } : json({ detail: "Not found." }, 404);
});

router.add("POST", "/ratings/:id/delete/", "session", (req) => {
  run("DELETE FROM ratings WHERE id = ? AND user_id = ?", Number(req.params.id), req.user!.id);
  return flashTo(req, "Report deleted.", safeNext(req.body.next));
});

router.add("GET", "/ratings/", "session", (req) => {
  const since = addDays(stats.currentStudyDay(req.user!).studyDate, -30);
  const ratings = all<pages.RatingRow>(
    "SELECT id, rating, slot, study_date, recorded_at, note, tags FROM ratings WHERE user_id = ? AND study_date >= ? ORDER BY recorded_at DESC",
    req.user!.id, since,
  );
  return show(req, pages.ratingsPage({ session: req.session!, ratings }));
});

// ---------------------------------------------------------------- daily log

const BOOL_FIELDS = new Set(DAILY_FIELDS.filter((f) => f.type === "bool").map((f) => f.name));
const dailyJson = (row: Row) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k !== "id" && k !== "user_id").map(([k, v]) => [k, BOOL_FIELDS.has(k) && v !== null ? v === 1 : v]));

/** Only the fields given change, so automatic sources and the evening form never overwrite each other. */
function upsertDaily(userId: number, date: string, values: Record<string, DailyValue>): { created: boolean; row: Row } {
  return transaction(() => {
    const created = run("INSERT INTO daily_logs (user_id, date) VALUES (?, ?) ON CONFLICT (user_id, date) DO NOTHING", userId, date).changes > 0;
    const columns = Object.keys(values); // validated field names only
    if (columns.length) {
      run(
        `UPDATE daily_logs SET ${columns.map((c) => `${c} = ?`).join(", ")}, updated_at = ? WHERE user_id = ? AND date = ?`,
        ...columns.map((c) => values[c]), nowIso(), userId, date,
      );
    }
    return { created, row: get<Row>("SELECT * FROM daily_logs WHERE user_id = ? AND date = ?", userId, date)! };
  });
}

router.add("POST", "/api/daily/", "api-write", (req) => {
  const { date, values, errors } = validateDaily(req.body);
  if (errors) return json(errors, 400);
  const { created, row } = upsertDaily(req.user!.id, date!, values!);
  // A device token gets back only what it changed, never the day's other values or notes.
  if (req.viaDevice) return json({ date, saved: Object.keys(values!) }, created ? 201 : 200);
  return json(dailyJson(row), created ? 201 : 200);
});

router.add("GET", "/api/daily/", "api", (req) => {
  const since = req.query.get("since") ?? "0000-00-00";
  return json(all<Row>("SELECT * FROM daily_logs WHERE user_id = ? AND date >= ? ORDER BY date DESC LIMIT 366", req.user!.id, since).map(dailyJson));
});

function logDay(req: Req): { day: string; today: string } {
  const today = stats.currentStudyDay(req.user!).studyDate;
  const asked = String(req.query.get("date") ?? req.body.date ?? "");
  return { day: /^\d{4}-\d{2}-\d{2}$/.test(asked) && !Number.isNaN(Date.parse(asked)) ? asked : today, today };
}

const logPage = (
  req: Req, day: string, today: string, values: Record<string, DailyValue>, original: Record<string, DailyValue>, errors: Record<string, string>,
) => pages.logPage({ session: req.session!, day, values, original, errors, previous: addDays(day, -1), next: day < today ? addDays(day, 1) : null });

router.add("GET", "/log/", "session", (req) => {
  const { day, today } = logDay(req);
  const row = get<Record<string, DailyValue>>("SELECT * FROM daily_logs WHERE user_id = ? AND date = ?", req.user!.id, day) ?? {};
  return show(req, logPage(req, day, today, row, row, {}));
});

router.add("POST", "/log/", "session", (req) => {
  const { day, today } = logDay(req);
  // The form carries each field's value as it was shown. Only fields the
  // participant changed are saved, so a value an automatic source wrote after
  // the page was opened is not replaced by the older one.
  const original: Record<string, DailyValue> = {};
  const changed: Record<string, unknown> = { date: day };
  for (const field of DAILY_FIELDS) {
    if (!(field.name in req.body)) continue;
    const shown = req.body[`shown.${field.name}`];
    original[field.name] = shown === undefined ? null : String(shown);
    if (shown === undefined || String(req.body[field.name]).trim() !== String(shown).trim()) changed[field.name] = req.body[field.name];
  }
  const { values, errors } = validateDaily(changed);
  if (errors) return show(req, logPage(req, day, today, req.body as Record<string, DailyValue>, original, errors));
  upsertDaily(req.user!.id, day, values!);
  return flashTo(req, `Saved ${day}.`, `/log/?date=${day}`);
});

// ---------------------------------------------------------------- dashboard pages

router.add("GET", "/", "session", (req) => {
  const user = req.user!;
  const { studyDate: today, slot } = stats.currentStudyDay(user);
  const latest = latestDone(user.id);
  const results = latest?.results;
  const forecast: [string, number[]][] =
    results?.forecast && results.forecast.date >= today ? Object.entries(results.forecast.slots as Record<string, number[]>) : [];
  return show(req, pages.homePage({
    session: req.session!,
    today,
    slot,
    todayRatings: all<pages.RatingRow>(
      "SELECT id, rating, slot, study_date, recorded_at, note, tags FROM ratings WHERE user_id = ? AND study_date = ? ORDER BY recorded_at", user.id, today,
    ),
    completion: stats.completion(user),
    total: stats.reportCounts(user).reports,
    ratedDays: stats.reportCounts(user).days,
    latest,
    // Confirmatory factors are judged at 6 and 12 months, so they are not headlined before.
    headline: (results?.predictors ?? [])
      .filter((p: Row) => !CONFIRMATORY_FIELDS.has(String(p.field)) && (p.evidence === "strong" || p.evidence === "moderate"))
      .slice(0, 3),
    forecast,
    // Automatic sources also create the day's row, so only the evening rating counts as logged.
    loggedToday: Boolean(get("SELECT 1 FROM daily_logs WHERE user_id = ? AND date = ? AND day_satisfaction IS NOT NULL", user.id, today)),
    recentTags: recentTags(user.id),
    safety: stats.safetyRuleMet(user),
  }));
});

router.add("GET", "/rate/", "session", (req) =>
  show(req, pages.ratePage({ session: req.session!, recentTags: recentTags(req.user!.id), safety: stats.safetyRuleMet(req.user!) })));

router.add("GET", "/trends/", "session", (req) => {
  const b = stats.breakdown(req.user!);
  const finished = latestFinished(req.user!.id);
  // Tag comparisons made under another study start than the current one are not shown.
  const current = finished?.results.data?.study_start === req.user!.study_start;
  return show(req, pages.trendsPage({
    session: req.session!, weekly: stats.weeklyShares(req.user!), adherence: stats.weeklyAdherence(req.user!),
    prompted: stats.promptedReports(req.user!), completeness: stats.completeness(req.user!),
    total: b.total, bySlot: b.bySlot, byWeekday: b.byWeekday,
    tags: current ? finished?.results.tags ?? [] : [], tagsAsOf: current ? finished?.finished_at?.slice(0, 16).replace("T", " ") ?? null : null,
  }));
});

const BINARY_FIELDS = new Set(["work_day", "travel", "sick"]);
const UNIT_HINTS: Record<string, string> = {
  sleep_hours: "hours", sleep_efficiency: "%", hrv_ms: "ms", resting_hr: "bpm", skin_temp_dev_c: "°C", steps: "steps",
  exercise_min: "min", outdoor_min: "min", social_min: "min", screen_time_min: "min", social_media_min: "min",
  caffeine_mg: "mg", alcohol_units: "drinks", temp_mean_c: "°C", precipitation_mm: "mm", sunshine_hours: "hours",
  daylight_hours: "hours", pm25: "µg/m³",
};

function chartData(r: Run["results"]) {
  const tone = (p: Row) => (p.evidence === "strong" || p.evidence === "moderate" ? (p.direction === "better" ? "pos" : "neg") : "neutral");
  const levels = (rows: Row[], label: (s: string) => string) =>
    rows.map((t) => {
      const p = t.p_happy as Record<string, number>;
      return { label: label(String(t.level)), tone: "pos", est: p.est * 100, lo: p.lo * 100, hi: p.hi * 100 };
    });
  return {
    effects: (r.predictors as Row[]).map((p) => ({ label: p.label, detail: p.unit_label, tone: tone(p), ...(p.d_happy_pp as Row) })),
    time_of_day: levels(r.time_of_day, (s) => s.charAt(0).toUpperCase() + s.slice(1)),
    weekday: levels(r.weekday, (s) => s),
    daily: r.daily_mood
      ? Object.fromEntries(Object.entries(r.daily_mood as Record<string, unknown[]>).map(([k, v]) => [k, v.slice(-180)]))
      : null,
  };
}

router.add("GET", "/analysis/", "session", (req) => {
  const user = req.user!;
  const latest = latestDone(user.id);
  const predictors: Row[] = latest?.results.predictors ?? [];
  const values = Object.fromEntries(predictors.map((p) => [String(p.field), (req.query.get(String(p.field)) ?? "").trim()]));
  const weekday = Math.min(Math.max(Number(req.query.get("weekday") ?? 0) || 0, 0), 6);
  let result: [string, number[]][] | null = null;
  let error = "";
  if (latest && req.query.has("whatif")) {
    try {
      result = Object.entries(whatIf(latest.id, values, weekday));
    } catch (e) {
      error = (e as Error).message;
    }
  }
  return show(req, pages.analysisPage({
    session: req.session!,
    latestAny: latestRun(user.id),
    latest,
    waiting: req.query.has("waiting"),
    charts: latest ? chartData(latest.results) : null,
    history: recentRuns(user.id),
    whatIfFields: predictors.map((p) => ({
      field: String(p.field), label: String(p.label), mean: Number(p.mean), value: values[String(p.field)],
      binary: BINARY_FIELDS.has(String(p.field)), unit: UNIT_HINTS[String(p.field)] ?? "",
    })),
    whatIfWeekday: weekday,
    whatIf: result,
    error,
  }));
});

router.add("POST", "/analysis/refit/", "session", (req) => {
  if (latestRun(req.user!.id)?.status === "running") return flashTo(req, "A refit is already running.", "/analysis/");
  mkdirSync(path.join(DATA_DIR, "logs"), { recursive: true });
  const log = openSync(path.join(DATA_DIR, "logs", "refit.log"), "a");
  spawn(process.execPath, [path.join(ROOT, "scripts", "cli.ts"), "refit", "--user", String(req.user!.id)], {
    detached: true, stdio: ["ignore", log, log], env: process.env,
  }).unref();
  closeSync(log); // the child keeps its own copy
  return redirect("/analysis/?waiting");
});

router.add("GET", "/analysis/status/", "api", (req) => {
  const latest = latestRun(req.user!.id);
  return json({ id: latest?.id ?? 0, status: latest?.status ?? null });
});

// ---------------------------------------------------------------- settings and data

const timeZones = (): string[] => Intl.supportedValuesOf("timeZone");

function settings(req: Req, errors: Record<string, string> = {}, newToken: string | null = null): Res {
  const user = req.user!;
  const reminders = get<{ reminder_times: string; reminders_on: number }>("SELECT reminder_times, reminders_on FROM users WHERE id = ?", user.id)!;
  return show(req, pages.settingsPage({
    reminderTimes: JSON.parse(reminders.reminder_times) as string[], remindersOn: reminders.reminders_on === 1,
    pushDevices: get<{ n: number }>("SELECT count(*) AS n FROM push_subscriptions WHERE user_id = ?", user.id)!.n,
    session: req.session!, timeZones: [...new Set([...timeZones(), user.time_zone])].sort(), errors, newToken,
    apiBase: ASOM_HOST ? `https://${ASOM_HOST}` : `http://127.0.0.1:${PORT}`, host: ASOM_HOST,
    tokens: all("SELECT id, name, created_at, last_used_at FROM device_tokens WHERE user_id = ? ORDER BY id DESC", user.id),
    weatherOn: Boolean(WEATHER_LATITUDE && WEATHER_LONGITUDE), backupOn: Boolean(BACKUP_GPG_RECIPIENT), lastBackup: lastBackup(), backupStale: backupStale(),
    publishOn: Boolean(PUBLISH_DIR), dataDir: DATA_DIR,
  }));
}

router.add("GET", "/settings/", "session", (req) => settings(req));

router.add("POST", "/settings/", "session", (req) => {
  const user = req.user!;
  if (req.body.action === "reminders") {
    const { times, error } = validateReminderTimes([req.body.reminder_morning, req.body.reminder_afternoon, req.body.reminder_evening]);
    if (!times) return settings(req, { reminders: error! });
    run("UPDATE users SET reminder_times = ?, reminders_on = ? WHERE id = ?", JSON.stringify(times), req.body.reminders_on ? 1 : 0, user.id);
    return flashTo(req, "Reminders saved.", "/settings/");
  }
  if (req.body.action === "token") {
    const name = String(req.body.name ?? "").trim();
    if (!name || name.length > 50) return settings(req, { name: "Give the device a name (up to 50 characters)." });
    // Shown once in this response; only its hash is stored.
    return settings(req, {}, auth.issueDeviceToken(user.id, name));
  }
  const errors: Record<string, string> = {};
  const timeZone = String(req.body.time_zone ?? "");
  const dayStart = Number(req.body.day_start_hour);
  const studyStart = String(req.body.study_start ?? "");
  if (!isTimeZone(timeZone)) errors.time_zone = "Unknown time zone.";
  if (!Number.isInteger(dayStart) || dayStart < 0 || dayStart > 11) errors.day_start_hour = "A whole hour from 0 to 11.";
  if (studyStart && !/^\d{4}-\d{2}-\d{2}$/.test(studyStart)) errors.study_start = "Use YYYY-MM-DD.";
  if (Object.keys(errors).length) return settings(req, errors);
  run("UPDATE users SET time_zone = ?, day_start_hour = ?, study_start = ? WHERE id = ?", timeZone, dayStart, studyStart || null, user.id);
  return flashTo(req, "Settings saved.", "/settings/");
});

router.add("POST", "/settings/tokens/:id/revoke/", "session", (req) => {
  run("DELETE FROM device_tokens WHERE id = ? AND user_id = ?", Number(req.params.id), req.user!.id);
  return flashTo(req, "Device token revoked.", "/settings/");
});

router.add("POST", "/settings/delete-all/", "session", (req) => {
  if (req.body.confirm !== "DELETE") return flashTo(req, "Type DELETE to confirm. Nothing was deleted.", "/settings/");
  const userId = req.user!.id;
  for (const { id } of all<{ id: number }>("SELECT id FROM analysis_runs WHERE user_id = ?", userId)) rmSync(drawsPath(id), { force: true });
  transaction(() => {
    for (const table of ["analysis_runs", "ratings", "daily_logs", "air_readings"]) run(`DELETE FROM ${table} WHERE user_id = ?`, userId);
  });
  return flashTo(req, "All reports, daily logs, indoor air readings and analyses were deleted. Encrypted backups were kept.", "/settings/");
});

const csvCell = (value: unknown): string => {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: unknown[][]): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

router.add("GET", "/export/:kind", "session", (req) => {
  const userId = req.user!.id;
  const ratings = all<Row>(`SELECT ${RATING_COLUMNS} FROM ratings WHERE user_id = ? ORDER BY recorded_at`, userId);
  const logs = all<Row>("SELECT * FROM daily_logs WHERE user_id = ? ORDER BY date", userId);
  let res: Res;
  if (req.params.kind === "all.json") {
    const air = all<Row>("SELECT measured_at, metric, value FROM air_readings WHERE user_id = ? ORDER BY measured_at, metric", userId);
    res = text(JSON.stringify({ ratings: ratings.map(ratingJson), daily: logs.map(dailyJson), air_readings: air }, null, 1), 200, "application/json");
  } else if (req.params.kind === "ratings.csv") {
    const header = ["recorded_at", "study_date", "slot", "rating", "mood", "note", "tags", "source", "time_zone"];
    res = text(csv([header, ...ratings.map((r) => [
      r.recorded_at, r.study_date, r.slot, r.rating, ["Sad", "Meh", "Happy"][Number(r.rating) - 1], r.note,
      (JSON.parse(String(r.tags)) as string[]).join(" "), r.source, r.time_zone,
    ])]), 200, "text/csv; charset=utf-8");
  } else if (req.params.kind === "daily.csv") {
    const names = DAILY_FIELDS.map((f) => f.name);
    res = text(csv([["date", ...names], ...logs.map((l) => [l.date, ...names.map((n) => l[n])])]), 200, "text/csv; charset=utf-8");
  } else {
    return text("Not found.", 404);
  }
  res.headers["content-disposition"] = `attachment; filename="astudyonmyself-${req.params.kind}"`;
  return res;
});

// ---------------------------------------------------------------- push reminders

router.add("GET", "/push/key/", "api", () => json({ key: vapidPublicKey() }));

/** A subscription from the browser's push manager: an https endpoint and its keys. */
function pushSubscription(body: Record<string, unknown>): { endpoint: string; p256dh: string; auth: string } | null {
  const endpoint = String(body.endpoint ?? "");
  const keys = (body.keys ?? {}) as Record<string, unknown>;
  const p256dh = String(keys.p256dh ?? "");
  const auth = String(keys.auth ?? "");
  try {
    if (new URL(endpoint).protocol !== "https:" || endpoint.length > 1000) return null;
  } catch {
    return null;
  }
  if (Buffer.from(p256dh, "base64url").length !== 65 || Buffer.from(auth, "base64url").length !== 16) return null;
  return { endpoint, p256dh, auth };
}

router.add("POST", "/push/subscribe/", "api", (req) => {
  const sub = pushSubscription(req.body);
  if (!sub) return json({ detail: "Not a valid push subscription." }, 400);
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    req.user!.id, sub.endpoint, sub.p256dh, sub.auth,
  );
  return json({ saved: true }, 201);
});

router.add("POST", "/push/unsubscribe/", "api", (req) => {
  run("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", req.user!.id, String(req.body.endpoint ?? ""));
  return json({ saved: true });
});

router.add("POST", "/push/test/", "api", async (req) => {
  const statuses = await notify(req.user!.id, { title: "A Study On Myself", body: "Test: reminders reach this device.", url: "/rate/" });
  return json({ statuses });
});

// A fresh CSRF token for the offline queue after the page was served from cache.
router.add("GET", "/csrf/", "api", (req) => (req.session ? json({ token: req.session.csrf }) : json({ detail: "Sign in first." }, 403)));

// ---------------------------------------------------------------- accounts

router.add("GET", "/accounts/login/", "public", (req) => {
  if (req.session) return redirect("/");
  const token = req.cookies[ANON_CSRF_COOKIE] || newAnonToken();
  const res = page(pages.loginPage({ csrf: token, next: safeNext(req.query.get("next")), error: "" }));
  return withCookie(res, cookie(ANON_CSRF_COOKIE, token, 3600 * 24, "Strict"));
});

router.add("POST", "/accounts/login/", "public", async (req) => {
  const token = req.cookies[ANON_CSRF_COOKIE];
  const next = safeNext(req.body.next);
  if (auth.loginLocked()) return text("Too many failed sign-in attempts. Try again in 15 minutes.", 429);
  const user = await auth.authenticate(String(req.body.username ?? ""), String(req.body.password ?? ""));
  if (!user) {
    auth.recordLoginFailure();
    return page(pages.loginPage({ csrf: token, next, error: "That username and password did not match." }), 200);
  }
  const { cookie: sessionId } = auth.startSession(user.id);
  return withCookie(redirect(next), cookie(SESSION_COOKIE, sessionId, auth.SESSION_DAYS * 24 * 3600));
});

router.add("POST", "/accounts/logout/", "session", (req) => {
  auth.endSession(req.session!);
  return withCookie(redirect("/accounts/login/"), cookie(SESSION_COOKIE, "", 0));
});

router.add("GET", "/accounts/password/", "session", (req) => show(req, pages.passwordPage({ session: req.session!, errors: {} })));

router.add("POST", "/accounts/password/", "session", async (req) => {
  const user = req.user!;
  const stored = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id)!;
  if (!(await auth.verifyPassword(String(req.body.old ?? ""), stored.password_hash))) {
    return show(req, pages.passwordPage({ session: req.session!, errors: { old: "That is not your current password." } }));
  }
  try {
    await auth.setPassword(user.id, String(req.body.new ?? ""));
  } catch (e) {
    return show(req, pages.passwordPage({ session: req.session!, errors: { new: (e as Error).message } }));
  }
  // Sign out every other session.
  run("DELETE FROM sessions WHERE user_id = ? AND id_hash != ?", user.id, req.session!.idHash);
  return flashTo(req, "Password changed.", "/settings/");
});
