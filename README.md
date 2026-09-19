# A Study On Myself

A one-person (N-of-1) study of what goes with my mood. Three times a day I tap Sad, Meh or Happy on my phone; sleep, heart and activity data from the ring and Apple Health, weather, and indoor air quality are collected automatically, and a few things with no sensor (screen time, time with people, caffeine, alcohol) are optional evening entries. A Bayesian ordinal model, written in Stan and run from R, refits by itself whenever new data arrives, and its estimates (never the data) are published live at **https://choxos.github.io/astudyonmyself/**.

Everything runs locally on my Mac: a TypeScript web app on Node.js with no runtime dependencies, and the statistical analysis in R. The study design and analysis plan are in [study_protocol.md](study_protocol.md).

## What it does

- **One-tap mood reports.** `/rate/` is a small web app for the phone's Home Screen: three large buttons, an optional note, and #tags. Every report is saved on the phone first and sent when the server answers, so reports made while the Mac sleeps are not lost and are never stored twice.
- **Daily log.** Last night's sleep, HRV, resting heart rate and skin temperature; the day's steps, exercise, time outdoors, time with people, screen time, social media, caffeine and alcohol; work day, travel and sickness flags; and an evening rating of the day (0 to 10). Automatic sources fill what they can; the rest goes in the evening form at `/log/`.
- **Ring data.** With Ultrahuman Partner API access, the hourly job fetches sleep, sleep efficiency, HRV, resting heart rate, skin temperature and steps. Without it, an iPhone automation sends the same data from Apple Health.
- **Weather and outdoor air.** Daily temperature, precipitation, sunshine, day length and PM2.5 from Open-Meteo (free, no API key).
- **Indoor air.** Hourly PM2.5, VOC, carbon monoxide, humidity and temperature from an Amazon Smart Air Quality Monitor, through the Alexa web service; daily means of PM2.5 and VOC enter the model.
- **Bayesian analysis in R and Stan.** A cumulative logit model of every report with a latent daily mood that carries over between days (AR(1)), time of day and weekday effects, and the day's factors: weakly informative priors on the five confirmatory ones and a hierarchical shrinkage prior on the others. Missing factor values are imputed inside the model. It reports effects as changes in the chance of a Happy report per natural unit, with 95% credible intervals, convergence diagnostics, a posterior predictive check, PSIS-LOO, a forecast for the next day and a what-if calculator. See [the model](#the-model).
- **Trends.** Weekly shares of Happy and Sad reports, breakdowns by time of day and weekday, and tag comparisons from Beta posteriors (computed in R with each analysis run).
- **Public results.** After each successful refit, a whitelist of estimates (effects, intervals, time of day and weekday effects, mood dynamics, convergence checks and the number of reports and days) is pushed to the page above. Reports, notes, tags, daily values and derived daily series stay on the Mac; a test enforces the whitelist.

## Privacy and security

| Concern | What the app does |
|---|---|
| Where data lives | `~/.astudyonmyself/` (folder 0700, files 0600), outside the repository. The Mac's disk is encrypted with FileVault. |
| Who can connect | The server listens on `127.0.0.1` only and refuses requests for any host but `localhost`, `127.0.0.1` and your Tailscale name. The phone reaches it through `tailscale serve`, limited to your own tailnet over WireGuard. Nothing is exposed to the internet (do not use `tailscale funnel`). |
| Sign in | scrypt password hashes (12 characters minimum), 10 failed attempts lock sign in for 15 minutes, 60-day sessions stored only as hashes, a CSRF token on every change, Secure cookies over HTTPS. |
| Phone shortcuts | Device tokens are stored only as SHA-256 hashes and can only add data. A lost token cannot read your history. Revoke tokens in Settings. |
| The browser | Every value on a page is HTML-escaped; a strict Content Security Policy, no CDN or third-party scripts, no framing, and `no-store` caching for every page with data. |
| Software supply chain | The server uses only Node's built-in modules (`node:http`, `node:sqlite`, `node:crypto`); `npm install` fetches TypeScript for type checking and nothing else. The analysis uses Stan and a handful of R packages from the Stan team. |
| What leaves the Mac | Only (1) your location rounded to about 1 km, sent to Open-Meteo if weather is on, (2) requests for your own data to Ultrahuman and Amazon, which already hold it, (3) reminder notifications, encrypted for your phone and passed on by Apple's push service, and (4) the whitelisted estimates pushed to GitHub Pages. The Ultrahuman token is in `.env` and the Amazon sign in in `~/.astudyonmyself/alexa.json`, both readable only by you. |
| Backups | `node scripts/cli.ts backup` writes a GPG-encrypted snapshot, taken with SQLite's online backup; the hourly job does it daily once a key is set. Set it up unless the Mac is backed up some other way. |
| Your rights | Export everything as CSV or JSON, or delete all data, from Settings. |

