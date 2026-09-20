// Page templates. Every interpolation goes through html``, which escapes it.
import type { Run } from "./analysis.ts";
import type { Session } from "./auth.ts";
import { html, type Html, jsonScript } from "./html.ts";
import type { Shares } from "./stats.ts";
import { type DailyValue, type FieldSpec, LOG_SECTIONS, WEEKDAYS } from "./study.ts";

const pct = (x: number | null | undefined): string => (x === null || x === undefined ? "·" : `${Math.round(x * 100)}%`);
const fixed = (x: number, digits: number): string => Number(x).toFixed(digits);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const longDate = (iso: string): string =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDate = (iso: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const stamp = (iso: string | null, timeZone: string): string =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }) : "";
const face = (rating: number): string => ["😞", "😐", "🙂"][rating - 1];
const csrfField = (session: Session | null, token?: string) => html`<input type="hidden" name="csrf" value="${session?.csrf ?? token ?? ""}">`;

interface LayoutOptions {
  title: string;
  session: Session | null;
  active?: string;
  scripts?: string[];
  nav?: "full" | "rate" | "none";
  csrf?: string;
}

export function layout(o: LayoutOptions, body: Html): Html {
  const link = (href: string, name: string, label: string) =>
    html`<a href="${href}" ${o.active === name ? html`aria-current="page"` : ""}>${label}</a>`;
  const nav =
    o.nav === "none" ? "" :
    o.nav === "rate" ? html`<nav class="nav" aria-label="Main"><span class="brand">How do you feel?</span><a href="/">Dashboard</a></nav>` :
    html`<nav class="nav" aria-label="Main">
    <a class="brand" href="/">A Study On Myself</a>
    ${link("/", "home", "Today")}${link("/log/", "log", "Daily log")}${link("/trends/", "trends", "Trends")}
    ${link("/analysis/", "analysis", "Analysis")}${link("/settings/", "settings", "Settings")}
    <form method="post" action="/accounts/logout/">${csrfField(o.session)}<button class="link" type="submit">Sign out</button></form>
  </nav>`;
  return html`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="csrf-token" content="${o.session?.csrf ?? o.csrf ?? ""}">
  <meta name="theme-color" content="#2a78d6">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Mood">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/static/icons/icon-180.png">
  <link rel="icon" href="/static/icons/icon-192.png">
  <link rel="stylesheet" href="/static/css/app.css">
  <title>${o.title}</title>
</head>
<body>
  ${nav}
  <main>
    ${o.session?.flash ? html`<ul class="messages"><li>${o.session.flash}</li></ul>` : ""}
    ${body}
  </main>
  ${(o.scripts ?? []).map((src) => html`<script src="${src}"></script>`)}
</body>
</html>`;
}

export function loginPage(o: { csrf: string; next: string; error: string }): Html {
  return layout({ title: "Sign in · A Study On Myself", session: null, nav: "none", csrf: o.csrf }, html`
<div class="card" style="max-width: 380px; margin: 3rem auto;">
  <h1>A Study On Myself</h1>
  <p class="muted">Sign in to record and review your mood data.</p>
  ${o.error ? html`<p role="alert" style="color: var(--bad);">${o.error}</p>` : ""}
  <form method="post" class="stack">
    ${csrfField(null, o.csrf)}
    <input type="hidden" name="next" value="${o.next}">
    <div><label for="username">Username</label><input id="username" name="username" autocomplete="username" autocapitalize="none" required></div>
    <div><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
    <button class="primary" type="submit">Sign in</button>
  </form>
</div>`);
}

function rateWidget(recentTags: string[], reload: boolean): Html {
  return html`<div class="stack" data-rate ${reload ? html`data-reload` : ""}>
  <div class="moods" role="group" aria-label="How do you feel right now?">
    <button type="button" class="mood" data-mood="1"><span class="face" aria-hidden="true">😞</span>Sad</button>
    <button type="button" class="mood" data-mood="2"><span class="face" aria-hidden="true">😐</span>Meh</button>
    <button type="button" class="mood" data-mood="3"><span class="face" aria-hidden="true">🙂</span>Happy</button>
  </div>
  <details>
    <summary>Optional: add a note or tags first</summary>
    <div class="stack" style="margin-top: 0.6rem;">
      <div><label for="rate-note">Note. Words like #work or #friends become tags.</label><textarea id="rate-note" rows="2" maxlength="2000"></textarea></div>
      ${recentTags.length ? html`<div class="row" role="group" aria-label="Recent tags">${recentTags.map((t) => html`<button type="button" data-tag="${t}" aria-pressed="false">#${t}</button>`)}</div>` : ""}
    </div>
  </details>
  <p class="status-line muted small" role="status" data-status></p>
</div>`;
}

export interface RatingRow {
  id: number;
  rating: number;
  slot: string;
  study_date: string;
  recorded_at: string;
  note: string;
  tags: string;
}

