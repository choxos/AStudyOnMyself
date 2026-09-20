// Plain counts and shares for the dashboard. All inference happens in R.
import type { User } from "./auth.ts";
import { all, get } from "./db.ts";
import { addDays, DAILY_FIELDS, SLOTS, studyDayAndSlot, weekdayIndex, WEEKDAYS } from "./study.ts";

export const currentStudyDay = (user: User, now = new Date()) => studyDayAndSlot(now, user.time_zone, user.day_start_hour);

/** The first study day: the configured study start, else the day of the first report. */
export function studyStart(user: User): string | null {
  return user.study_start || (get<{ d: string | null }>("SELECT min(study_date) AS d FROM ratings WHERE user_id = ?", user.id)?.d ?? null);
}

const answeredSlots = (user: User, from: string, to: string): number =>
  get<{ n: number }>(
    "SELECT count(*) AS n FROM (SELECT DISTINCT study_date, slot FROM ratings WHERE user_id = ? AND study_date BETWEEN ? AND ?)",
    user.id, from, to,
  )?.n ?? 0;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/** Slots from `from` to `to` (today at the latest) that had begun by now: today counts only up to the current slot. */
function begunSlots(user: User, from: string, to: string, now: Date): number {
  const { studyDate, slot } = currentStudyDay(user, now);
  return to < studyDate ? 3 * daysBetween(from, to) : 3 * (daysBetween(from, to) - 1) + SLOTS.indexOf(slot) + 1;
}

/**
 * Share of morning, afternoon and evening slots answered over the last `days`
 * study days, counting only slots since the study start that have begun.
 */
export function completion(user: User, days = 14, now = new Date()): number {
  const today = currentStudyDay(user, now).studyDate;
  const start = studyStart(user);
  if (!start || start > today) return 0;
  const from = [addDays(today, -(days - 1)), start].sort().at(-1)!;
  return answeredSlots(user, from, today) / begunSlots(user, from, today, now);
}

/**
 * Adherence per week (Monday to Sunday) since the study start: slots answered out
 * of the slots that had begun by then. The protocol reviews the reminders when two
 * consecutive completed weeks fall below 50%.
 */
export function weeklyAdherence(user: User, now = new Date()): { week: string; answered: number; eligible: number; share: number }[] {
  const today = currentStudyDay(user, now).studyDate;
  const start = studyStart(user);
  if (!start || start > today) return [];
  const rows = [];
  for (let week = addDays(start, -weekdayIndex(start)); week <= today; week = addDays(week, 7)) {
    const from = [week, start].sort().at(-1)!;
    const to = [addDays(week, 6), today].sort()[0];
    const eligible = begunSlots(user, from, to, now);
    const answered = answeredSlots(user, from, to);
    rows.push({ week, answered, eligible, share: answered / eligible });
  }
  return rows;
}

export interface Shares {
  n: number;
  sad: number | null;
  meh: number | null;
  happy: number | null;
}

function shares(ratings: number[]): Shares {
  const n = ratings.length;
  const share = (k: number) => (n ? ratings.filter((r) => r === k).length / n : null);
  return { n, sad: share(1), meh: share(2), happy: share(3) };
}

// Pilot reports, made before the study start, stay out of every summary, as they stay out of the model.
const sinceStart = (user: User): string => studyStart(user) ?? "0000-01-01";

/** Share of Happy and Sad reports per week (Monday start); weeks with few reports stay blank. */
export function weeklyShares(user: User, weeks = 26) {
  const today = currentStudyDay(user).studyDate;
  const start = addDays(today, -(weekdayIndex(today) + 7 * (weeks - 1)));
  const rows = all<{ study_date: string; rating: number }>(
    "SELECT study_date, rating FROM ratings WHERE user_id = ? AND study_date >= ? AND study_date >= ?", user.id, start, sinceStart(user),
  );
  const byWeek = new Map<string, number[]>();
  for (const r of rows) {
    const week = addDays(r.study_date, -weekdayIndex(r.study_date));
    byWeek.set(week, [...(byWeek.get(week) ?? []), r.rating]);
  }
  const x: string[] = [];
  const happy: (number | null)[] = [];
  const sad: (number | null)[] = [];
  for (let k = 0; k < weeks; k++) {
    const week = addDays(start, 7 * k);
    const s = shares(byWeek.get(week) ?? []);
    const enough = s.n >= 3;
    x.push(week);
    happy.push(enough ? Math.round((s.happy ?? 0) * 1000) / 1000 : null);
    sad.push(enough ? Math.round((s.sad ?? 0) * 1000) / 1000 : null);
  }
  return { x, happy, sad };
}