Two things worth knowing: Tailscale HTTPS certificates publish the machine name in public Certificate Transparency logs, and anyone can read the public results page by design.

## First-time checklist

After the setup below, these steps need your own accounts, once:

1. **Your login.** `scripts/create-user.sh` asks for a username and password (the password never reaches your shell history); `--reset` changes it.
2. **Tailscale Serve.** Run the command below, approve Serve and HTTPS certificates for your tailnet at the link it prints, then run it again:
   ```sh
   /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg 8000
   ```
   The app is then at `https://<your-mac>.<your-tailnet>.ts.net/`; put that name in `.env` as `ASOM_HOST`. Use that address on the Mac too: with `ASOM_HOST` set, cookies are Secure, so signing in over `http://127.0.0.1:8000` works in Chrome but not in Safari.
3. **Weather.** Put your location, rounded to two decimals, in `.env` (`WEATHER_LATITUDE`, `WEATHER_LONGITUDE`).
4. **Backups.** Create a key and put its fingerprint in `.env` as `BACKUP_GPG_RECIPIENT`, and set `ASOM_BACKUP_DIR` to a folder in iCloud Drive so the encrypted copies leave the Mac:
   ```sh
   gpg --quick-generate-key "AStudyOnMyself backup"
   gpg --list-keys "AStudyOnMyself backup"
   gpg --export-secret-keys --armor "AStudyOnMyself backup"   # store this in your password manager
   ```
   Restoring needs the private key and its passphrase (`gpg --decrypt study-*.db.gpg > study.db`); without them the backups cannot be opened.