function ratingItem(r: RatingRow, timeZone: string, session: Session, next: string): Html {
  const tags = (JSON.parse(r.tags) as string[]).map((t) => `#${t}`).join(" ");
  return html`<li>
  <span aria-hidden="true">${face(r.rating)}</span>
  <span><strong>${["Sad", "Meh", "Happy"][r.rating - 1]}</strong> <span class="muted small">${r.slot}, ${stamp(r.recorded_at, timeZone)}${tags ? ` · ${tags}` : ""}</span>
  ${r.note ? html`<br><span class="small">${r.note}</span>` : ""}</span>
  <form method="post" action="/ratings/${r.id}/delete/">${csrfField(session)}<input type="hidden" name="next" value="${next}">
    <button class="link small" type="submit" aria-label="Delete this report">Delete</button></form>
</li>`;
}

const staleStart = html`<p><span class="badge fail">check</span> The latest fit used another study start than the one now set.
  It is shown until the next refit but is not published and is not used for any decision.</p>`;

// The protocol's safety rule (Section 2.11), on the pages where reports are made.
// It is always in the page, hidden unless the rule is met; rate.js updates it
// after every report the page sends and when the page returns to the screen.
const safetyNotice = (shown: boolean) => html`<section class="card" role="note" data-safety ${shown ? "" : html`hidden`}>
  <h2>A check-in about the last two weeks</h2>
  <p>Many of your recent reports were Sad, or your evening ratings were low. The study plan says this is the moment to talk
    to your family doctor or a mental health professional. If you are in crisis, call or text 988 (Canada and the United States)
    or your local emergency number. The study can pause at any time.</p>
</section>`;

export function homePage(o: {
  session: Session; today: string; slot: string; todayRatings: RatingRow[]; completion: number; total: number;
  ratedDays: number; latest: Run | null; headline: Record<string, any>[]; forecast: [string, number[]][];
  loggedToday: boolean; recentTags: string[]; safety: boolean;
}): Html {
  const answered = new Set(o.todayRatings.map((r) => r.slot));
  const slotMark = (s: string) => `${s} ${answered.has(s) ? "✓" : "·"}`;
  const tz = o.session.user.time_zone;
  return layout({ title: "Today · A Study On Myself", session: o.session, active: "home", scripts: ["/static/js/rate.js"] }, html`
<h1>${longDate(o.today)}</h1>
<p class="muted">It is ${o.slot}. Tap how you feel right now.</p>
${safetyNotice(o.safety)}
<section class="card" aria-label="Rate your mood">${rateWidget(o.recentTags, true)}</section>
<div class="grid">
  <section class="card">
    <h2>Today's reports</h2>
    ${o.todayRatings.length ? html`<ul class="today-list">${o.todayRatings.map((r) => ratingItem(r, tz, o.session, "/"))}</ul>` : html`<p class="muted">No reports yet today.</p>`}
    <p class="small muted">Slots covered: ${slotMark("morning")}, ${slotMark("afternoon")}, ${slotMark("evening")}</p>
    ${o.loggedToday ? "" : html`<p><a href="/log/">Evening check-in: log today</a></p>`}
    <p class="small"><a href="/ratings/">All recent reports</a></p>
  </section>
  <section class="card">
    <h2>Adherence</h2>
    <div class="tiles">
      <div class="tile"><div class="label">Slots answered, last 14 days</div><div class="value">${Math.round(o.completion * 100)}%</div></div>
      <div class="tile"><div class="label">Reports so far</div><div class="value">${o.total}</div></div>
      <div class="tile"><div class="label">Days with reports</div><div class="value">${o.ratedDays}</div></div>
    </div>
  </section>
</div>
<section class="card">
  <h2>What the model says so far</h2>
  ${o.latest ? html`
    ${o.latest.results.diagnostics?.converged ? "" : html`<p><span class="badge fail">check</span> The latest fit failed the convergence checks.
      It is shown here but was not published and is not used for any decision.</p>`}
    ${o.latest.results.data?.study_start === o.session.user.study_start ? "" : staleStart}
    ${o.headline.length ? html`<ul>${o.headline.map((p) => html`<li><span class="badge ${p.direction}">${p.evidence}</span>
      <strong>${p.label}</strong>: ${fixed(p.d_happy_pp.est, 1)} percentage points in the chance of a Happy report, ${p.unit_label}
      (95% interval ${fixed(p.d_happy_pp.lo, 1)} to ${fixed(p.d_happy_pp.hi, 1)}).</li>`)}</ul>`
      : html`<p>No factor has moderate or strong evidence yet. That is normal early on.</p>`}
    <p class="small muted">Fitted ${stamp(o.latest.finished_at, tz)} on ${o.latest.n_ratings} reports. <a href="/analysis/">Full analysis</a></p>`
    : html`<p class="muted">The model starts once there are 30 reports on 14 different days. Keep going.</p>`}
</section>
${o.forecast.length ? html`<section class="card">
  <h2>Tomorrow, if it is an average day</h2>
  <div class="table-wrap"><table>
    <thead><tr><th>Time</th><th class="num">Sad</th><th class="num">Meh</th><th class="num">Happy</th></tr></thead>
    <tbody>${o.forecast.map(([slot, p]) => html`<tr><td>${cap(slot)}</td><td class="num">${pct(p[0])}</td><td class="num">${pct(p[1])}</td><td class="num">${pct(p[2])}</td></tr>`)}</tbody>
  </table></div>
  <p class="small muted">Model forecast using today's known factors and your mood's day to day persistence.</p>
</section>` : ""}`);
}

