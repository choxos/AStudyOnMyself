// Study rules: study days and slots, and validation of everything that is stored.

export const SLOTS = ["morning", "afternoon", "evening"] as const;
export type Slot = (typeof SLOTS)[number];
export const MOODS = ["Sad", "Meh", "Happy"] as const;
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

const MAX_BACKDATE_MS = 14 * 24 * 3600 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isTimeZone(name: unknown): name is string {
  if (typeof name !== "string" || !name) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Map an instant to its study date and slot in a time zone. The study day starts
 * at dayStartHour, so a report at 1 AM belongs to the previous day's evening.
 */
export function studyDayAndSlot(instant: Date, timeZone: string, dayStartHour = 4): { studyDate: string; slot: Slot } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const hour = part("hour");
  const slot: Slot = hour >= dayStartHour && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "afternoon" : "evening";
  let day = Date.UTC(part("year"), part("month") - 1, part("day"));
  if (hour < dayStartHour) day -= 24 * 3600 * 1000;
  return { studyDate: new Date(day).toISOString().slice(0, 10), slot };
}

export const addDays = (isoDate: string, days: number): string =>
  new Date(Date.parse(`${isoDate}T00:00:00Z`) + days * 24 * 3600 * 1000).toISOString().slice(0, 10);

/** 0 = Monday. */
export const weekdayIndex = (isoDate: string): number => (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;

const TAG = /^[\p{L}\p{N}_-]{1,30}$/u;

/** Lowercase, deduplicated tags from an explicit list plus #hashtags in the note. */
export function normalizeTags(tags: unknown, note: string): string[] {
  const listed = Array.isArray(tags) ? tags.map((t) => String(t).trim().replace(/^#/, "").toLowerCase()) : [];
  const inNote = [...note.matchAll(/#([\p{L}\p{N}_-]{1,30})/gu)].map((m) => m[1].toLowerCase());
  return [...new Set([...listed, ...inNote])].filter((t) => TAG.test(t)).slice(0, 10);
}

export interface RatingInput {
  rating: 1 | 2 | 3;
  recordedAt: Date;
  timeZone: string | null;
  note: string;
  tags: string[];
  source: string;
  clientId: string;
}

type Errors = Record<string, string>;

export function validateRating(body: Record<string, unknown>, now = new Date()): { value?: RatingInput; errors?: Errors } {
  const errors: Errors = {};
  const rating = Number(body.rating);
  if (![1, 2, 3].includes(rating) || String(body.rating).trim() !== String(rating)) errors.rating = "Must be 1, 2 or 3.";
  let recordedAt = now;
  if (body.recorded_at !== undefined && body.recorded_at !== null && body.recorded_at !== "") {
    recordedAt = new Date(String(body.recorded_at));
    if (Number.isNaN(recordedAt.getTime())) errors.recorded_at = "Not a date and time.";
    else if (recordedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) errors.recorded_at = "Rating time is in the future.";
    else if (recordedAt.getTime() < now.getTime() - MAX_BACKDATE_MS) errors.recorded_at = "Ratings older than 14 days cannot be sent here.";
  }
  const note = body.note === undefined || body.note === null ? "" : String(body.note);
  if (note.length > 2000) errors.note = "At most 2000 characters.";
  const source = body.source === undefined ? "web" : String(body.source);
  if (!/^[\w-]{1,20}$/.test(source)) errors.source = "Letters, digits, - or _, at most 20.";
  let clientId = body.client_id === undefined || body.client_id === null ? crypto.randomUUID() : String(body.client_id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId)) errors.client_id = "Must be a UUID.";
  clientId = clientId.toLowerCase();
  if (body.tags !== undefined && !Array.isArray(body.tags)) errors.tags = "Must be a list.";
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      rating: rating as 1 | 2 | 3,
      recordedAt,
      // An unknown zone from an odd browser should not cost a rating; the
      // profile's zone is used instead.
      timeZone: isTimeZone(body.time_zone) ? body.time_zone : null,
      note,
      tags: normalizeTags(body.tags, note),
      source,
      clientId,
    },
  };
}

export interface FieldSpec {
  name: string;
  label: string;
  type: "float" | "int" | "bool" | "text";
  min?: number;
  max?: number;
  help?: string;
}

// Must match the daily_logs columns in schema.sql (a test checks this).
export const LOG_SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Last night",
    fields: [
      { name: "sleep_hours", label: "Sleep (hours)", type: "float", min: 0, max: 24 },
      { name: "sleep_efficiency", label: "Sleep efficiency (%)", type: "float", min: 0, max: 100 },
      { name: "hrv_ms", label: "HRV (ms)", type: "float", min: 1, max: 300, help: "Keep one source and metric (RMSSD or SDNN)" },
      { name: "resting_hr", label: "Resting heart rate (bpm)", type: "float", min: 25, max: 200 },
      { name: "skin_temp_dev_c", label: "Skin temperature deviation (°C)", type: "float", min: -5, max: 5 },
    ],
  },
  {
    title: "Today",
    fields: [
      { name: "steps", label: "Steps", type: "int", min: 0, max: 200000 },
      { name: "exercise_min", label: "Exercise (min)", type: "int", min: 0, max: 1440 },
      { name: "outdoor_min", label: "Time outdoors (min)", type: "int", min: 0, max: 1440 },
      { name: "social_min", label: "Time with people (min)", type: "int", min: 0, max: 1440, help: "In person with friends or family, not work meetings" },
      { name: "screen_time_min", label: "Screen time (min)", type: "int", min: 0, max: 1440, help: "iPhone Screen Time total for the day" },
      { name: "social_media_min", label: "Social media (min)", type: "int", min: 0, max: 1440, help: "Screen Time, Social category" },
      { name: "caffeine_mg", label: "Caffeine (mg)", type: "int", min: 0, max: 2000, help: "Brewed coffee about 95, espresso 63, black tea 47" },
      { name: "alcohol_units", label: "Alcohol (standard drinks)", type: "float", min: 0, max: 50, help: "341 mL beer, 142 mL wine or 43 mL spirits each" },
    ],
  },
  {
    title: "Context",
    fields: [
      { name: "work_day", label: "Work day", type: "bool", help: "Scheduled work today" },
      { name: "travel", label: "Away from home", type: "bool", help: "Slept away from home last night" },
      { name: "sick", label: "Sick", type: "bool", help: "Unwell enough to change plans" },
    ],
  },
  {
    title: "Evening check-in",
    fields: [
      { name: "day_satisfaction", label: "Satisfaction with today (0 to 10)", type: "int", min: 0, max: 10, help: "All things considered, how satisfied were you with today?" },
      { name: "note", label: "Note", type: "text" },
    ],
  },
  {
    title: "Weather (filled in automatically)",
    fields: [
      { name: "temp_mean_c", label: "Mean temperature (°C)", type: "float", min: -60, max: 60 },
      { name: "precipitation_mm", label: "Precipitation (mm)", type: "float", min: 0, max: 500 },
      { name: "sunshine_hours", label: "Sunshine (hours)", type: "float", min: 0, max: 24 },
      { name: "daylight_hours", label: "Day length (hours)", type: "float", min: 0, max: 24 },
      { name: "pm25", label: "PM2.5 (µg/m³)", type: "float", min: 0, max: 1000 },
    ],
  },
  {
    title: "Indoor air (filled in automatically)",
    fields: [
      { name: "indoor_pm25", label: "Indoor PM2.5 (µg/m³)", type: "float", min: 0, max: 1000, help: "Daily mean from the air quality monitor" },
      { name: "indoor_voc", label: "Indoor VOC (index)", type: "float", min: 0, max: 1000, help: "Daily mean from the air quality monitor" },
    ],
  },
];
export const DAILY_FIELDS: FieldSpec[] = LOG_SECTIONS.flatMap((s) => s.fields);

