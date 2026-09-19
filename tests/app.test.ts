// Run with: node --test tests/
// Starts the real server on a random port with a throwaway data folder.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const dataDir = mkdtempSync(path.join(tmpdir(), "asom-test-"));
process.env.ASOM_DATA_DIR = dataDir;
process.env.ASOM_ENV_FILE = ""; // never read the real .env
process.env.ULTRAHUMAN_TOKEN = "test-token"; // requests go to a stub, below

const { startServer } = await import("../server/main.ts");
const auth = await import("../server/auth.ts");
const { all, run, migrate } = await import("../server/db.ts");
const { DatabaseSync } = await import("node:sqlite");
const { studyDayAndSlot, DAILY_FIELDS, addDays } = await import("../server/study.ts");
const { publicResults, publishTarget } = await import("../server/maintenance.ts");
const { whatIf, drawsPath, fingerprint, publishable } = await import("../server/analysis.ts");
const sources = await import("../server/sources.ts");
const { mergeDaily } = await import("../server/maintenance.ts");
const stats = await import("../server/stats.ts");
const { safetyRuleMet } = stats;
const { createDecipheriv, createECDH, createHash, createPublicKey, hkdfSync, verify } = await import("node:crypto");
const push = await import("../server/push.ts");

const server = await startServer(0);
const port = (server.address() as { port: number }).port;
const base = `http://127.0.0.1:${port}`;
const PASSWORD = "a long enough password";

class Browser {
  cookies = new Map<string, string>();
  csrf = "";

  async fetch(url: string, init: RequestInit & { form?: Record<string, string>; json?: unknown } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    let body = init.body;
    if (init.form) {
      headers.set("content-type", "application/x-www-form-urlencoded");
      body = new URLSearchParams(init.form).toString();
    }
    if (init.json !== undefined) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(init.json);
    }
    const res = await fetch(base + url, { ...init, headers, body, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [name, value] = pair.split("=");
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return res;
  }

  async login(username = "me", password = PASSWORD): Promise<Response> {
    const form = await (await this.fetch("/accounts/login/")).text();
    const token = /name="csrf" value="([^"]+)"/.exec(form)![1];
    const res = await this.fetch("/accounts/login/", { method: "POST", form: { username, password, csrf: token, next: "/" } });
    if (res.status === 303) this.csrf = /name="csrf-token" content="([^"]*)"/.exec(await (await this.fetch("/")).text())![1];
    return res;
  }

  post(url: string, data: unknown, headers: Record<string, string> = {}) {
    return this.fetch(url, { method: "POST", json: data, headers: { "x-csrftoken": this.csrf, ...headers } });
  }
}

function rawGet(pathname: string, host = "127.0.0.1"): Promise<number> {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path: pathname, headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    }).on("error", reject).end();
  });
}

let userId: number;
before(async () => {
  userId = await auth.createUser("me", PASSWORD, "America/Toronto");
});
after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("study days", () => {
  test("slots and the 4 AM day boundary", () => {
    assert.deepEqual(studyDayAndSlot(new Date("2026-03-10T13:00:00Z"), "America/Toronto"), { studyDate: "2026-03-10", slot: "morning" });
    assert.deepEqual(studyDayAndSlot(new Date("2026-03-10T17:00:00Z"), "America/Toronto"), { studyDate: "2026-03-10", slot: "afternoon" });
    assert.deepEqual(studyDayAndSlot(new Date("2026-03-11T02:00:00Z"), "America/Toronto"), { studyDate: "2026-03-10", slot: "evening" });
    // 1:30 AM in Toronto still belongs to the previous day's evening.
    assert.deepEqual(studyDayAndSlot(new Date("2026-03-11T05:30:00Z"), "America/Toronto"), { studyDate: "2026-03-10", slot: "evening" });
  });

  test("the same instant differs by time zone", () => {
    const moment = new Date("2026-03-10T20:00:00Z"); // 4 PM in Toronto, 8 PM in London
    assert.equal(studyDayAndSlot(moment, "America/Toronto").slot, "afternoon");
    assert.equal(studyDayAndSlot(moment, "Europe/London").slot, "evening");
  });

  test("the field list matches the database", () => {
    const columns = all<{ name: string }>("PRAGMA table_info(daily_logs)").map((c) => c.name);
    const data = columns.filter((c) => !["id", "user_id", "date", "updated_at"].includes(c));
    assert.deepEqual(data.sort(), DAILY_FIELDS.map((f) => f.name).sort());
  });
});

