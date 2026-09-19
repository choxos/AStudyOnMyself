// Automatic data sources for the hourly job: ring metrics from the Ultrahuman
// Partner API, and indoor air from an Amazon Smart Air Quality Monitor through
// the Alexa web service. Both stay off until configured, and both write to the
// participant's account, the first one created.
//
// Amazon has no public interface for the monitor. The Alexa part follows what
// home automation software does (alexapy for Home Assistant): the account is
// registered once as an Alexa app, the refresh token is kept in ALEXA_FILE, and
// each run exchanges it for web cookies. It can break when Amazon changes things;
// missing days are then handled as missing data.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ALEXA_DOMAIN, ALEXA_FILE, ULTRAHUMAN_TOKEN } from "./config.ts";
import { all, get, run } from "./db.ts";
import { mergeDaily } from "./maintenance.ts";
import { addDays, DAILY_FIELDS, studyDayAndSlot } from "./study.ts";

type Participant = { id: number; time_zone: string };
const participant = () => get<Participant>("SELECT id, time_zone FROM users ORDER BY id LIMIT 1");

/** Calendar date of an instant in a time zone. */
const localDate = (instant: Date, timeZone: string) => studyDayAndSlot(instant, timeZone, 0).studyDate;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const FIELDS = new Map(DAILY_FIELDS.map((f) => [f.name, f]));

/** Drop values outside the field's plausible range (a device sending 0 for "no reading", say). */
export function inRange(values: Record<string, number | undefined>): Record<string, number> {
  const kept: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    const field = FIELDS.get(name);
    if (value === undefined || !field) continue;
    if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) continue;
    kept[name] = field.type === "int" ? Math.round(value) : value;
  }
  return kept;
}

// ---------------------------------------------------------------- Ultrahuman

const ULTRAHUMAN_URL = "https://partner.ultrahuman.com/api/v1/partner/daily_metrics";

type MetricEntry = { type: string; object: Record<string, any> | null };

/**
 * One day of Partner API metrics as daily log fields. Sleep is filed under the
 * day it ended on, as in the daily log; steps only for finished days.
 */
export function ultrahumanDay(entries: MetricEntry[], finished: boolean): Record<string, number> {
  const by = Object.fromEntries(entries.map((e) => [e.type, e.object ?? {}]));
  const sleep = by.sleep ?? {};
  const minutes = num(sleep.total_sleep?.minutes);
  const pick = (value: number | undefined, digits: number) => (value === undefined ? undefined : round(value, digits));
  return inRange({
    sleep_hours: pick(minutes === undefined ? undefined : minutes / 60, 2),
    sleep_efficiency: pick(num(sleep.sleep_efficiency?.percentage), 1),
    skin_temp_dev_c: pick(num(sleep.temperature_deviation?.celsius), 2),
    hrv_ms: pick(num(by.hrv?.avg), 1),
    resting_hr: pick(num(by.night_rhr?.avg), 1),
    steps: finished ? num(by.steps?.total) : undefined,
  });
}

