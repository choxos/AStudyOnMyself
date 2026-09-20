// Runs the R analysis and stores what it returns. R reads the database and
// writes JSON; this module is the only one that records runs.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { sha256 } from "./auth.ts";
import { DATA_DIR, DB_PATH, ROOT, RSCRIPT } from "./config.ts";
import { all, get, nowIso, run, transaction } from "./db.ts";
import { SLOTS, type Slot } from "./study.ts";

const execFileAsync = promisify(execFile);
const ANALYSIS_DIR = path.join(ROOT, "analysis");
const KEEP_FULL_RUNS = 10; // older runs keep only their effect estimates
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const STALE_MS = 2 * 3600 * 1000;

export type Status = "running" | "done" | "waiting" | "failed";

interface RunRow {
  id: number;
  user_id: number;
  status: Status;
  started_at: string;
  finished_at: string | null;
  n_ratings: number;
  n_days: number;
  data_fingerprint: string;
  results: string;
  message: string;
}

// The results JSON written by analysis/mood.R; see summarize_fit() there for its shape.
export type Results = Record<string, any>;
export type Run = Omit<RunRow, "results"> & { results: Results };

const parse = (row: RunRow | undefined): Run | null => (row ? { ...row, results: JSON.parse(row.results) as Results } : null);

export const getRun = (id: number): Run | null => parse(get<RunRow>("SELECT * FROM analysis_runs WHERE id = ?", id));
export const latestRun = (userId: number): Run | null =>
  parse(get<RunRow>("SELECT * FROM analysis_runs WHERE user_id = ? ORDER BY id DESC LIMIT 1", userId));
export const latestDone = (userId: number): Run | null =>
  parse(get<RunRow>("SELECT * FROM analysis_runs WHERE user_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1", userId));
/** The newest finished run of any kind: tag comparisons exist even before the model can run. */
export const latestFinished = (userId: number): Run | null =>
  parse(get<RunRow>("SELECT * FROM analysis_runs WHERE user_id = ? AND status IN ('done', 'waiting') ORDER BY id DESC LIMIT 1", userId));
export const recentRuns = (userId: number, limit = 10) =>
  all<Omit<RunRow, "results">>(
    "SELECT id, user_id, status, started_at, finished_at, n_ratings, n_days, data_fingerprint, message FROM analysis_runs WHERE user_id = ? ORDER BY id DESC LIMIT ?",
    userId, limit,
  );

export const drawsPath = (runId: number): string => path.join(DATA_DIR, "posteriors", `run_${runId}.json`);

/** Changes whenever the data, the study start or the analysis code change, so hourly runs can skip. */
export function fingerprint(userId: number): string {
  const ratings = get("SELECT count(*) AS n, max(created_at) AS t FROM ratings WHERE user_id = ?", userId);
  const logs = get("SELECT count(*) AS n, max(updated_at) AS t FROM daily_logs WHERE user_id = ?", userId);
  const start = get("SELECT study_start FROM users WHERE id = ?", userId);
  const code = ["mood.R", "mood.stan", "refit.R"].map((f) => readFileSync(path.join(ANALYSIS_DIR, f), "utf8"));
  return sha256(JSON.stringify([ratings, logs, start, code]));
}

/**
 * Whether a fit may be published now: it passed the convergence checks and used
 * the study start set at this moment, read from the database at every call.
 */
export function publishable(run: Run | null): run is Run {
  const start = run ? get<{ study_start: string | null }>("SELECT study_start FROM users WHERE id = ?", run.user_id)?.study_start : null;
  return Boolean(run?.results.diagnostics?.converged && start && run.results.data?.study_start === start);
}

/** A run still marked running after two hours was killed midway. */
export function markInterrupted(): void {
  run(
    "UPDATE analysis_runs SET status = 'failed', message = 'Interrupted before it finished.', finished_at = ? WHERE status = 'running' AND started_at < ?",
    nowIso(), new Date(Date.now() - STALE_MS).toISOString(),
  );
}

/**
 * Fit the model for one user. Returns the run, or null when skipped. iter and
 * adaptDelta are for the rerun of a fit that failed the convergence checks
 * (protocol Section 2.9.5: 4,000 and 0.99); the time limit grows with them.
 */