5. **Ring data.** Create a Personal API Token with the "Ring Data Access" scope in the Ultrahuman Vision developer portal (https://vision.ultrahuman.com/developer/docs) and confirm the 6-character passcode in the Ultrahuman app. Put the token in `.env` as `ULTRAHUMAN_TOKEN`, run the installer again and check with `node scripts/cli.ts sync-ring 7`. Without a token, and for exercise and time in daylight in any case, use the Apple Health automation below. The protocol fixes each factor's source at the study start, so set this up before it.
6. **Indoor air.** Run `node scripts/cli.ts alexa-login` in this folder (set `ALEXA_DOMAIN=amazon.ca` in `.env` first if your Alexa account is Canadian). It prints an Amazon address: sign in there in your browser, then copy the address of the empty page you land on and paste it back. Your password goes only to Amazon. The app appears in your Amazon account's device list as "A Study On Myself"; deregistering it there revokes the sign in.
7. **Study start.** When the protocol is finalized, set the study start in Settings to the day after; earlier reports are pilot data and never enter a model.

Run `scripts/install-launchd.sh` again after every change to `.env`.

## Setting it up from scratch

Requirements: Node.js 24 or newer (it runs TypeScript directly), R 4.4 or newer with CmdStan, and git and gpg for publishing and backups.

```sh
npm install                        # TypeScript, for type checking only
Rscript -e 'install.packages(c("posterior", "loo", "jsonlite", "DBI", "RSQLite", "testthat"))'
Rscript -e 'install.packages("cmdstanr", repos = c("https://stan-dev.r-universe.dev", getOption("repos"))); cmdstanr::install_cmdstan()'
cp .env.example .env               # then edit it
scripts/create-user.sh
scripts/install-launchd.sh         # web server on 127.0.0.1:8000 and the hourly job
```

macOS keeps background processes out of `~/Documents`, so `install-launchd.sh` copies the app to `~/.astudyonmyself/app` and the agents run from there. **Run it again after changing the code or `.env`.** `scripts/install-launchd.sh --remove` uninstalls the agents. Logs are in `~/.astudyonmyself/logs`. For development, `npm start` runs the server from the repository.

## Using it from the iPhone

**Home Screen app.** Open `https://<your-mac>.<your-tailnet>.ts.net/rate/` in Safari, sign in, then Share, Add to Home Screen. Tailscale must be connected on the phone for reports to be sent; if it is not, they wait on the phone.

**Reminders.** The app sends a push notification at your time for each slot (Settings, Reminders; 10:30, 15:30 and 21:00 by default), only while that slot has no report, and tapping it opens `/rate/`. It needs iOS 16.4 or later, the app opened from its Home Screen icon over HTTPS (so Tailscale Serve first), and a tap on "Turn on for this device" in Settings there. The Mac must be awake to send them; a slot that came due while it slept is reminded when it wakes, if the slot is still open. As a fallback, a Shortcuts automation (Automation, Time of Day, Run Immediately) can open the `/rate/` URL at the same times. The study day starts at 4 AM, so a report at 1 AM counts toward the previous evening. Slots: morning 4 AM to noon, afternoon noon to 6 PM, evening after 6 PM.

**One-tap report without opening the app** (Action Button, Apple Watch, widget). Create a device token in Settings, then build a Shortcut: Choose from Menu with Happy, Meh and Sad; in each branch, Get Contents of URL:

- URL: `https://<your-mac>.<your-tailnet>.ts.net/api/ratings/`
- Method: POST; Header `Authorization`: `Bearer <token>`
- Request Body: JSON with `rating` = 3, 2 or 1 and `source` = `shortcut`

**Health data from Apple Health, automatically.** Turn on Apple Health in the Ultrahuman app so the ring writes sleep and heart data there. Create a device token in Settings, then build a Shortcut that uses Find Health Samples and Calculate Statistics and posts two requests with the token:

```
POST https://<your-mac>.<your-tailnet>.ts.net/api/daily/
Authorization: Bearer <token>
Content-Type: application/json

{"date": "<today>", "sleep_hours": 7.2, "sleep_efficiency": 91, "hrv_ms": 48, "resting_hr": 56}
{"date": "<yesterday>", "steps": 8123, "exercise_min": 34, "outdoor_min": 75}
```

In every Find Health Samples action, filter by Source: the Ultrahuman app for sleep, HRV, resting heart rate and steps, the Apple Watch for exercise minutes and time in daylight, so the same period is never counted twice from two devices. Sleep and overnight values belong to the date you woke up: sum the asleep samples from 6 PM to noon, take sleep efficiency as asleep time over time in bed, HRV as the mean of the night's samples and the day's resting heart rate. Steps, exercise minutes and time in daylight (an Apple Watch measures it) are yesterday's totals, sent with yesterday's date. The protocol's data dictionary (Appendix A) defines every field. With `ULTRAHUMAN_TOKEN` set, leave out the fields the ring API already sends (sleep, efficiency, HRV, resting heart rate, skin temperature, steps), so each field keeps one source. To make it automatic: Shortcuts, Automation, Time of Day, Run Immediately. Health data cannot be read while the iPhone is locked, so choose a time when you usually use the phone, or run it from the morning reminder automation before it opens `/rate/`. Apple Health stores heart rate variability as SDNN while ring apps usually show RMSSD; keep one for the whole study. Only the fields you send change, so the automation, the ring API and the evening form never overwrite each other. Screen Time has no API on iOS; copy the totals from Settings, Screen Time into the evening log.

Accepted fields for `/api/daily/`: `sleep_hours`, `sleep_efficiency`, `hrv_ms`, `resting_hr`, `skin_temp_dev_c`, `steps`, `exercise_min`, `outdoor_min`, `social_min`, `screen_time_min`, `social_media_min`, `caffeine_mg`, `alcohol_units`, `work_day`, `travel`, `sick`, `day_satisfaction`, `note`, and the weather and indoor air fields.

## The model

Every report `y` (Sad < Meh < Happy) is modeled with a cumulative logit ([analysis/mood.stan](analysis/mood.stan)):

```
P(y <= k) = logistic(c_k - eta),  k = 1, 2
eta = time_of_day + weekday + x_d' beta + u_d
u_d = phi * u_(d-1) + sigma * e_d          latent daily mood, AR(1)
```

- Priors: ordered cutpoints `c ~ N((-1, 1), 1.5)`; time of day and weekday effects are sum-to-zero vectors with `normal(0, 0.5)` priors; `(phi + 1) / 2 ~ Beta(2, 2)`, so carry-over can be negative; `sigma ~ HalfNormal(1)`; on standardized predictors, `normal(0, 0.5)` for the five confirmatory factors and `beta_j = tau * z_j`, `z_j ~ N(0, 1)`, `tau ~ HalfNormal(0.5)` for the others.
- Timing: a factor enters only with information available before the day's reports. Sleep, HRV and resting heart rate describe the night before; steps, exercise, screen time, caffeine, alcohol, time with people and indoor air enter as yesterday's values; weather and the work, travel and sick flags enter as same-day context. A day's indoor mean needs readings from at least 12 hours.
- Missing values: factors recorded on fewer than half of the days with reports are left out; the rest are imputed as `N(0, 1)` parameters (missing at random).
- Estimates: odds ratios per natural unit, and the average change in the chance of a Happy (and a Sad) report, with 95% intervals. "Evidence" is the posterior probability of the direction shown: strong at 97.5%, moderate at 90%, weak at 75%.
- Fitting: Stan via cmdstanr, 4 chains of 2,000 draws after 2,000 warmup iterations, `adapt_delta` 0.95; a fit that fails the convergence checks is flagged and never published; R-hat, bulk and tail ESS, divergences and PSIS-LOO are reported with every fit. The compiled model is cached in `~/.astudyonmyself/stan`, so only the first fit pays the compile time.
- Updating: the hourly job refits on all data whenever the data (or the analysis code) change, a full Bayesian update. The model starts after 30 reports on 14 days.
- Division of labor: [analysis/refit.R](analysis/refit.R) reads the database read-only and writes JSON; the web app stores it, and computes what-if answers from the saved posterior draws.

The effects are associations in observational data from one person, conditional on the other factors. For causal questions, run a small randomized N-of-1 experiment (see the protocol).

## Commands

| Command | What it does |
|---|---|
| `node scripts/cli.ts refit` | Fit the model now (and publish the results). |
| `node scripts/cli.ts maintain` | The hourly job: weather, ring data, indoor air, refit if data changed, publish, daily backup. |
| `node scripts/cli.ts sync-weather [DAYS]` | Fill weather and PM2.5 for recent complete days. |
| `node scripts/cli.ts sync-ring [DAYS]` | Fetch Ultrahuman ring metrics for recent days (needs `ULTRAHUMAN_TOKEN`). |
| `node scripts/cli.ts alexa-login` | Sign in to Amazon once for the indoor air monitor. |
| `node scripts/cli.ts sync-air` | Read the indoor air monitor now. |
| `node scripts/cli.ts backup` | Encrypted database snapshot to `ASOM_BACKUP_DIR`. |
| `node scripts/cli.ts publish` | Push the public page now. |
| `npm test` and `npm run typecheck` | The web app's tests (Node's built-in runner) and the TypeScript type check. |
| `npm run test:r` | The R tests; add `ASOM_SLOW_TESTS=1` to include a model fit on simulated data. |
| `Rscript analysis/simulate.R [--days 120] [--seed 7]` | Simulate a study with known effects and show whether the model recovers them. |
| `Rscript analysis/design.R [--reps 50] [--days 180,365]` | The protocol's design analysis: how often effects of known size are found. |