/** Fetch the last few days of ring metrics; later fetches correct earlier partial values. */
export async function syncUltrahuman(days = 3): Promise<string> {
  if (!ULTRAHUMAN_TOKEN) return "Ultrahuman is off (set ULTRAHUMAN_TOKEN).";
  const user = participant();
  if (!user) return "Ultrahuman: no account yet.";
  const today = localDate(new Date(), user.time_zone);
  let changed = 0;
  const missing: string[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const day = addDays(today, -back);
    const response = await fetch(`${ULTRAHUMAN_URL}?${new URLSearchParams({ date: day })}`, {
      headers: { Authorization: ULTRAHUMAN_TOKEN, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Ultrahuman answered ${response.status}${response.status === 401 ? " (token rejected)" : ""}.`);
    const body = (await response.json()) as { data?: { metrics?: Record<string, MetricEntry[]> }; error?: string | null };
    if (body.error) throw new Error(`Ultrahuman: ${body.error}`);
    // Values are filed only under the date they were returned for, never under another.
    const entries = body.data?.metrics?.[day];
    if (!entries) {
      missing.push(day);
      continue;
    }
    if (mergeDaily(user.id, day, ultrahumanDay(entries, day < today))) changed++;
  }
  return `Ultrahuman: ${changed} day(s) updated.${missing.length ? ` No metrics returned for ${missing.join(", ")}.` : ""}`;
}

// ---------------------------------------------------------------- Alexa: sign in

const APP_NAME = "A Study On Myself";
const APP_VERSION = "2.2.556530.0";
const USER_AGENT = `AmazonWebView/Amazon Alexa/${APP_VERSION}/iOS/16.6/iPhone`;
const DEVICE_TYPE = "A2IVLV5VM2W81"; // the Alexa iOS app
const CLIENT_SUFFIX = Buffer.from(`#${DEVICE_TYPE}`).toString("hex");

interface AlexaState {
  domain: string;
  serial: string;
  refresh_token: string;
}

export interface AlexaSignIn {
  url: string;
  serial: string;
  verifier: string;
}

const clientId = (serial: string) => Buffer.from(serial).toString("hex") + CLIENT_SUFFIX;

/** The Amazon sign-in page for a new device registration (OAuth with PKCE). */
export function alexaSignInStart(): AlexaSignIn {
  const serial = randomBytes(16).toString("hex").toUpperCase();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const params = new URLSearchParams({
    "openid.return_to": "https://www.amazon.com/ap/maplanding",
    "openid.assoc_handle": "amzn_dp_project_dee_ios",
    "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
    pageId: "amzn_dp_project_dee_ios",
    accountStatusPolicy: "P1",
    "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    "openid.mode": "checkid_setup",
    "openid.ns.oa2": "http://www.amazon.com/ap/ext/oauth/2",
    "openid.oa2.client_id": `device:${clientId(serial)}`,
    "openid.ns.pape": "http://specs.openid.net/extensions/pape/1.0",
    "openid.oa2.response_type": "code",
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.pape.max_auth_age": "0",
    "openid.oa2.scope": "device_auth_access offline_access",
    "openid.oa2.code_challenge_method": "S256",
    "openid.oa2.code_challenge": challenge,
    language: "en_US",
  });
  return { url: `https://www.amazon.com/ap/signin?${params}`, serial, verifier };
}

/** The authorization code in the address Amazon lands on after sign in. */
export function authorizationCode(returned: string): string {
  let code: string | null = null;
  try {
    code = new URL(returned.trim()).searchParams.get("openid.oa2.authorization_code");
  } catch {
    // not an address
  }
  if (!code) throw new Error("That address has no authorization code. Copy the whole address shown after signing in.");
  return code;
}

/** Register the device with the returned code and keep only the refresh token. */
export async function alexaSignInFinish(returned: string, start: AlexaSignIn): Promise<void> {
  const frc = randomBytes(313).toString("base64").replace(/=+$/, "");
  const body = JSON.stringify({
    requested_extensions: ["device_info", "customer_info"],
    cookies: { website_cookies: [], domain: `.${ALEXA_DOMAIN}` },
    registration_data: {
      domain: "Device", app_version: APP_VERSION, device_type: DEVICE_TYPE,
      device_name: `%FIRST_NAME%'s%DUPE_STRATEGY_1ST%${APP_NAME}`, os_version: "16.6",
      device_serial: start.serial, device_model: "iPhone", app_name: APP_NAME, software_version: "1",
    },
    auth_data: {
      client_id: clientId(start.serial), authorization_code: authorizationCode(returned),
      code_verifier: start.verifier, code_algorithm: "SHA-256", client_domain: "DeviceLegacy",
    },
    user_context_map: { frc },
    requested_token_type: ["bearer", "mac_dms", "website_cookies"],
  });
  let last = "";
  for (const domain of [...new Set([ALEXA_DOMAIN, "amazon.com"])]) {
    const response = await fetch(`https://api.${domain}/auth/register`, {
      method: "POST", body, signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    });
    const json = (await response.json().catch(() => ({}))) as { response?: { success?: { tokens?: { bearer?: { refresh_token?: string } } } } };
    const refresh = json.response?.success?.tokens?.bearer?.refresh_token;
    if (response.ok && refresh) {
      const state: AlexaState = { domain: ALEXA_DOMAIN, serial: start.serial, refresh_token: refresh };
      writeFileSync(ALEXA_FILE, JSON.stringify(state), { mode: 0o600 });
      return;
    }
    last = `api.${domain} answered ${response.status}`;
  }
  throw new Error(`Amazon did not register the device (${last}). Start again: the code works only once and only for a few minutes.`);
}

// ---------------------------------------------------------------- Alexa: readings

interface AlexaSession {
  domain: string;
  cookie: string;
  csrf: string;
}

const SIGN_IN_AGAIN = "run `node scripts/cli.ts alexa-login` to sign in again";

async function alexaSession(state: AlexaState): Promise<AlexaSession> {
  const form = new URLSearchParams({
    app_name: APP_NAME, app_version: APP_VERSION, "di.sdk.version": "6.12.4", domain: `.${state.domain}`,
    source_token: state.refresh_token, package_name: "com.amazon.echo", "di.hw.version": "iPhone", platform: "iOS",
    requested_token_type: "auth_cookies", source_token_type: "refresh_token", "di.os.name": "iOS",
    "di.os.version": "16.6", current_version: "6.12.4", previous_version: "6.12.4",
  });
  const response = await fetch(`https://www.${state.domain}/ap/exchangetoken/cookies`, {
    method: "POST", body: form, signal: AbortSignal.timeout(30_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT, "x-amzn-identity-auth-domain": `api.${state.domain}` },
  });
  if (!response.ok) throw new Error(`Amazon refused the saved sign in (${response.status}); ${SIGN_IN_AGAIN}.`);
  const tokens = ((await response.json()) as { response?: { tokens?: { cookies?: Record<string, { Name: string; Value: string }[]> } } })
    .response?.tokens?.cookies ?? {};
  const jar = new Map<string, string>();
  for (const list of Object.values(tokens)) for (const c of list) jar.set(c.Name, String(c.Value).replace(/^"(.*)"$/, "$1"));
  if (!jar.size) throw new Error(`Amazon returned no cookies; ${SIGN_IN_AGAIN}.`);
  const cookie = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  // The Alexa site sets its CSRF cookie on the first page it serves.
  for (const page of ["/api/language", "/spa/index.html", "/api/strings", "/templates/oobe/d-device-pick.handlebars"]) {
    const res = await fetch(`https://alexa.${state.domain}${page}`, {
      headers: { Cookie: cookie(), "User-Agent": USER_AGENT }, redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
    for (const line of res.headers.getSetCookie()) {
      const pair = line.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    const csrf = jar.get("csrf");
    if (csrf) return { domain: state.domain, cookie: cookie(), csrf };
  }
  throw new Error(`The Alexa site gave no CSRF token; ${SIGN_IN_AGAIN}.`);
}

async function alexaPost(session: AlexaSession, path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`https://alexa.${session.domain}${path}`, {
    method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    headers: {
      Cookie: session.cookie, csrf: session.csrf, "Content-Type": "application/json",
      Accept: "application/json", "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`Alexa ${path} answered ${response.status}.`);
  return response.json();
}

const DEVICES_QUERY = `query CustomerSmartHome {
  endpoints(endpointsQueryParams: { paginationParams: { disablePagination: true } }) {
    items { legacyAppliance { applianceId applianceTypes friendlyName friendlyDescription entityId capabilities } }
  }
}`;

// Alexa names each monitor reading by an asset id.
const METRICS: Record<string, string> = {
  "Alexa.AirQuality.ParticulateMatter": "pm25",
  "Alexa.AirQuality.VolatileOrganicCompounds": "voc",
  "Alexa.AirQuality.CarbonMonoxide": "co",
  "Alexa.AirQuality.Humidity": "humidity",
  "Alexa.AirQuality.IndoorAirQuality": "iaq",
};

export interface AirMonitor {
  entityId: string;
  name: string;
  sensors: { instance: string; metric: string }[];
}

/** Air quality monitors in the account's smart home device list. */
export function airMonitors(devices: any): AirMonitor[] {
  const monitors: AirMonitor[] = [];
  for (const item of devices?.data?.endpoints?.items ?? []) {
    const appliance = item?.legacyAppliance;
    if (!appliance?.entityId || !(appliance.applianceTypes ?? []).includes("AIR_QUALITY_MONITOR")) continue;
    const sensors: AirMonitor["sensors"] = [];
    for (const cap of appliance.capabilities ?? []) {
      if (cap?.interfaceName !== "Alexa.RangeController" || cap.instance === undefined || cap.instance === null) continue;
      const ids = (cap.resources?.friendlyNames ?? []).map((n: any) => n?.value?.assetId ?? n?.assetId);
      const asset = ids.find((id: unknown) => typeof id === "string" && id in METRICS);
      if (asset) sensors.push({ instance: String(cap.instance), metric: METRICS[asset] });
    }
    monitors.push({ entityId: String(appliance.entityId), name: String(appliance.friendlyName ?? "Air quality monitor"), sensors });
  }
  return monitors;
}

export interface AirReading {
  measuredAt: string;
  metric: string;
  value: number;
}

/** The monitor's current readings, each with the time the monitor took it. */
export function airReadings(state: any, monitor: AirMonitor): AirReading[] {
  const readings: AirReading[] = [];
  for (const device of state?.deviceStates ?? []) {
    for (const raw of device?.capabilityStates ?? []) {
      let cap: any;
      try {
        cap = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        continue;
      }
      const at = new Date(String(cap?.timeOfSample ?? ""));
      if (Number.isNaN(at.getTime())) continue;
      let metric: string | undefined;
      let value = Number.NaN;
      if (cap.namespace === "Alexa.RangeController" && cap.name === "rangeValue") {
        metric = monitor.sensors.find((s) => s.instance === String(cap.instance))?.metric;
        value = Number(cap.value);
      } else if (cap.namespace === "Alexa.TemperatureSensor" && cap.name === "temperature") {
        metric = "temperature";
        value = Number(cap.value?.value);
        if (cap.value?.scale === "FAHRENHEIT") value = ((value - 32) * 5) / 9;
      }
      if (metric && Number.isFinite(value)) readings.push({ measuredAt: at.toISOString(), metric, value: round(value, 2) });
    }
  }
  return readings;
}

// Only these readings enter the model; the others are kept for descriptions.
const DAILY_AIR: Record<string, string> = { pm25: "indoor_pm25", voc: "indoor_voc" };
export const MIN_AIR_HOURS = 12;

/**
 * Daily means of the readings for local calendar days with at least
 * MIN_AIR_HOURS sampled hours; each hour counts once, whatever its sample count.
 */
export function dailyAirMeans(readings: { measured_at: string; metric: string; value: number }[], timeZone: string): Map<string, Record<string, number>> {
  const hourly = new Map<string, number[]>(); // day|metric|hour
  for (const r of readings) {
    const field = DAILY_AIR[r.metric];
    if (!field) continue;
    const at = new Date(r.measured_at);
    const key = `${localDate(at, timeZone)}|${field}|${Math.floor(at.getTime() / 3_600_000)}`;
    hourly.set(key, [...(hourly.get(key) ?? []), r.value]);
  }
  const daily = new Map<string, number[]>(); // day|field -> hourly means
  for (const [key, values] of hourly) {
    const dayField = key.slice(0, key.lastIndexOf("|"));
    daily.set(dayField, [...(daily.get(dayField) ?? []), values.reduce((a, b) => a + b, 0) / values.length]);
  }
  const days = new Map<string, Record<string, number>>();
  for (const [dayField, means] of daily) {
    if (means.length < MIN_AIR_HOURS) continue;
    const [day, field] = dayField.split("|");
    days.set(day, { ...days.get(day), [field]: round(means.reduce((a, b) => a + b, 0) / means.length, 1) });
  }
  return days;
}

/** Store the monitor's current readings, then the means of the last complete days. */
export async function syncIndoorAir(): Promise<string> {
  if (!existsSync(ALEXA_FILE)) return "Indoor air is off (run `node scripts/cli.ts alexa-login`).";
  const user = participant();
  if (!user) return "Indoor air: no account yet.";
  const state = JSON.parse(readFileSync(ALEXA_FILE, "utf8")) as AlexaState;
  const session = await alexaSession(state);
  const monitor = airMonitors(await alexaPost(session, "/nexus/v1/graphql", { query: DEVICES_QUERY }))[0];
  if (!monitor) return "Indoor air: no Amazon air quality monitor on this account.";
  const readings = airReadings(
    await alexaPost(session, "/api/phoenix/state", { stateRequests: [{ entityId: monitor.entityId, entityType: "ENTITY" }] }),
    monitor,
  );
  for (const r of readings) {
    run("INSERT INTO air_readings (user_id, measured_at, metric, value) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING", user.id, r.measuredAt, r.metric, r.value);
  }
  const today = localDate(new Date(), user.time_zone);
  const since = new Date(Date.parse(`${addDays(today, -4)}T00:00:00Z`)).toISOString();
  const rows = all<{ measured_at: string; metric: string; value: number }>(
    "SELECT measured_at, metric, value FROM air_readings WHERE user_id = ? AND measured_at >= ?", user.id, since,
  );
  let changed = 0;
  for (const [day, values] of dailyAirMeans(rows, user.time_zone)) {
    if (day < today && day >= addDays(today, -3) && mergeDaily(user.id, day, inRange(values))) changed++;
  }
  return `Indoor air (${monitor.name}): ${readings.length} reading(s) stored, ${changed} day(s) updated.`;
}