export function ratePage(o: { session: Session; recentTags: string[]; safety: boolean }): Html {
  return layout({ title: "Mood", session: o.session, nav: "rate", scripts: ["/static/js/rate.js"] }, html`
${safetyNotice(o.safety)}
<section class="card">${rateWidget(o.recentTags, false)}</section>
<p class="small muted">Reports are kept on this device until the server confirms them, so this works even when your Mac is asleep.
Add this page to your Home Screen for one-tap access.</p>`);
}

export function ratingsPage(o: { session: Session; ratings: RatingRow[] }): Html {
  return layout({ title: "Reports · A Study On Myself", session: o.session }, html`
<h1>Reports, last 30 days</h1>
<p class="muted">Delete a mistaken report here. Reports are never edited. Older changes need the sqlite3 command line (see README).</p>
<section class="card">
  ${o.ratings.length ? html`<ul class="today-list">${o.ratings.map((r) => ratingItem(r, o.session.user.time_zone, o.session, "/ratings/"))}</ul>` : html`<p class="muted">No reports in the last 30 days.</p>`}
</section>`);
}

function fieldInput(field: FieldSpec, value: DailyValue | undefined, shown: DailyValue | undefined, error?: string): Html {
  const id = `f-${field.name}`;
  const current = value === null || value === undefined ? "" : String(value);
  const before = shown === null || shown === undefined ? "" : String(shown);
  let input: Html;
  if (field.type === "bool") {
    input = html`<select id="${id}" name="${field.name}">
      <option value="" ${current === "" ? html`selected` : ""}>Unknown</option>
      <option value="1" ${current === "1" ? html`selected` : ""}>Yes</option>
      <option value="0" ${current === "0" ? html`selected` : ""}>No</option></select>`;
  } else if (field.type === "text") {
    input = html`<textarea id="${id}" name="${field.name}" rows="2" maxlength="2000">${current}</textarea>`;
  } else {
    input = html`<input id="${id}" name="${field.name}" type="number" inputmode="decimal" step="${field.type === "int" ? "1" : "any"}" min="${field.min}" max="${field.max}" value="${current}">`;
  }
  return html`<div class="field"><label for="${id}">${field.label}</label>${input}<input type="hidden" name="shown.${field.name}" value="${before}">
    ${field.help ? html`<div class="help">${field.help}</div>` : ""}${error ? html`<ul class="errorlist"><li>${error}</li></ul>` : ""}</div>`;
}

export function logPage(o: {
  session: Session; day: string; values: Record<string, DailyValue>; original: Record<string, DailyValue>;
  errors: Record<string, string>; previous: string; next: string | null;
}): Html {
  return layout({ title: "Daily log · A Study On Myself", session: o.session, active: "log" }, html`
<h1>Daily log: ${longDate(o.day)}</h1>
<p class="row small"><a href="?date=${o.previous}">← ${shortDate(o.previous)}</a>${o.next ? html` <a href="?date=${o.next}">${shortDate(o.next)} →</a>` : ""}</p>
<p class="muted">Fill in what you know; leave the rest blank. Sleep describes the night that ended this morning.
Values from the ring, Apple Health, the weather service and the air monitor appear here too; saving changes only the fields you edit. Blank is better than a guess.</p>
<form method="post">
  ${csrfField(o.session)}<input type="hidden" name="date" value="${o.day}">
  ${LOG_SECTIONS.map((section) => html`<fieldset><legend>${section.title}</legend><div class="fields">
    ${section.fields.map((f) => fieldInput(f, o.values[f.name], o.original[f.name], o.errors[f.name]))}</div></fieldset>`)}
  <button class="primary" type="submit">Save</button>
</form>`);
}

const sharesRow = (label: string, s: Shares) =>
  html`<tr><td>${cap(label)}</td><td class="num">${s.n}</td><td class="num">${pct(s.sad)}</td><td class="num">${pct(s.meh)}</td><td class="num">${pct(s.happy)}</td></tr>`;
