-- Schema for A Study On Myself. The web app is the only writer; the R analysis reads.
-- Timestamps are ISO 8601 in UTC; dates are YYYY-MM-DD study dates.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  day_start_hour INTEGER NOT NULL DEFAULT 4 CHECK (day_start_hour BETWEEN 0 AND 11),
  study_start TEXT,
  reminder_times TEXT NOT NULL DEFAULT '["10:30","15:30","21:00"]',
  reminders_on INTEGER NOT NULL DEFAULT 1 CHECK (reminders_on IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  flash TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS device_tokens (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT
);

-- One momentary mood report. Reports are never edited, only deleted.
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating IN (1, 2, 3)),
  recorded_at TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  study_date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'afternoon', 'evening')),
  note TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'web',
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, client_id)
);
CREATE INDEX IF NOT EXISTS ratings_by_day ON ratings (user_id, study_date);

-- Everything known about one study day. Sleep describes the night that ended
-- on the morning of `date`; behavior fields are totals for `date` itself.
CREATE TABLE IF NOT EXISTS daily_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  sleep_hours REAL CHECK (sleep_hours BETWEEN 0 AND 24),
  sleep_efficiency REAL CHECK (sleep_efficiency BETWEEN 0 AND 100),
  hrv_ms REAL CHECK (hrv_ms BETWEEN 1 AND 300),
  resting_hr REAL CHECK (resting_hr BETWEEN 25 AND 200),
  skin_temp_dev_c REAL CHECK (skin_temp_dev_c BETWEEN -5 AND 5),
  steps INTEGER CHECK (steps BETWEEN 0 AND 200000),
  exercise_min INTEGER CHECK (exercise_min BETWEEN 0 AND 1440),
  outdoor_min INTEGER CHECK (outdoor_min BETWEEN 0 AND 1440),
  social_min INTEGER CHECK (social_min BETWEEN 0 AND 1440),
  screen_time_min INTEGER CHECK (screen_time_min BETWEEN 0 AND 1440),
  social_media_min INTEGER CHECK (social_media_min BETWEEN 0 AND 1440),
  caffeine_mg INTEGER CHECK (caffeine_mg BETWEEN 0 AND 2000),
  alcohol_units REAL CHECK (alcohol_units BETWEEN 0 AND 50),
  work_day INTEGER CHECK (work_day IN (0, 1)),
  travel INTEGER CHECK (travel IN (0, 1)),
  sick INTEGER CHECK (sick IN (0, 1)),
  temp_mean_c REAL CHECK (temp_mean_c BETWEEN -60 AND 60),
  precipitation_mm REAL CHECK (precipitation_mm BETWEEN 0 AND 500),
  sunshine_hours REAL CHECK (sunshine_hours BETWEEN 0 AND 24),
  daylight_hours REAL CHECK (daylight_hours BETWEEN 0 AND 24),
  pm25 REAL CHECK (pm25 BETWEEN 0 AND 1000),
  indoor_pm25 REAL CHECK (indoor_pm25 BETWEEN 0 AND 1000),
  indoor_voc REAL CHECK (indoor_voc BETWEEN 0 AND 1000),
  day_satisfaction INTEGER CHECK (day_satisfaction BETWEEN 0 AND 10),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, date)
);

-- Web push subscriptions of the phone's Home Screen app (endpoint and keys only).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_status INTEGER
);

-- Reminders sent, at most one per slot, so a report can be told apart as
-- answering a reminder or not.
CREATE TABLE IF NOT EXISTS reminders (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  study_date TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('morning', 'afternoon', 'evening')),
  sent_at TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, study_date, slot)
);

-- Indoor air from the Amazon monitor: one row per metric per sample, taken
-- hourly while the computer is awake. Daily means go to daily_logs.
CREATE TABLE IF NOT EXISTS air_readings (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  measured_at TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('pm25', 'voc', 'co', 'humidity', 'temperature', 'iaq')),
  value REAL NOT NULL,
  PRIMARY KEY (user_id, measured_at, metric)
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('running', 'done', 'waiting', 'failed')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at TEXT,
  n_ratings INTEGER NOT NULL DEFAULT 0,
  n_days INTEGER NOT NULL DEFAULT 0,
  data_fingerprint TEXT NOT NULL DEFAULT '',
  results TEXT NOT NULL DEFAULT '{}',
  message TEXT NOT NULL DEFAULT ''
);