export function breakdown(user: User) {
  const rows = all<{ slot: string; study_date: string; rating: number }>(
    "SELECT slot, study_date, rating FROM ratings WHERE user_id = ? AND study_date >= ?", user.id, sinceStart(user),
  );
  return {
    total: shares(rows.map((r) => r.rating)),
    bySlot: SLOTS.map((slot) => ({ label: slot, ...shares(rows.filter((r) => r.slot === slot).map((r) => r.rating)) })),
    byWeekday: WEEKDAYS.map((day, k) => ({
      label: day, ...shares(rows.filter((r) => weekdayIndex(r.study_date) === k).map((r) => r.rating)),
    })),
  };
}

/**
 * The protocol's safety rule: over the last 14 study days, more than half of at
 * least 10 reports were Sad, or the evening rating was 3 or lower on 7 days or more.
 */
export function safetyRuleMet(user: User, days = 14): boolean {
  const today = currentStudyDay(user).studyDate;
  const from = addDays(today, -(days - 1));
  const reports = get<{ n: number; sad: number }>(
    "SELECT count(*) AS n, coalesce(sum(rating = 1), 0) AS sad FROM ratings WHERE user_id = ? AND study_date BETWEEN ? AND ?",
    user.id, from, today,
  )!;
  const lowDays = get<{ n: number }>(
    "SELECT count(*) AS n FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ? AND day_satisfaction <= 3", user.id, from, today,
  )!.n;
  return (reports.n >= 10 && reports.sad / reports.n > 0.5) || lowDays >= 7;
}

/** Reports since the study start, and how many came within an hour after a reminder a push service accepted in their slot. */
export function promptedReports(user: User): { reports: number; prompted: number } {
  const row = get<{ reports: number; prompted: number }>(
    `SELECT count(*) AS reports, coalesce(sum(EXISTS (
       SELECT 1 FROM reminders m WHERE m.user_id = r.user_id AND m.study_date = r.study_date AND m.slot = r.slot AND m.delivered = 1
         AND julianday(r.recorded_at) BETWEEN julianday(m.sent_at) AND julianday(m.sent_at) + 1.0 / 24)), 0) AS prompted
     FROM ratings r WHERE r.user_id = ? AND r.study_date >= ?`,
    user.id, sinceStart(user),
  )!;
  return row;
}

/** Reports and days with reports since the study start. */
export function reportCounts(user: User): { reports: number; days: number } {
  return get<{ reports: number; days: number }>(
    "SELECT count(*) AS reports, count(DISTINCT study_date) AS days FROM ratings WHERE user_id = ? AND study_date >= ?", user.id, sinceStart(user),
  )!;
}

/**
 * Completeness (protocol Section 2.3.3): for each daily field, the finished study
 * days with a value, out of all finished study days. The monthly review reads it.
 */
export function completeness(user: User, now = new Date()): { of: number; rows: { label: string; days: number; share: number }[] } {
  const start = studyStart(user);
  const end = addDays(currentStudyDay(user, now).studyDate, -1);
  if (!start || start > end) return { of: 0, rows: [] };
  const of = daysBetween(start, end);
  const fields = DAILY_FIELDS.filter((f) => f.type !== "text");
  const counts = get<Record<string, number>>(
    `SELECT ${fields.map((f) => `count(${f.name}) AS ${f.name}`).join(", ")} FROM daily_logs WHERE user_id = ? AND date BETWEEN ? AND ?`,
    user.id, start, end,
  )!;
  return { of, rows: fields.map((f) => ({ label: f.label, days: counts[f.name], share: counts[f.name] / of })) };
}