const sharesTable = (rows: (Shares & { label: string })[], first: string) => html`<div class="table-wrap"><table>
  <thead><tr><th>${first}</th><th class="num">Reports</th><th class="num">Sad</th><th class="num">Meh</th><th class="num">Happy</th></tr></thead>
  <tbody>${rows.map((r) => sharesRow(r.label, r))}</tbody></table></div>`;

export function trendsPage(o: {
  session: Session; weekly: unknown; total: Shares; bySlot: (Shares & { label: string })[]; byWeekday: (Shares & { label: string })[];
  adherence: { week: string; answered: number; eligible: number; share: number }[];
  prompted: { reports: number; prompted: number };
  completeness: { of: number; rows: { label: string; days: number; share: number }[] };
  tags: Record<string, any>[]; tagsAsOf: string | null;
}): Html {
  const recent = o.adherence.slice(-12).reverse();
  return layout({ title: "Trends · A Study On Myself", session: o.session, active: "trends", scripts: ["/static/js/charts.js", "/static/js/trends.js"] }, html`
<h1>Trends</h1>
<p class="muted">Plain descriptive summaries of your reports. The Bayesian model on the Analysis page adjusts for everything at once.</p>
<section class="card">
  <h2>Share of Happy and Sad reports per week</h2>
  ${o.total.n ? html`<div class="chart" id="weekly-chart"></div><p class="small muted">Weeks with fewer than 3 reports are left blank.</p>` : html`<p class="muted">No reports yet.</p>`}
</section>
<section class="card">
  <h2>Adherence per week</h2>
  ${recent.length ? html`<p class="small muted">Slots with at least one report, out of the slots since the study start. The protocol reviews
    the reminders when two weeks in a row fall below 50%.</p>
  <div class="table-wrap"><table>
    <thead><tr><th>Week of</th><th class="num">Slots answered</th><th class="num">Share</th></tr></thead>
    <tbody>${recent.map((w) => html`<tr><td>${shortDate(w.week)}</td><td class="num">${w.answered} of ${w.eligible}</td>
      <td class="num">${pct(w.share)}${w.share < 0.5 ? " (below 50%)" : ""}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">No reports yet.</p>`}
  ${o.prompted.reports ? html`<p class="small muted">${o.prompted.prompted} of ${o.prompted.reports} reports came within an hour after a reminder.</p>` : ""}
</section>
<section class="card">
  <h2>Completeness of the daily factors</h2>
  ${o.completeness.of ? html`<p class="small muted">Days with a value, out of the ${o.completeness.of} finished day(s) since the study start.
    A factor recorded on fewer than half of the days with reports is left out of the model.</p>
  <details><summary>Table</summary><div class="table-wrap"><table>
    <thead><tr><th>Factor</th><th class="num">Days</th><th class="num">Share</th></tr></thead>
    <tbody>${o.completeness.rows.map((c) => html`<tr><td>${c.label}</td><td class="num">${c.days}</td>
      <td class="num">${pct(c.share)}${c.share < 0.5 ? " (below half)" : ""}</td></tr>`)}</tbody></table></div></details>`
  : html`<p class="muted">Shown from the second study day on.</p>`}
</section>
<div class="grid">
  <section class="card"><h2>By time of day</h2>${sharesTable(o.bySlot, "Slot")}</section>
  <section class="card"><h2>By weekday</h2>${sharesTable(o.byWeekday, "Day")}</section>
</div>
<section class="card">
  <h2>Tags and the chance of a Happy report</h2>
  ${o.tags.length ? html`
  <p class="small muted">Difference in the share of Happy reports when a tag is present versus absent, with 95% intervals from Beta(1, 1)
    posteriors computed in R${o.tagsAsOf ? `, as of ${o.tagsAsOf}` : ""}. Same-moment associations: a tag can be a cause of mood or a consequence of it.</p>
  <div class="chart" id="tags-chart"></div>
  <details><summary>Table view</summary><div class="table-wrap"><table>
    <thead><tr><th>Tag</th><th class="num">Uses</th><th class="num">Happy with</th><th class="num">Happy without</th><th class="num">Difference</th></tr></thead>
    <tbody>${o.tags.map((t) => html`<tr><td>#${t.tag}</td><td class="num">${t.n}</td><td class="num">${pct(t.p_with)}</td><td class="num">${pct(t.p_without)}</td>
      <td class="num">${fixed(t.est, 1)} pp (${fixed(t.lo, 1)} to ${fixed(t.hi, 1)})</td></tr>`)}</tbody></table></div></details>`
  : html`<p class="muted">Tags appear here once one has been used at least 5 times (updated with each analysis run). Add them with #words in a report's note.</p>`}
</section>
${jsonScript("weekly-data", o.weekly)}
${jsonScript("tags-data", o.tags)}`);
}

const badgeFor = (p: Record<string, any>) => (p.evidence === "strong" || p.evidence === "moderate" ? p.direction : "");

interface PpcRow { observed: number[]; predicted: number[]; lo: number[]; hi: number[]; fails?: boolean[] }

export function analysisPage(o: {
  session: Session; latestAny: Run | null; latest: Run | null; waiting: boolean; charts: unknown;
  history: { started_at: string; status: string; n_ratings: number; n_days: number }[];
  whatIfFields: { field: string; label: string; mean: number; value: string; binary: boolean; unit: string }[];
  whatIfWeekday: number; whatIf: [string, number[]][] | null; error: string;
}): Html {
  const tz = o.session.user.time_zone;
  const running = o.latestAny?.status === "running" || o.waiting;
  const r = o.latest?.results;
  const statusLine =
    running ? html`<span class="badge warn">running</span> Fitting the model in R; this page reloads when it finishes (about a minute).` :
    o.latestAny?.status === "waiting" ? html`<span class="badge">waiting</span> ${o.latestAny.message}` :
    o.latestAny?.status === "failed" ? html`<span class="badge fail">failed</span> The last refit failed: ${o.latestAny.message}` :
    o.latest ? html`<span class="badge ok">up to date</span> Fitted ${stamp(o.latest.finished_at, tz)} on ${o.latest.n_ratings} reports from ${o.latest.n_days} days.` :
    html`<span class="badge">not run yet</span> The model starts once there are 30 reports on 14 different days.`;
  const d = r?.diagnostics;
  const ppcCell = (row: PpcRow, k: number) =>
    html`<td class="num">${pct(row.observed[k])}, ${pct(row.predicted[k])} (${Math.round(row.lo[k] * 100)} to ${Math.round(row.hi[k] * 100)})${row.fails?.[k] ? html` <span class="badge fail">outside</span>` : ""}</td>`;
  return layout({ title: "Analysis · A Study On Myself", session: o.session, active: "analysis", scripts: ["/static/js/charts.js", "/static/js/analysis.js"] }, html`
<h1>Bayesian analysis</h1>
<p class="muted">An ordinal model of every report (Sad &lt; Meh &lt; Happy), fitted in R with Stan, with a latent daily mood that carries over between days,
effects for time of day and weekday, and the day's factors. It refits by itself every hour when new data arrives.</p>
${o.error ? html`<ul class="messages"><li class="error">${o.error}</li></ul>` : ""}
<section class="card" id="run-status" data-run-id="${o.latestAny?.id ?? 0}" data-run-status="${o.latestAny?.status ?? ""}" ${o.waiting ? html`data-waiting` : ""}>
  <div class="row">
    <div style="flex: 1 1 16rem;">${statusLine}</div>
    <form method="post" action="/analysis/refit/">${csrfField(o.session)}<button type="submit" ${running ? html`disabled` : ""}>Refit now</button></form>
  </div>
  ${r && r.data?.study_start !== o.session.user.study_start ? staleStart : ""}
</section>
${r ? html`
<section class="card">
  <h2>What goes with a Happy report</h2>
  <p class="small muted">Change in the chance that a report is Happy, per unit of each factor, with the other factors held fixed.
    Dots are posterior medians and lines 95% credible intervals. Blue marks moderate or strong evidence of a better mood,
    red of a worse mood, gray means unclear. These are associations in observational data, not proof of cause.</p>
  ${r.predictors.length ? html`<div class="chart" id="effects-chart"></div>
  <details><summary>Table view</summary><div class="table-wrap"><table>
    <thead><tr><th>Factor</th><th>Unit</th><th class="num">Odds ratio (95% CrI)</th><th class="num">Happy, pp</th><th class="num">Sad, pp</th><th class="num">P(better)</th><th>Evidence</th><th class="num">Imputed</th></tr></thead>
    <tbody>${r.predictors.map((p: Record<string, any>) => html`<tr><td>${p.label}</td><td>${p.unit_label}</td>
      <td class="num">${fixed(p.odds_ratio.est, 2)} (${fixed(p.odds_ratio.lo, 2)} to ${fixed(p.odds_ratio.hi, 2)})</td>
      <td class="num">${fixed(p.d_happy_pp.est, 1)}</td><td class="num">${fixed(p.d_sad_pp.est, 1)}</td><td class="num">${pct(p.p_positive)}</td>
      <td><span class="badge ${badgeFor(p)}">${p.evidence}</span></td><td class="num">${Math.round(p.missing_pct)}%</td></tr>`)}</tbody></table></div></details>`
  : html`<p class="muted">No daily factors have enough data yet (each needs values on at least half of the days with reports).</p>`}
  ${r.dropped.length ? html`<details><summary>Factors left out for now (${r.dropped.length})</summary>
    <ul class="small">${r.dropped.map((x: Record<string, string>) => html`<li>${x.label}: ${x.reason}</li>`)}</ul></details>` : ""}
</section>
<div class="grid">
  <section class="card"><h2>Time of day</h2><p class="small muted">Chance of a Happy report in each slot, all else as observed.</p><div class="chart" id="tod-chart"></div></section>
  <section class="card"><h2>Weekday</h2><p class="small muted">Chance of a Happy report on each weekday, all else as observed.</p><div class="chart" id="weekday-chart"></div></section>
</div>
${r.daily_mood ? html`<section class="card"><h2>Mood over time</h2>
  <p class="small muted">Model estimate of the chance of a Happy report on each day at an average time of day, with an 80% interval.
    Days without reports are filled in from the days around them.</p><div class="chart" id="daily-chart"></div></section>` : ""}
<div class="grid">
  <section class="card">
    <h2>Mood dynamics</h2>
    <p>Carry-over from one day to the next (φ): <strong>${fixed(r.dynamics.phi.est, 2)}</strong>
      <span class="muted">(95% CrI ${fixed(r.dynamics.phi.lo, 2)} to ${fixed(r.dynamics.phi.hi, 2)})</span>. Near 0 means each day starts fresh; near 1 means moods linger; below 0 means a good day tends to be followed by a worse one.</p>
    <p>Day-to-day swing (σ, logit scale): <strong>${fixed(r.dynamics.sigma_day.est, 2)}</strong>
      <span class="muted">(95% CrI ${fixed(r.dynamics.sigma_day.lo, 2)} to ${fixed(r.dynamics.sigma_day.hi, 2)})</span>.</p>
  </section>
  <section class="card">
    <h2>Model checks</h2>
    <p>${d.converged ? html`<span class="badge ok">converged</span>` : html`<span class="badge warn">check</span> Treat these results with caution.`}</p>
    <div class="table-wrap"><table><tbody>
      <tr><td>Largest R-hat (want below 1.01)</td><td class="num">${fixed(d.max_rhat, 3)}</td></tr>
      <tr><td>Smallest bulk ESS (want above 400)</td><td class="num">${Math.round(d.min_ess_bulk)}</td></tr>
      <tr><td>Smallest tail ESS</td><td class="num">${Math.round(d.min_ess_tail)}</td></tr>
      <tr><td>Divergent transitions (want 0)</td><td class="num">${d.divergences}</td></tr>
      <tr><td>PSIS-LOO elpd (SE)</td><td class="num">${fixed(d.elpd_loo, 1)} (${fixed(d.elpd_loo_se, 1)})</td></tr>
      <tr><td>Reports with Pareto k above 0.7</td><td class="num">${d.high_pareto_k}</td></tr>
      ${d.ppc_failures === undefined ? "" : html`<tr><td>Predictive check cells outside the 95% range (want 0)</td><td class="num">${d.ppc_failures}</td></tr>`}
      <tr><td>Draws; seconds</td><td class="num">${r.model.draws}; ${r.model.seconds}</td></tr>
    </tbody></table></div>
    ${r.model.software ? html`<p class="small muted">Fitted with CmdStan ${r.model.software.cmdstan} (cmdstanr ${r.model.software.cmdstanr}) in ${r.model.software.r}.</p>` : ""}
  </section>
</div>
${r.ppc ? html`<section class="card"><h2>Posterior predictive check</h2>
  <p class="small muted">Each cell shows the observed share of that answer, then the share the fitted model predicts with the central 95% of the replicated shares.
    An observed share outside that range is a failed check (protocol Section 2.9.8) and is marked.</p>
  <div class="table-wrap"><table><thead><tr><th>Reports</th><th class="num">Sad</th><th class="num">Meh</th><th class="num">Happy</th></tr></thead>
  <tbody>${Object.entries(r.ppc as Record<string, PpcRow>).map(([name, row]) => html`<tr><td>${cap(name)}</td>${[0, 1, 2].map((k) => ppcCell(row, k))}</tr>`)}</tbody></table></div></section>` : ""}
${o.whatIfFields.length ? html`<section class="card">
  <h2>What if?</h2>
  <p class="small muted">The model's chance of each answer on a typical day with the values you enter. Blank fields use your average (shown as the placeholder).
    This describes the model's associations; it does not promise what a change would cause.</p>
  <form method="get" class="stack"><input type="hidden" name="whatif" value="1">
    <div class="fields">
      ${o.whatIfFields.map((f) => html`<div class="field"><label for="wi-${f.field}">${f.label}${f.unit ? html` <span class="small">(${f.unit})</span>` : ""}</label>
        ${f.binary ? html`<select id="wi-${f.field}" name="${f.field}"><option value="">Average</option>
          <option value="1" ${f.value === "1" ? html`selected` : ""}>Yes</option><option value="0" ${f.value === "0" ? html`selected` : ""}>No</option></select>`
        : html`<input id="wi-${f.field}" name="${f.field}" inputmode="decimal" placeholder="${fixed(f.mean, 1)}" value="${f.value}">`}</div>`)}
      <div class="field"><label for="wi-weekday">Weekday</label><select id="wi-weekday" name="weekday">
        ${WEEKDAYS.map((day, k) => html`<option value="${k}" ${k === o.whatIfWeekday ? html`selected` : ""}>${day}</option>`)}</select></div>
    </div>
    <button type="submit">Predict</button>
  </form>
  ${o.whatIf ? html`<div class="table-wrap"><table><thead><tr><th>Time</th><th class="num">Sad</th><th class="num">Meh</th><th class="num">Happy</th></tr></thead>
    <tbody>${o.whatIf.map(([slot, p]) => html`<tr><td>${cap(slot)}</td><td class="num">${pct(p[0])}</td><td class="num">${pct(p[1])}</td><td class="num">${pct(p[2])}</td></tr>`)}</tbody></table></div>` : ""}
</section>` : ""}` : ""}
<section class="card">
  <h2>Recent runs</h2>
  ${o.history.length ? html`<div class="table-wrap"><table><thead><tr><th>Started</th><th>Status</th><th class="num">Reports</th><th class="num">Days</th></tr></thead>
    <tbody>${o.history.map((h) => html`<tr><td>${stamp(h.started_at, tz)}</td><td>${cap(h.status)}</td><td class="num">${h.n_ratings}</td><td class="num">${h.n_days}</td></tr>`)}</tbody></table></div>`
  : html`<p class="muted">No runs yet.</p>`}
</section>
${jsonScript("chart-data", o.charts)}`);
}

export function settingsPage(o: {
  session: Session; timeZones: string[]; errors: Record<string, string>; newToken: string | null; apiBase: string; host: string;
  tokens: { id: number; name: string; created_at: string; last_used_at: string | null }[];
  weatherOn: boolean; backupOn: boolean; lastBackup: string | null; backupStale: boolean; publishOn: boolean; dataDir: string;
  reminderTimes: string[]; remindersOn: boolean; pushDevices: number;
}): Html {
  const u = o.session.user;
  const err = (name: string) => (o.errors[name] ? html`<ul class="errorlist"><li>${o.errors[name]}</li></ul>` : "");
  const time = (slot: string, k: number) => html`<div class="field"><label for="reminder_${slot}">${cap(slot)}</label>
    <input id="reminder_${slot}" name="reminder_${slot}" type="time" value="${o.reminderTimes[k]}" required></div>`;
  return layout({ title: "Settings · A Study On Myself", session: o.session, active: "settings", scripts: ["/static/js/push.js"] }, html`
<h1>Settings</h1>
<section class="card" id="push">
  <h2>Reminders</h2>
  <p class="small muted">A notification at each time below, sent only while that part of the day has no report yet. On an iPhone,
    open the app from its Home Screen icon (iOS 16.4 or later) and turn notifications on there. The Mac must be awake to send them.</p>
  <p class="status-line" aria-live="polite">${o.pushDevices ? `${o.pushDevices} device(s) receive reminders.` : "No device receives reminders yet."}</p>
  <div class="row">
    <button type="button" class="primary" data-push="on">Turn on for this device</button>
    <button type="button" data-push="test">Send a test</button>
    <button type="button" class="link" data-push="off">Turn off for this device</button>
  </div>
  <form method="post" class="stack">${csrfField(o.session)}<input type="hidden" name="action" value="reminders">
    <div class="fields">${time("morning", 0)}${time("afternoon", 1)}${time("evening", 2)}</div>
    ${err("reminders")}
    <label><input type="checkbox" name="reminders_on" value="1" ${o.remindersOn ? html`checked` : ""}> Send reminders</label>
    <button type="submit">Save reminder times</button>
  </form>
</section>
<section class="card">
  <h2>Study</h2>
  <form method="post" class="stack">${csrfField(o.session)}<input type="hidden" name="action" value="profile">
    <div class="fields">
      <div class="field"><label for="time_zone">Time zone</label><select id="time_zone" name="time_zone">
        ${o.timeZones.map((tz) => html`<option ${tz === u.time_zone ? html`selected` : ""}>${tz}</option>`)}</select>
        <div class="help">Used when a report arrives without its own time zone.</div>${err("time_zone")}</div>
      <div class="field"><label for="day_start_hour">Day starts at (hour)</label>
        <input id="day_start_hour" name="day_start_hour" type="number" min="0" max="11" value="${u.day_start_hour}">
        <div class="help">Reports before this hour count toward the previous study day.</div>${err("day_start_hour")}</div>
      <div class="field"><label for="study_start">Study start</label><input id="study_start" name="study_start" type="date" value="${u.study_start ?? ""}">${err("study_start")}</div>
    </div>
    <button class="primary" type="submit">Save</button>
  </form>
</section>
<section class="card">
  <h2>Phone access</h2>
  <p>Mood page for your Home Screen: <a href="${o.apiBase}/rate/">${o.apiBase}/rate/</a></p>
  ${o.host ? "" : html`<p class="small muted">Set ASOM_HOST in .env to your Tailscale name to reach this from your phone over HTTPS (see README).</p>`}
  <h3>Device tokens for Shortcuts</h3>
  <p class="small muted">A token can only add reports and daily data. It can never read your history, so a lost phone leaks nothing.</p>
  ${o.newToken ? html`<div class="stack" role="alert">
    <p><strong>Copy this token now. It will not be shown again.</strong></p>
    <div class="token">${o.newToken}</div>
    <pre class="code">POST ${o.apiBase}/api/ratings/
Authorization: Bearer ${o.newToken}
Content-Type: application/json

{"rating": 3, "source": "shortcut"}</pre></div>` : ""}
  <form method="post" class="row">${csrfField(o.session)}<input type="hidden" name="action" value="token">
    <div style="flex: 1 1 12rem;"><label for="token-name">Device name</label><input id="token-name" name="name" maxlength="50" required>${err("name")}</div>
    <button type="submit" style="align-self: end;">Create token</button>
  </form>
  ${o.tokens.length ? html`<div class="table-wrap"><table><thead><tr><th>Device</th><th>Created</th><th>Last used</th><th></th></tr></thead>
    <tbody>${o.tokens.map((t) => html`<tr><td>${t.name}</td><td>${stamp(t.created_at, u.time_zone)}</td><td>${t.last_used_at ? stamp(t.last_used_at, u.time_zone) : "never"}</td>
      <td><form method="post" action="/settings/tokens/${t.id}/revoke/">${csrfField(o.session)}<button class="link" type="submit">Revoke</button></form></td></tr>`)}</tbody></table></div>` : ""}
</section>
<section class="card">
  <h2>Automation</h2>
  <div class="table-wrap"><table><tbody>
    <tr><td>Weather and air quality (Open-Meteo)</td><td>${o.weatherOn ? html`<span class="badge ok">on</span>` : html`<span class="badge">off</span> set WEATHER_LATITUDE and WEATHER_LONGITUDE`}</td></tr>
    <tr><td>Encrypted backups</td><td>${o.backupOn ? html`<span class="badge ${o.backupStale ? "warn" : "ok"}">${o.backupStale ? "check" : "on"}</span> latest: ${o.lastBackup ?? "none yet"}${o.backupStale ? ". No backup in the last two days; see logs/maintain.log" : ""}` : html`<span class="badge warn">off</span> set BACKUP_GPG_RECIPIENT`}</td></tr>
    <tr><td>Public results page</td><td>${o.publishOn ? html`<span class="badge ok">on</span> estimates only, never data` : html`<span class="badge">off</span> set PUBLISH_DIR`}</td></tr>
  </tbody></table></div>
  <p class="small muted">Data folder: ${o.dataDir}</p>
</section>
<section class="card">
  <h2>Your data</h2>
  <p class="row"><a class="button" href="/export/ratings.csv">Reports (CSV)</a> <a class="button" href="/export/daily.csv">Daily logs (CSV)</a> <a class="button" href="/export/all.json">Everything (JSON)</a></p>
  <details><summary>Delete all data</summary>
    <form method="post" action="/settings/delete-all/" class="stack" style="margin-top: 0.6rem;">${csrfField(o.session)}
      <p class="small">This permanently deletes every report, daily log and analysis in this app. Encrypted backups are not touched.</p>
      <div><label for="confirm">Type DELETE to confirm</label><input id="confirm" name="confirm" autocomplete="off"></div>
      <button class="danger" type="submit">Delete everything</button>
    </form></details>
</section>
<section class="card"><h2>Account</h2><p><a href="/accounts/password/">Change password</a></p></section>`);
}

export function passwordPage(o: { session: Session; errors: Record<string, string> }): Html {
  const err = (name: string) => (o.errors[name] ? html`<ul class="errorlist"><li>${o.errors[name]}</li></ul>` : "");
  return layout({ title: "Change password · A Study On Myself", session: o.session }, html`
<div class="card" style="max-width: 440px;">
  <h1>Change password</h1>
  <form method="post" class="stack">${csrfField(o.session)}
    <div class="field"><label for="old">Current password</label><input id="old" name="old" type="password" autocomplete="current-password" required>${err("old")}</div>
    <div class="field"><label for="new">New password (12 characters or more)</label><input id="new" name="new" type="password" autocomplete="new-password" minlength="12" required>${err("new")}</div>
    <button class="primary" type="submit">Change password</button>
  </form>
</div>`);
}
