// Configuration from environment variables, optionally read from .env in the
// repository root (variables already set win). Personal data lives in DATA_DIR,
// outside the repository, so it can never be committed.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

const envFile = process.env.ASOM_ENV_FILE ?? path.join(ROOT, ".env");
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;
const expandHome = (p: string): string => (p.startsWith("~/") ? path.join(homedir(), p.slice(2)) : p);

// Every file this app creates (database, logs, backups) is private to the user.
process.umask(0o077);

export const DATA_DIR = expandHome(env("ASOM_DATA_DIR", path.join(homedir(), ".astudyonmyself")));
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
chmodSync(DATA_DIR, 0o700);

export const DB_PATH = path.join(DATA_DIR, "study.db");
export const PORT = Number(env("PORT", "8000"));

// The HTTPS name the phone uses (from `tailscale serve`). The app itself only
// listens on 127.0.0.1; requests for any other host are refused.
export const ASOM_HOST = env("ASOM_HOST");
export const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", ...(ASOM_HOST ? [ASOM_HOST] : [])]);
export const SECURE_COOKIES = Boolean(ASOM_HOST);

export const DEFAULT_TIME_ZONE = env("TIME_ZONE", Intl.DateTimeFormat().resolvedOptions().timeZone);

// Weather and outdoor PM2.5 from Open-Meteo; rounded to about 1 km before sending.
export const WEATHER_LATITUDE = env("WEATHER_LATITUDE");
export const WEATHER_LONGITUDE = env("WEATHER_LONGITUDE");

// Public results page: a local clone of the GitHub Pages repository and the
// folder inside it. Only estimates are published, never data.
export const PUBLISH_DIR = env("PUBLISH_DIR") ? expandHome(env("PUBLISH_DIR")) : "";
export const PUBLISH_SUBDIR = env("PUBLISH_SUBDIR", "astudyonmyself");

export const BACKUP_DIR = expandHome(env("ASOM_BACKUP_DIR", path.join(DATA_DIR, "backups")));
export const BACKUP_GPG_RECIPIENT = env("BACKUP_GPG_RECIPIENT");
export const BACKUP_KEEP = Number(env("BACKUP_KEEP", "30"));

export const RSCRIPT = env("RSCRIPT", "Rscript");

// Ring metrics from the Ultrahuman Partner API (access on request at
// partner.ultrahuman.com). Off when unset.
export const ULTRAHUMAN_TOKEN = env("ULTRAHUMAN_TOKEN");

// Indoor air from an Amazon Smart Air Quality Monitor through the Alexa web
// service. `node scripts/cli.ts alexa-login` saves the sign in to ALEXA_FILE;
// ALEXA_DOMAIN is the Amazon site of the account (amazon.ca for Canada).
export const ALEXA_DOMAIN = env("ALEXA_DOMAIN", "amazon.com");
export const ALEXA_FILE = path.join(DATA_DIR, "alexa.json");

// Who push services can contact about this server's notifications (a VAPID claim).
export const PUSH_CONTACT = env("PUSH_CONTACT", "https://github.com/choxos/AStudyOnMyself");