export async function refitUser(userId: number, options: { ifNewData?: boolean; iter?: number; adaptDelta?: number } = {}): Promise<Run | null> {
  const { iter = 2000, adaptDelta = 0.95 } = options;
  const dataFingerprint = fingerprint(userId);
  const runId = transaction(() => {
    if (get("SELECT 1 FROM analysis_runs WHERE user_id = ? AND status = 'running'", userId)) return null;
    const last = get<{ data_fingerprint: string }>(
      "SELECT data_fingerprint FROM analysis_runs WHERE user_id = ? AND status != 'running' ORDER BY id DESC LIMIT 1", userId,
    );
    if (options.ifNewData && last?.data_fingerprint === dataFingerprint) return null;
    return Number(run("INSERT INTO analysis_runs (user_id, status, data_fingerprint) VALUES (?, 'running', ?)", userId, dataFingerprint).lastInsertRowid);
  });
  if (runId === null) return null;

  const out = path.join(DATA_DIR, "tmp", `run_${runId}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  mkdirSync(path.dirname(drawsPath(runId)), { recursive: true });
  try {
    await execFileAsync(
      RSCRIPT,
      [
        path.join(ANALYSIS_DIR, "refit.R"), "--db", DB_PATH, "--user", String(userId), "--out", out,
        "--draws", drawsPath(runId), "--stan-dir", path.join(DATA_DIR, "stan"), "--seed", String(runId),
        "--iter", String(iter), "--adapt-delta", String(adaptDelta),
      ],
      { timeout: RUN_TIMEOUT_MS * Math.max(1, iter / 2000) * (adaptDelta > 0.95 ? 2 : 1), maxBuffer: 16 * 1024 * 1024 },
    );
    const output = JSON.parse(readFileSync(out, "utf8")) as { status: Status; message?: string; results?: Results };
    const results = output.results ?? {};
    run(
      "UPDATE analysis_runs SET status = ?, message = ?, results = ?, n_ratings = ?, n_days = ?, finished_at = ? WHERE id = ?",
      output.status, output.message ?? "", JSON.stringify(results), results.data?.n_ratings ?? 0, results.data?.n_rated_days ?? 0, nowIso(), runId,
    );
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    const lines = stderr.split("\n").filter((l) => l.trim() && !l.includes("built under R version"));
    const message = (lines.slice(-3).join(" ") || String(error)).slice(0, 500);
    run("UPDATE analysis_runs SET status = 'failed', message = ?, finished_at = ? WHERE id = ?", message, nowIso(), runId);
  } finally {
    rmSync(out, { force: true });
  }
  prune(userId);
  return getRun(runId);
}

/** Drop bulky series and posterior draws from older runs. */
function prune(userId: number): void {
  const old = all<{ id: number; results: string }>(
    "SELECT id, results FROM analysis_runs WHERE user_id = ? AND status = 'done' ORDER BY id DESC LIMIT -1 OFFSET ?",
    userId, KEEP_FULL_RUNS,
  );
  for (const row of old) {
    rmSync(drawsPath(row.id), { force: true });
    const results = JSON.parse(row.results) as Results;
    if ("daily_mood" in results) {
      for (const key of ["daily_mood", "ppc", "forecast"]) delete results[key];
      run("UPDATE analysis_runs SET results = ? WHERE id = ?", JSON.stringify(results), row.id);
    }
  }
}

interface Draws {
  cutpoints: number[][];
  time_of_day: number[][];
  weekday_effect: number[][];
  beta: number[][];
  phi: number[];
  sigma_day: number[];
  fields: string[];
  means: number[];
  sds: number[];
}

/** Deterministic standard normals (mulberry32 plus Box-Muller), so answers do not jitter. */
function normals(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
}

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

/**
 * P(Sad, Meh, Happy) per slot on a typical day with the given predictor values
 * (blank means your average). The latent daily mood is averaged over its
 * long-run distribution, so this describes a typical day, not tomorrow.
 */
export function whatIf(runId: number, values: Record<string, string>, weekday: number): Record<Slot, number[]> {
  const file = drawsPath(runId);
  if (!existsSync(file)) throw new Error("The saved posterior for this run is gone; refit first.");
  const d = JSON.parse(readFileSync(file, "utf8")) as Draws;
  const x = d.fields.map((field, j) => {
    const raw = values[field]?.trim();
    if (!raw) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new RangeError("Please enter numbers only.");
    return (n - d.means[j]) / d.sds[j];
  });
  const z = normals(1);
  const totals = SLOTS.map(() => [0, 0, 0]);
  for (let s = 0; s < d.phi.length; s++) {
    const stationarySd = d.sigma_day[s] / Math.sqrt(1 - d.phi[s] ** 2);
    const base = x.reduce((sum, xj, j) => sum + d.beta[s][j] * xj, 0) + d.weekday_effect[s][weekday] + stationarySd * z();
    SLOTS.forEach((_, k) => {
      const eta = base + d.time_of_day[s][k];
      const belowMeh = logistic(d.cutpoints[s][0] - eta);
      const belowHappy = logistic(d.cutpoints[s][1] - eta);
      totals[k][0] += belowMeh;
      totals[k][1] += belowHappy - belowMeh;
      totals[k][2] += 1 - belowHappy;
    });
  }
  const round = (v: number) => Math.round((v / d.phi.length) * 1000) / 1000;
  return Object.fromEntries(SLOTS.map((slot, k) => [slot, totals[k].map(round)])) as Record<Slot, number[]>;
}