describe("access", () => {
  test("pages need a login and unknown hosts are refused", async () => {
    const res = await new Browser().fetch("/");
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), "/accounts/login/?next=%2F");
    assert.equal(await rawGet("/accounts/login/", "evil.example"), 400);
  });

  test("static files cannot escape the static folder", async () => {
    assert.equal(await rawGet("/static/%2e%2e/server/db.ts"), 404);
    assert.equal(await rawGet("/static/js/rate.js"), 200);
  });

  test("repeated failed logins lock sign in", async () => {
    auth.resetLoginFailures();
    const b = new Browser();
    assert.equal((await b.login("me", "wrong password here")).status, 200);
    for (let i = 0; i < 9; i++) await b.login("me", "wrong password here");
    assert.equal((await b.login()).status, 429);
    auth.resetLoginFailures();
  });

  test("every page renders once signed in, with security headers", async () => {
    const b = new Browser();
    assert.equal((await b.login()).status, 303);
    for (const url of ["/", "/rate/", "/ratings/", "/log/", "/trends/", "/analysis/", "/settings/", "/accounts/password/", "/sw.js", "/manifest.webmanifest"]) {
      const res = await b.fetch(url);
      assert.equal(res.status, 200, url);
      assert.match(res.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    }
  });
});

describe("mood reports", () => {
  test("CSRF protects session requests", async () => {
    const b = new Browser();
    await b.login();
    assert.equal((await b.fetch("/api/ratings/", { method: "POST", json: { rating: 3 } })).status, 403);
    assert.equal((await b.post("/api/ratings/", { rating: 3 }, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await b.post("/api/ratings/", { rating: 3 })).status, 201);
  });

  test("an offline retry is stored once, with tags and a fallback time zone", async () => {
    const b = new Browser();
    await b.login();
    const payload = { rating: 2, client_id: crypto.randomUUID(), note: "Walk with #Friends", time_zone: "Mars/Base" };
    const first = await b.post("/api/ratings/", payload);
    const second = await b.post("/api/ratings/", payload);
    assert.deepEqual([first.status, second.status], [201, 200]);
    const stored = all<{ tags: string; time_zone: string }>("SELECT tags, time_zone FROM ratings WHERE client_id = ?", payload.client_id);
    assert.equal(stored.length, 1);
    assert.deepEqual(JSON.parse(stored[0].tags), ["friends"]);
    assert.equal(stored[0].time_zone, "America/Toronto");
  });

  test("impossible times and values are rejected", async () => {
    const b = new Browser();
    await b.login();
    const now = Date.now();
    assert.equal((await b.post("/api/ratings/", { rating: 2, recorded_at: new Date(now + 3600e3).toISOString() })).status, 400);
    assert.equal((await b.post("/api/ratings/", { rating: 2, recorded_at: new Date(now - 20 * 86400e3).toISOString() })).status, 400);
    assert.equal((await b.post("/api/ratings/", { rating: 4 })).status, 400);
    assert.equal((await b.post("/api/ratings/", { rating: 2, recorded_at: new Date(now - 2 * 86400e3).toISOString() })).status, 201);
  });

  test("notes are escaped when shown", async () => {
    const b = new Browser();
    await b.login();
    await b.post("/api/ratings/", { rating: 1, note: "<script>alert(1)</script>" });
    const home = await (await b.fetch("/ratings/")).text();
    assert.ok(home.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(!home.includes("<script>alert(1)"));
  });

  test("device tokens can add data but never read it", async () => {
    const raw = auth.issueDeviceToken(userId, "iPhone");
    assert.equal(all("SELECT 1 FROM device_tokens WHERE key_hash = ?", raw).length, 0); // only the hash is stored
    const bearer = { authorization: `Bearer ${raw}` };
    const anon = new Browser();
    assert.equal((await anon.fetch("/api/ratings/", { method: "POST", json: { rating: 3 }, headers: bearer })).status, 201);
    assert.equal((await anon.fetch("/api/ratings/", { headers: bearer })).status, 403);
    assert.equal((await anon.fetch("/api/daily/", { headers: bearer })).status, 403);
    assert.equal((await anon.fetch("/api/ratings/", { method: "POST", json: { rating: 3 }, headers: { authorization: "Bearer nope" } })).status, 401);
    // A write never echoes stored values back: not the day's note, not other fields.
    run("INSERT INTO daily_logs (user_id, date, note, sleep_hours) VALUES (?, '2026-02-02', 'private note', 6.1)", userId);
    const res = await anon.fetch("/api/daily/", { method: "POST", json: { date: "2026-02-02", steps: 5000 }, headers: bearer });
    const text = await res.text();
    assert.equal(res.status, 200);
    assert.ok(!text.includes("private note") && !text.includes("6.1"), text);
    assert.deepEqual(JSON.parse(text), { date: "2026-02-02", saved: ["steps"] });
    const rating = await (await anon.fetch("/api/ratings/", { method: "POST", json: { rating: 2, note: "x" }, headers: bearer })).json();
    assert.deepEqual(Object.keys(rating).sort(), ["id", "slot", "study_date"]);
  });
});

describe("daily log", () => {
  test("partial updates merge instead of overwriting", async () => {
    const b = new Browser();
    await b.login();
    assert.equal((await b.post("/api/daily/", { date: "2026-03-10", steps: 9000 })).status, 201);
    assert.equal((await b.post("/api/daily/", { date: "2026-03-10", sleep_hours: 6.5 })).status, 200);
    const [row] = all<{ steps: number; sleep_hours: number }>("SELECT steps, sleep_hours FROM daily_logs WHERE date = '2026-03-10'");
    assert.deepEqual([row.steps, row.sleep_hours], [9000, 6.5]);
    assert.equal((await b.post("/api/daily/", { steps: 1 })).status, 400);
    assert.equal((await b.post("/api/daily/", { date: "2026-03-10", sleep_hours: 30 })).status, 400);
  });

  test("the evening form saves", async () => {
    const b = new Browser();
    await b.login();
    const res = await b.fetch("/log/", { method: "POST", form: { csrf: b.csrf, date: "2026-03-11", sleep_hours: "7.5", work_day: "1", note: "fine" } });
    assert.equal(res.status, 303);
    const [row] = all<{ sleep_hours: number; work_day: number }>("SELECT sleep_hours, work_day FROM daily_logs WHERE date = '2026-03-11'");
    assert.deepEqual([row.sleep_hours, row.work_day], [7.5, 1]);
  });

  test("the form saves only edited fields, so newer automatic values survive", async () => {
    const b = new Browser();
    await b.login();
    const page = await (await b.fetch("/log/?date=2026-03-12")).text();
    assert.ok(page.includes('name="shown.steps"'));
    // Opened with no steps; an automatic source then writes them; the participant edits only the note.
    run("INSERT INTO daily_logs (user_id, date, steps) VALUES (?, '2026-03-12', 7777)", userId);
    await b.fetch("/log/", { method: "POST", form: { csrf: b.csrf, date: "2026-03-12", steps: "", "shown.steps": "", note: "ok", "shown.note": "" } });
    const [row] = all<{ steps: number; note: string }>("SELECT steps, note FROM daily_logs WHERE date = '2026-03-12'");
    assert.deepEqual([row.steps, row.note], [7777, "ok"]);
  });

  test("weekly adherence counts only slots since the study start", () => {
    const user = { id: userId, username: "me", time_zone: "America/Toronto", day_start_hour: 4, study_start: null };
    const weeks = stats.weeklyAdherence(user);
    assert.ok(weeks.length > 0);
    for (const w of weeks) assert.ok(w.answered <= w.eligible && w.share >= 0 && w.share <= 1);
    const today = studyDayAndSlot(new Date(), "America/Toronto").studyDate;
    assert.deepEqual(stats.weeklyAdherence({ ...user, study_start: addDays(today, 3) }), []);
  });

  test("adherence counts only the slots that have begun", async () => {
    const id = await auth.createUser("clock", PASSWORD, "America/Toronto");
    const user = { id, username: "clock", time_zone: "America/Toronto", day_start_hour: 4, study_start: "2026-03-02" };
    run("INSERT INTO ratings (user_id, rating, recorded_at, time_zone, study_date, slot, client_id) VALUES (?, 3, ?, ?, ?, ?, ?)",
      id, "2026-03-02T14:00:00.000Z", "America/Toronto", "2026-03-02", "morning", crypto.randomUUID());
    // One report in the first morning of the study: 1 of 1 in the morning, 1 of 2 in the afternoon.
    const morning = new Date("2026-03-02T15:00:00Z"); // 10 AM in Toronto
    const afternoon = new Date("2026-03-02T19:00:00Z"); // 2 PM
    assert.deepEqual(stats.weeklyAdherence(user, morning), [{ week: "2026-03-02", answered: 1, eligible: 1, share: 1 }]);
    assert.equal(stats.completion(user, 14, morning), 1);
    assert.deepEqual(stats.weeklyAdherence(user, afternoon), [{ week: "2026-03-02", answered: 1, eligible: 2, share: 0.5 }]);
    assert.equal(stats.completion(user, 14, afternoon), 0.5);
  });

  test("exports escape CSV and deleting needs confirmation", async () => {
    const b = new Browser();
    await b.login();
    await b.post("/api/ratings/", { rating: 3, note: 'said "hi", then left' });
    const csv = await (await b.fetch("/export/ratings.csv")).text();
    assert.ok(csv.startsWith("recorded_at,study_date,slot,rating,mood,note"));
    assert.ok(csv.includes('"said ""hi"", then left"'));
    await b.fetch("/settings/delete-all/", { method: "POST", form: { csrf: b.csrf, confirm: "nope" } });
    assert.ok(all("SELECT 1 FROM ratings WHERE user_id = ?", userId).length > 0);
  });
});

describe("database", () => {
  test("an older database gains the columns added since", () => {
    const old = new DatabaseSync(":memory:");
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      time_zone TEXT NOT NULL, day_start_hour INTEGER NOT NULL DEFAULT 4, created_at TEXT NOT NULL DEFAULT '')`);
    old.exec("INSERT INTO users (username, password_hash, time_zone) VALUES ('before', 'x', 'UTC')");
    migrate(old);
    migrate(old); // a second run changes nothing
    const columns = (old.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
    for (const column of ["study_start", "reminder_times", "reminders_on"]) assert.ok(columns.includes(column), column);
    assert.deepEqual({ ...old.prepare("SELECT username, study_start, reminders_on FROM users").get() }, { username: "before", study_start: null, reminders_on: 1 });
    old.close();
  });
});

describe("analysis output", () => {
  test("a changed study start forces a refit and keeps the older fit unpublished", () => {
    const before = fingerprint(userId);
    const fit = { user_id: userId, results: { diagnostics: { converged: true }, data: { study_start: "2026-01-01" } } } as unknown as Parameters<typeof publishable>[0];
    try {
      assert.equal(publishable(fit), false); // no study start set
      run("UPDATE users SET study_start = '2026-01-01' WHERE id = ?", userId);
      assert.notEqual(fingerprint(userId), before);
      assert.equal(publishable(fit), true);
      assert.equal(publishable({ ...fit!, results: { ...fit!.results, diagnostics: { converged: false } } }), false);
      // The start changes after the fit was made: the same fit can no longer be published.
      run("UPDATE users SET study_start = '2026-02-01' WHERE id = ?", userId);
      assert.equal(publishable(fit), false);
    } finally {
      run("UPDATE users SET study_start = NULL WHERE id = ?", userId);
    }
  });

  test("only whitelisted estimates are published", () => {
    const interval = { est: 1, lo: 0.5, hi: 1.5 };
    const published = publicResults({
      id: 1, user_id: 1, status: "done", started_at: "", finished_at: "2026-09-19T13:37:00Z", n_ratings: 90, n_days: 30,
      data_fingerprint: "", message: "",
      results: {
        model: { version: "v", draws: 4000 },
        data: { n_ratings: 90, counts: [30, 30, 30], first_date: "2026-01-01" },
        predictors: [{
          field: "sleep_hours", label: "Sleep", unit_label: "per hour", lag: 0, mean: 6.9, sd: 1.1, missing_pct: 5,
          odds_ratio: interval, d_happy_pp: interval, d_sad_pp: interval, p_positive: 0.9, direction: "better", evidence: "moderate",
        }],
        dropped: [],
        // Unexpected nested fields must not pass, whatever their level.
        time_of_day: [{ level: "morning", p_happy: { ...interval, note: "private note" }, daily: [0.1] }],
        weekday: [{ level: "Mon", p_happy: interval, dates: ["2026-01-01"] }],
        dynamics: { phi: { ...interval, p_positive: 0.99, series: [0.123456] }, sigma_day: interval, extra: "x" },
        daily_mood: { dates: ["2026-01-01"], mean: [0.4] }, forecast: { date: "x" }, ppc: { all: {} }, tags: [{ tag: "therapy" }],
        diagnostics: { max_rhat: 1, min_ess_bulk: 900, divergences: 0, converged: true, elpd_loo: -1 },
      },
    });
    assert.deepEqual(Object.keys(published).sort(), ["diagnostics", "dynamics", "model_version", "predictors", "sample", "time_of_day", "updated", "weekday"]);
    assert.deepEqual(Object.keys(published.predictors[0]).sort(),
      ["d_happy_pp", "d_sad_pp", "direction", "evidence", "label", "lag", "odds_ratio", "p_positive", "unit_label"]);
    const text = JSON.stringify(published);
    for (const secret of ["daily_mood", "forecast", "ppc", "counts", "first_date", "6.9", "missing_pct", "therapy", "elpd", "private note", "0.123456", "extra", "series", "dates"]) {
      assert.ok(!text.includes(secret), secret);
    }
    assert.deepEqual(published.time_of_day, [{ level: "morning", p_happy: interval }]);
    assert.deepEqual(published.dynamics, { phi: { ...interval, p_positive: 0.99 }, sigma_day: interval });
    // A confirmatory factor (sleep, H1) carries no evidence label before the planned analyses.
    assert.equal(published.predictors[0].evidence, "confirmatory");
    assert.equal(published.updated, "2026-09-19T13:00:00.000Z");
  });

  test("publishing refuses the site root", () => {
    for (const bad of ["", ".", "..", "../elsewhere"]) assert.throws(() => publishTarget("/tmp/site", bad));
    assert.equal(publishTarget("/tmp/site", "astudyonmyself").target, "/tmp/site/astudyonmyself");
  });

  test("what-if probabilities are coherent", () => {
    const S = 200;
    mkdirSync(path.dirname(drawsPath(99)), { recursive: true });
    writeFileSync(drawsPath(99), JSON.stringify({
      cutpoints: Array(S).fill([-1, 1]), time_of_day: Array(S).fill([0, 0, 0]), weekday_effect: Array(S).fill([0, 0, 0, 0, 0, 0, 0]),
      beta: Array(S).fill([0.8]), phi: Array(S).fill(0.5), sigma_day: Array(S).fill(0.5), fields: ["sleep_hours"], means: [7], sds: [1],
    }));
    const long = whatIf(99, { sleep_hours: "9" }, 0).morning;
    const short = whatIf(99, { sleep_hours: "5" }, 0).morning;
    assert.ok(Math.abs(long.reduce((a, b) => a + b, 0) - 1) < 0.01);
    assert.ok(long[2] > short[2]);
    assert.throws(() => whatIf(99, { sleep_hours: "lots" }, 0));
  });
});

describe("automatic sources", () => {
  test("Ultrahuman metrics map onto the daily log, in range only", () => {
    const entries = [
      { type: "sleep", object: { total_sleep: { minutes: 450 }, sleep_efficiency: { percentage: 91 }, temperature_deviation: { celsius: -0.23 } } },
      { type: "hrv", object: { avg: 80 } }, // the whole calendar day: not used
      { type: "avg_sleep_hrv", object: { value: 0 } }, // no reading: out of range, dropped
      { type: "night_rhr", object: { avg: 54.44 } },
      { type: "steps", object: { total: 8123 } },
    ];
    assert.deepEqual(sources.ultrahumanDay(entries, true), { sleep_hours: 7.5, sleep_efficiency: 91, skin_temp_dev_c: -0.23, resting_hr: 54.4, steps: 8123 });
    assert.equal(sources.ultrahumanDay(entries, false).steps, undefined); // today's steps are still counting
  });

  test("Ultrahuman values are filed only under the date they were returned for", async () => {
    const [{ id, time_zone }] = all<{ id: number; time_zone: string }>("SELECT id, time_zone FROM users ORDER BY id LIMIT 1");
    const today = studyDayAndSlot(new Date(), time_zone, 0).studyDate;
    const yesterday = addDays(today, -1);
    const realFetch = globalThis.fetch;
    // The service answers today's request with yesterday's metrics only.
    globalThis.fetch = (async () => Response.json({ data: { metrics: { [yesterday]: [{ type: "steps", object: { total: 4321 } }] } }, error: null })) as typeof fetch;
    try {
      assert.match(await sources.syncUltrahuman(1), new RegExp(`0 day\\(s\\) updated\\. No metrics returned for ${today}`));
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(all("SELECT 1 FROM daily_logs WHERE user_id = ? AND steps = 4321", id).length, 0);
  });

  test("Alexa sign in uses PKCE and reads the code from the returned address", () => {
    const start = sources.alexaSignInStart();
    const url = new URL(start.url);
    assert.equal(url.searchParams.get("openid.oa2.code_challenge"), createHash("sha256").update(start.verifier).digest("base64url"));
    assert.ok(url.searchParams.get("openid.oa2.client_id")!.endsWith("23413249564c5635564d32573831"));
    assert.equal(sources.authorizationCode("https://www.amazon.com/ap/maplanding?openid.oa2.authorization_code=ANabc&x=1"), "ANabc");
    assert.throws(() => sources.authorizationCode("https://www.amazon.com/ap/maplanding"));
  });

  test("air monitor sensors and readings are parsed", () => {
    const devices = { data: { endpoints: { items: [
      { legacyAppliance: { entityId: "light-1", applianceTypes: ["LIGHT"], capabilities: [] } },
      { legacyAppliance: {
        entityId: "aq-1", friendlyName: "Air monitor", applianceTypes: ["AIR_QUALITY_MONITOR"],
        capabilities: [
          { interfaceName: "Alexa.RangeController", instance: "4", resources: { friendlyNames: [{ value: { assetId: "Alexa.AirQuality.ParticulateMatter" } }] } },
          { interfaceName: "Alexa.RangeController", instance: 5, resources: { friendlyNames: [{ value: { assetId: "Alexa.AirQuality.VolatileOrganicCompounds" } }] } },
          { interfaceName: "Alexa.RangeController", instance: "6", resources: { friendlyNames: [{ "@type": "text", value: { text: "PM10" } }] } },
        ],
      } },
    ] } } };
    const [monitor, ...rest] = sources.airMonitors(devices);
    assert.equal(rest.length, 0);
    assert.deepEqual(monitor.sensors, [{ instance: "4", metric: "pm25" }, { instance: "5", metric: "voc" }]);
    const at = "2026-09-19T15:04:00.000Z";
    const state = { deviceStates: [{ entity: { entityId: "aq-1" }, capabilityStates: [
      JSON.stringify({ namespace: "Alexa.RangeController", name: "rangeValue", instance: "4", value: 7, timeOfSample: at }),
      JSON.stringify({ namespace: "Alexa.RangeController", name: "rangeValue", instance: "5", value: 120, timeOfSample: at }),
      JSON.stringify({ namespace: "Alexa.TemperatureSensor", name: "temperature", value: { value: 71.6, scale: "FAHRENHEIT" }, timeOfSample: at }),
      JSON.stringify({ namespace: "Alexa.RangeController", name: "rangeValue", instance: "9", value: 3, timeOfSample: at }),
      "not json",
    ] }] };
    assert.deepEqual(sources.airReadings(state, monitor), [
      { measuredAt: at, metric: "pm25", value: 7 },
      { measuredAt: at, metric: "voc", value: 120 },
      { measuredAt: at, metric: "temperature", value: 22 },
    ]);
  });

  test("indoor daily means need 12 sampled hours; each hour counts once", () => {
    const readings = [];
    // 2026-09-18 in Toronto: 12 hours from 08:00 local (12:00 UTC); hour 0 has two samples.
    for (let h = 0; h < 12; h++) readings.push({ measured_at: new Date(Date.UTC(2026, 8, 18, 12 + h)).toISOString(), metric: "pm25", value: 10 });
    readings.push({ measured_at: new Date(Date.UTC(2026, 8, 18, 12, 30)).toISOString(), metric: "pm25", value: 30 });
    // 2026-09-17: 11 hours only.
    for (let h = 0; h < 11; h++) readings.push({ measured_at: new Date(Date.UTC(2026, 8, 17, 12 + h)).toISOString(), metric: "voc", value: 100 });
    const means = sources.dailyAirMeans(readings, "America/Toronto");
    assert.deepEqual([...means.keys()], ["2026-09-18"]);
    assert.equal(means.get("2026-09-18")!.indoor_pm25, Math.round(((20 + 11 * 10) / 12) * 10) / 10);
  });

  test("automatic values are saved only when they change", () => {
    assert.equal(mergeDaily(userId, "2026-01-02", { indoor_pm25: 5.5 }), true);
    assert.equal(mergeDaily(userId, "2026-01-02", { indoor_pm25: 5.5 }), false);
    run("DELETE FROM daily_logs WHERE user_id = ? AND date = ?", userId, "2026-01-02");
  });

  test("the safety rule needs at least 10 reports, mostly Sad", () => {
    const user = { id: userId, username: "me", time_zone: "America/Toronto", day_start_hour: 4, study_start: null };
    const today = studyDayAndSlot(new Date(), "America/Toronto").studyDate;
    const add = (n: number) => {
      for (let i = 0; i < n; i++) {
        run("INSERT INTO ratings (user_id, rating, recorded_at, time_zone, study_date, slot, client_id) VALUES (?, 1, ?, ?, ?, 'evening', ?)",
          userId, new Date().toISOString(), "America/Toronto", today, crypto.randomUUID());
      }
    };
    const before = all<{ id: number }>("SELECT id FROM ratings WHERE user_id = ?", userId).map((r) => r.id);
    const existing = before.length;
    add(Math.max(0, 9 - existing));
    if (existing <= 9) assert.equal(safetyRuleMet(user), false);
    add(10);
    assert.equal(safetyRuleMet(user), true);
    run(`DELETE FROM ratings WHERE user_id = ? AND id NOT IN (${before.join(",") || "0"})`, userId);
  });
});

describe("safety notice", () => {
  test("the app updates the notice after every report it sends", async () => {
    await auth.createUser("calm", PASSWORD, "America/Toronto");
    const b = new Browser();
    await b.login("calm");
    assert.deepEqual(await (await b.fetch("/api/safety/")).json(), { safety: false });
    assert.ok((await (await b.fetch("/rate/")).text()).includes("data-safety hidden"));
    // Ten Sad reports from a page that stays open, the earlier ones sent later from the phone's queue.
    const answers: boolean[] = [];
    for (let k = 0; k < 10; k++) {
      const recorded_at = new Date(Date.now() - (9 - k) * 3600_000).toISOString();
      const res = await b.post("/api/ratings/", { rating: 1, recorded_at, client_id: crypto.randomUUID(), source: "web" });
      answers.push((await res.json()).safety);
    }
    assert.deepEqual(answers, [...Array(9).fill(false), true]); // the rule needs at least 10 reports
    assert.deepEqual(await (await b.fetch("/api/safety/")).json(), { safety: true });
    assert.ok(!(await (await b.fetch("/rate/")).text()).includes("data-safety hidden"));
  });
});

describe("rating page script", () => {
  test("an older safety answer never hides a newer one", async () => {
    // Run the real static/js/rate.js against a minimal page, with every request answered by hand.
    const { readFileSync } = await import("node:fs");
    const vm = await import("node:vm");
    const notice = { hidden: true };
    const store = new Map<string, string>();
    const handlers = new Map<string, () => void>();
    const requests: { url: string; answer: (body: object, status?: number) => void }[] = [];
    const page = {
      hidden: false,
      querySelector: (q: string) => (q === "[data-safety]" ? notice : q.startsWith("meta") ? { content: "token" } : null),
      addEventListener: (type: string, fn: () => void) => handlers.set(type, fn),
    };
    vm.runInNewContext(readFileSync(path.join(import.meta.dirname, "..", "static", "js", "rate.js"), "utf8"), {
      document: page,
      window: { addEventListener: (type: string, fn: () => void) => handlers.set(type, fn) },
      navigator: {},
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      crypto, Intl, JSON, Promise, Error, Boolean, setInterval: () => 0, setTimeout,
      fetch: (url: string) => new Promise((resolve) => requests.push({
        url, answer: (body, status = 200) => resolve(Response.json(body, { status })),
      })),
    });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 5));
    // The page returns to the screen: nothing is queued, so it asks for the safety state.
    handlers.get("visibilitychange")!();
    await settle();
    const stale = requests.shift()!;
    assert.equal(stale.url, "/api/safety/");
    // Before that answer arrives, a queued report crosses the threshold.
    store.set("asom-queue", JSON.stringify([{ client_id: crypto.randomUUID(), rating: 1 }]));
    handlers.get("online")!();
    await settle();
    requests.shift()!.answer({ id: 7, safety: true }, 201);
    await settle();
    assert.equal(notice.hidden, false);
    // The older answer arrives last and must not hide the notice.
    stale.answer({ safety: false });
    await settle();
    assert.equal(notice.hidden, false);
    // The newest request still decides.
    const newest = requests.shift()!;
    assert.equal(newest.url, "/api/safety/");
    newest.answer({ safety: false });
    await settle();
    assert.equal(notice.hidden, true);
  });
});

describe("push reminders", () => {
  const b64 = (s: string) => Buffer.from(s.replace(/\s/g, ""), "base64url");

  test("payload encryption matches the example in RFC 8291", () => {
    const body = push.encryptPayload(
      b64("V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24"),
      b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
      b64("BTBZMqHH6r4Tts7J_aSIgg"), b64("DGv6ra1nlYgDCS1FRnbzlw"), b64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"),
    );
    assert.equal(body.toString("base64url"),
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  test("the VAPID token is signed by the server's key for the push service's origin", () => {
    const header = push.vapidAuthorization("https://web.push.apple.com/QGuQyavXutnMH8/abc");
    const [, token, key] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    const [h, c, sig] = token.split(".");
    assert.equal(JSON.parse(Buffer.from(c, "base64url").toString()).aud, "https://web.push.apple.com");
    assert.equal(key, push.vapidPublicKey());
    const raw = Buffer.from(key, "base64url");
    const publicKey = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
    assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  });

  test("reminder times must fall in their slots", () => {
    assert.deepEqual(push.validateReminderTimes(["10:30", "15:30", "21:00"]).times, ["10:30", "15:30", "21:00"]);
    assert.ok(push.validateReminderTimes(["08:00", "12:00", "01:30"]).times); // the evening runs past midnight
    assert.ok(push.validateReminderTimes(["13:00", "15:30", "21:00"]).error);
    assert.ok(push.validateReminderTimes(["10:30", "15:30"]).error);
  });

  test("a due slot without a report gets one encrypted reminder", async () => {
    const received: { headers: Record<string, unknown>; body: Buffer }[] = [];
    const service = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c)).on("end", () => {
        received.push({ headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(201).end();
      });
    });
    await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const secret = Buffer.alloc(16, 7);
    const endpoint = `http://127.0.0.1:${(service.address() as { port: number }).port}/push/1`;
    run("INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)",
      userId, endpoint, ua.getPublicKey().toString("base64url"), secret.toString("base64url"));
    try {
      // 15 January 2026, 10:40 in Toronto: the morning reminder (10:30) is due.
      const now = new Date("2026-01-15T15:40:00Z");
      assert.equal(await push.sendDueReminders(new Date("2026-01-15T15:20:00Z")), 0); // not yet due
      assert.equal(await push.sendDueReminders(now), 1);
      assert.equal(await push.sendDueReminders(now), 0); // once per slot
      assert.equal(received.length, 1);
      const { headers, body } = received[0];
      assert.equal(headers["content-encoding"], "aes128gcm");
      assert.ok(String(headers.authorization).startsWith("vapid t="));
      // Decrypt as the phone would.
      const asPublic = body.subarray(21, 21 + body[20]);
      const ikm = Buffer.from(hkdfSync("sha256", ua.computeSecret(asPublic), secret, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic]), 32));
      const derive = (info: string, n: number) => Buffer.from(hkdfSync("sha256", ikm, body.subarray(0, 16), Buffer.from(info), n));
      const cipherText = body.subarray(21 + body[20]);
      const decipher = createDecipheriv("aes-128-gcm", derive("Content-Encoding: aes128gcm\0", 16), derive("Content-Encoding: nonce\0", 12));
      decipher.setAuthTag(cipherText.subarray(-16));
      const plain = Buffer.concat([decipher.update(cipherText.subarray(0, -16)), decipher.final()]);
      assert.equal(JSON.parse(plain.subarray(0, -1).toString()).slot, "morning");
      // A report ten minutes after the reminder counts as answering it.
      const sentAt = all<{ sent_at: string }>("SELECT sent_at FROM reminders WHERE user_id = ? AND study_date = '2026-01-15'", userId)[0].sent_at;
      run("INSERT INTO ratings (user_id, rating, recorded_at, time_zone, study_date, slot, client_id) VALUES (?, 3, ?, ?, '2026-01-15', 'morning', ?)",
        userId, new Date(Date.parse(sentAt) + 10 * 60_000).toISOString(), "America/Toronto", crypto.randomUUID());
      const user = { id: userId, username: "me", time_zone: "America/Toronto", day_start_hour: 4, study_start: null };
      assert.ok(stats.promptedReports(user).prompted >= 1);
      // A slot that already has a report is not reminded.
      run("INSERT INTO ratings (user_id, rating, recorded_at, time_zone, study_date, slot, client_id) VALUES (?, 2, ?, ?, '2026-01-15', 'afternoon', ?)",
        userId, "2026-01-15T19:00:00Z", "America/Toronto", crypto.randomUUID());
      assert.equal(await push.sendDueReminders(new Date("2026-01-15T21:00:00Z")), 0);
    } finally {
      run("DELETE FROM push_subscriptions WHERE endpoint = ?", endpoint);
      run("DELETE FROM reminders WHERE user_id = ?", userId);
      run("DELETE FROM ratings WHERE user_id = ? AND study_date = '2026-01-15'", userId);
      service.close();
    }
  });
});

describe("sessions", () => {
  test("signing out ends the session", async () => {
    const b = new Browser();
    await b.login();
    const res = await b.fetch("/accounts/logout/", { method: "POST", form: { csrf: b.csrf } });
    assert.equal(res.status, 303);
    assert.equal((await b.fetch("/")).status, 303);
    run("DELETE FROM sessions");
  });
});
