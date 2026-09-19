// Weather, publishing and backups: the jobs the hourly maintenance run chains.
import { execFile } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { backup as sqliteBackup } from "node:sqlite";
import { promisify } from "node:util";
import { publishable, type Run } from "./analysis.ts";
import {
  BACKUP_DIR, BACKUP_GPG_RECIPIENT, BACKUP_KEEP, DATA_DIR, PUBLISH_DIR, PUBLISH_SUBDIR, ROOT,
  WEATHER_LATITUDE, WEATHER_LONGITUDE,
} from "./config.ts";
import { all, db, get, nowIso, run } from "./db.ts";
import { addDays, CONFIRMATORY_FIELDS, studyDayAndSlot } from "./study.ts";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------- weather

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const DAILY_VARS = "temperature_2m_mean,precipitation_sum,sunshine_duration,daylight_duration";
const ARCHIVE_LAG_DAYS = 5; // the archive trails a few days; the forecast API covers the recent past

type WeatherRow = Partial<Record<"temp_mean_c" | "precipitation_mm" | "sunshine_hours" | "daylight_hours" | "pm25", number>>;

async function getJson(url: string, params: Record<string, string>): Promise<Record<string, Record<string, (number | string | null)[]>>> {
  const response = await fetch(`${url}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return (await response.json()) as Record<string, Record<string, (number | string | null)[]>>;
}

/** Daily weather and PM2.5 from Open-Meteo. Only the rounded location leaves the machine. */
export async function fetchWeather(start: string, end: string, timeZone: string): Promise<Map<string, WeatherRow>> {
  const location = { latitude: Number(WEATHER_LATITUDE).toFixed(2), longitude: Number(WEATHER_LONGITUDE).toFixed(2), timezone: timeZone };
  const rows = new Map<string, WeatherRow>();
  const split = addDays(new Date().toISOString().slice(0, 10), -ARCHIVE_LAG_DAYS);
  const daily = async (url: string, from: string, to: string) => {
    if (from > to) return;
    const d = (await getJson(url, { ...location, daily: DAILY_VARS, start_date: from, end_date: to })).daily;
    d.time.forEach((day, i) => {
      const hours = (seconds: number | string | null) => (seconds === null ? undefined : Math.round((Number(seconds) / 3600) * 100) / 100);
      rows.set(String(day), {
        temp_mean_c: d.temperature_2m_mean[i] === null ? undefined : Number(d.temperature_2m_mean[i]),
        precipitation_mm: d.precipitation_sum[i] === null ? undefined : Number(d.precipitation_sum[i]),
        sunshine_hours: hours(d.sunshine_duration[i]),
        daylight_hours: hours(d.daylight_duration[i]),
      });
    });
  };
  await daily(ARCHIVE_URL, start, end < split ? end : addDays(split, -1));
  await daily(FORECAST_URL, start > split ? start : split, end);
  const air = (await getJson(AIR_URL, { ...location, hourly: "pm2_5", start_date: start, end_date: end })).hourly;
  const byDay = new Map<string, number[]>();
  air.time.forEach((stamp, i) => {
    const value = air.pm2_5[i];
    if (value !== null) byDay.set(String(stamp).slice(0, 10), [...(byDay.get(String(stamp).slice(0, 10)) ?? []), Number(value)]);
  });
  for (const [day, values] of byDay) {
    rows.set(day, { ...rows.get(day), pm25: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 });
  }
  return rows;
}

/**
 * Save the values of automatic sources into a day's log. Only real changes are
 * saved, so re-fetching does not change the data fingerprint and trigger a refit.
 * Keys are field names from this code, never from a request.
 */
export function mergeDaily(userId: number, day: string, values: Record<string, number | undefined>): boolean {
  const current = get<Record<string, number | null>>("SELECT * FROM daily_logs WHERE user_id = ? AND date = ?", userId, day) ?? {};
  const updates = Object.entries(values).filter(([key, value]) => value !== undefined && current[key] !== value);
  if (!updates.length) return false;
  run("INSERT INTO daily_logs (user_id, date) VALUES (?, ?) ON CONFLICT (user_id, date) DO NOTHING", userId, day);
  run(
    `UPDATE daily_logs SET ${updates.map(([key]) => `${key} = ?`).join(", ")}, updated_at = ? WHERE user_id = ? AND date = ?`,
    ...updates.map(([, value]) => value as number), nowIso(), userId, day,
  );
  return true;
}

/** Fill weather for complete days (up to yesterday). */
export async function syncWeather(days = 7): Promise<string> {
  if (!WEATHER_LATITUDE || !WEATHER_LONGITUDE) return "Weather is off (set WEATHER_LATITUDE and WEATHER_LONGITUDE).";
  let changed = 0;
  for (const user of all<{ id: number; time_zone: string }>("SELECT DISTINCT u.id, u.time_zone FROM users u JOIN ratings r ON r.user_id = u.id")) {
    // Yesterday in the participant's time zone: the last complete local day.
    const end = addDays(studyDayAndSlot(new Date(), user.time_zone, 0).studyDate, -1);
    const rows = await fetchWeather(addDays(end, -(days - 1)), end, user.time_zone);
    for (const [day, values] of rows) if (mergeDaily(user.id, day, values)) changed++;
  }
  return `Weather: ${changed} day(s) updated.`;
}

// ---------------------------------------------------------------- publishing

const INTERVAL_KEYS = ["est", "lo", "hi"];
const DIAGNOSTIC_KEYS = ["max_rhat", "min_ess_bulk", "divergences", "converged"];
// The site folder (results page, protocol, review record) plus two files it shares with the app.
const SHARED_FILES = [path.join(ROOT, "static", "css", "app.css"), path.join(ROOT, "static", "js", "charts.js")];

const pick = (source: Record<string, any>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, source?.[k]]));
const text = (value: unknown) => String(value ?? "");
const number = (value: unknown) => (typeof value === "number" ? value : null);
const interval = (value: Record<string, any>) => Object.fromEntries(INTERVAL_KEYS.map((k) => [k, number(value?.[k])]));

/**
 * The only data that ever leaves the machine for the public page: effect
 * estimates, intervals, convergence checks and counts. Never reports, notes,
 * tags, daily values, daily series, forecasts or predictor means. Every field is
 * listed here by name, nested ones too, so nothing else can pass through. The
 * factors of the confirmatory hypotheses get no evidence label before the 6- and
 * 12-month analyses.
 */
export function publicResults(run: Run) {
  const r = run.results;
  const updated = new Date(run.finished_at ?? nowIso());
  updated.setUTCMinutes(0, 0, 0);
  const levels = (rows: Record<string, any>[]) => rows.map((t) => ({ level: text(t.level), p_happy: interval(t.p_happy) }));
  return {
    updated: updated.toISOString(),
    model_version: text(r.model.version),
    sample: { ratings: run.n_ratings, days: run.n_days },
    predictors: (r.predictors as Record<string, any>[]).map((p) => ({
      label: text(p.label), unit_label: text(p.unit_label), lag: number(p.lag),
      odds_ratio: interval(p.odds_ratio), d_happy_pp: interval(p.d_happy_pp), d_sad_pp: interval(p.d_sad_pp),
      p_positive: number(p.p_positive), direction: text(p.direction),
      evidence: CONFIRMATORY_FIELDS.has(p.field) ? "confirmatory" : text(p.evidence),
    })),
    time_of_day: levels(r.time_of_day),
    weekday: levels(r.weekday),
    dynamics: {
      phi: { ...interval(r.dynamics.phi), p_positive: number(r.dynamics.phi?.p_positive) },
      sigma_day: interval(r.dynamics.sigma_day),
    },
    diagnostics: pick(r.diagnostics, DIAGNOSTIC_KEYS),
  };
}

/** The whole public site; before the first fit there is no results.json yet. */
export function writeSite(runToPublish: Run | null, target: string): void {
  mkdirSync(target, { recursive: true });
  cpSync(path.join(ROOT, "site"), target, { recursive: true });
  for (const file of SHARED_FILES) copyFileSync(file, path.join(target, path.basename(file)));
  if (runToPublish) writeFileSync(path.join(target, "results.json"), `${JSON.stringify(publicResults(runToPublish), null, 1)}\n`, { mode: 0o644 });
}

/** Never write into the site root: that would overwrite the site's own index.html. */
export function publishTarget(dir = PUBLISH_DIR, subdir = PUBLISH_SUBDIR): { repo: string; target: string } {
  const repo = path.resolve(dir);
  const target = path.resolve(repo, subdir);
  if (target === repo || !target.startsWith(repo + path.sep)) {
    throw new Error(`PUBLISH_SUBDIR must name a folder inside ${repo}, not the repository root.`);
  }
  return { repo, target };
}

const git = async (repo: string, ...args: string[]) => (await execFileAsync("git", ["-C", repo, ...args])).stdout;

/** Write the page into the Pages clone, then commit and push only that folder. */
export async function publish(runToPublish: Run | null, message = "Update mood study results"): Promise<string> {
  if (!PUBLISH_DIR) return "Publishing is off (PUBLISH_DIR not set).";
  const { repo, target } = publishTarget();
  await git(repo, "pull", "--rebase", "--quiet");
  // Checked when the page is written: a fit that failed the checks or used another
  // study start than the one set now is never published; the pages go out alone.
  writeSite(publishable(runToPublish) ? runToPublish : null, target);
  await git(repo, "add", "--", target);
  if (!(await git(repo, "status", "--porcelain", "--", target)).trim()) return "Published results unchanged.";
  await git(repo, "commit", "--quiet", "-m", message);
  await git(repo, "push", "--quiet");
  return "Published results to GitHub Pages.";
}

// ---------------------------------------------------------------- backups

const BACKUP_EVERY_MS = 20 * 3600 * 1000;
const backups = (): string[] => {
  try {
    return readdirSync(BACKUP_DIR).filter((f) => /^study-.*\.db\.gpg$/.test(f)).sort();
  } catch {
    return [];
  }
};

export const lastBackup = (): string | null => backups().at(-1) ?? null;

export function backupDue(): boolean {
  const newest = lastBackup();
  return !newest || Date.now() - statSync(path.join(BACKUP_DIR, newest)).mtimeMs > BACKUP_EVERY_MS;
}

/** An encrypted snapshot, taken with SQLite's online backup while the server keeps running. */
export async function backupNow(): Promise<string> {
  if (!BACKUP_GPG_RECIPIENT) {
    throw new Error('Set BACKUP_GPG_RECIPIENT in .env to your backup key\'s fingerprint (create one with: gpg --quick-generate-key "AStudyOnMyself backup").');
  }
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "");
  const snapshot = path.join(DATA_DIR, "tmp", `backup-${stamp}.db`);
  const output = path.join(BACKUP_DIR, `study-${stamp}.db.gpg`);
  mkdirSync(path.dirname(snapshot), { recursive: true });
  try {
    await sqliteBackup(db, snapshot);
    await execFileAsync("gpg", ["--batch", "--yes", "--trust-model", "always", "--encrypt", "--recipient", BACKUP_GPG_RECIPIENT, "--output", output, snapshot]);
  } finally {
    rmSync(snapshot, { force: true });
  }
  for (const old of backups().slice(0, -BACKUP_KEEP)) rmSync(path.join(BACKUP_DIR, old));
  return `Encrypted backup written to ${output}`;
}