Deleting or fixing a report older than 30 days (the `/ratings/` page covers the last 30): `sqlite3 ~/.astudyonmyself/study.db "DELETE FROM ratings WHERE id = <id>;"`.

## Known limits

- When the MacBook sleeps the server is unreachable. Reports wait on the phone, but daily Shortcuts fail until it wakes, and indoor air is sampled only while it is awake. A small always-on computer on the tailnet could host the app around the clock (same code; systemd instead of launchd).
- The Alexa connection is unofficial and can stop working when Amazon changes its service; the hourly log then says so, and `alexa-login` signs in again.
- Reminders fire at fixed times rather than random ones, which can tie mood to habitual moments; the protocol discusses this.
- Weather is for the configured location, even while traveling.
- A failed refit is retried when the data next change, not on a timer.
- `day_satisfaction` is collected as a secondary outcome but not modeled yet.

## Project layout

```
server/      TypeScript web app: routing and security (http.ts), auth, pages, API, refit orchestration,
             weather, publishing and backups, ring and indoor air sources (sources.ts);
             schema.sql is the database schema
scripts/     command line (cli.ts), create-user.sh, launchd agents and their installer
analysis/    R and Stan: mood.stan, mood.R (data preparation and summaries), refit.R, simulate.R,
             design.R (the protocol's design analysis), tests
peer-review/ the protocol's review record: prompts, reviewer reports, responses and the scripts that ran them
static/      CSS, browser JavaScript (charts, offline rating queue, service worker), icons
site/        the public results page
tests/       the web app's tests
```

## License

GNU General Public License v3.0; see [LICENSE](LICENSE).