/** Factors of the confirmatory hypotheses H1 to H4: judged only at 6 and 12 months. */
export const CONFIRMATORY_FIELDS = new Set(["sleep_hours", "steps", "screen_time_min", "social_media_min", "social_min"]);
export const WEATHER_FIELDS = ["temp_mean_c", "precipitation_mm", "sunshine_hours", "daylight_hours", "pm25"];

export type DailyValue = number | string | null;

function parseField(field: FieldSpec, raw: unknown): { value?: DailyValue; error?: string } {
  if (raw === null || raw === undefined || raw === "") return { value: field.type === "text" ? "" : null };
  if (field.type === "text") {
    const text = String(raw);
    return text.length > 2000 ? { error: "At most 2000 characters." } : { value: text };
  }
  if (field.type === "bool") {
    const s = String(raw).toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return { value: 1 };
    if (["false", "0", "no", "off"].includes(s)) return { value: 0 };
    return { error: "Must be yes or no." };
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return { error: "Must be a number." };
  if (field.type === "int" && !Number.isInteger(n)) return { error: "Must be a whole number." };
  if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
    return { error: `Must be between ${field.min} and ${field.max}.` };
  }
  return { value: n };
}

/** Validate only the fields present, so partial updates never clear other fields. */
export function validateDaily(body: Record<string, unknown>): { date?: string; values?: Record<string, DailyValue>; errors?: Errors } {
  const errors: Errors = {};
  const date = String(body.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) errors.date = "Required, as YYYY-MM-DD.";
  const values: Record<string, DailyValue> = {};
  for (const field of DAILY_FIELDS) {
    if (!(field.name in body)) continue;
    const parsed = parseField(field, body[field.name]);
    if (parsed.error) errors[field.name] = parsed.error;
    else values[field.name] = parsed.value ?? null;
  }
  return Object.keys(errors).length ? { errors } : { date, values };
}
