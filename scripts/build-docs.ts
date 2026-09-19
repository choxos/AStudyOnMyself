// Build the public site's pages (needs pandoc):
//
//   site/index.html                 the results page (its data come from results.json)
//   site/protocol.html              the protocol (study_protocol.md) with its SHA-256
//   site/study_protocol.md          the same file, so anyone can check the hash
//   site/versions/round-N.html      each version the reviewers received
//   site/review.html                the review record: prompts, reports, responses
//
// Reviewer reports are shown verbatim (HTML-escaped); the responses are Markdown.
// Run: node scripts/build-docs.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type Html, html, raw } from "../server/html.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = path.join(ROOT, "site");
const REVIEW = path.join(ROOT, "peer-review");
const REPO_URL = "https://github.com/choxos/AStudyOnMyself";

const REVIEWERS: Record<string, { name: string; maker: string; tool: string }> = {
  "gpt-6-astra": { name: "GPT-6-Astra", maker: "OpenAI", tool: "the Codex command line tool" },
  "grok-4.6": { name: "Grok 4.6", maker: "xAI", tool: "the Grok command line tool" },
};

const protocol = readFileSync(path.join(ROOT, "study_protocol.md"), "utf8");
const sha256 = createHash("sha256").update(protocol).digest("hex");
const version = /\| Protocol version \| ([^|]+) \|/.exec(protocol)?.[1].trim() ?? "";
const protocolDate = /\| Date \| ([^|]+) \|/.exec(protocol)?.[1].trim() ?? "";
// The title as shown in the page header; "N-of-1" is kept on one line.
const titleOf = (markdown: string) => (/^# (.+)$/m.exec(markdown)?.[1].trim() ?? "Study protocol").replaceAll("N-of-1", "N\u2011of\u20111");

const templateDir = mkdtempSync(path.join(tmpdir(), "asom-docs-"));
const TOC_TEMPLATE = path.join(templateDir, "toc.html");
writeFileSync(TOC_TEMPLATE, `<div class="doc-layout">
<aside class="toc-panel"><details open id="toc"><summary>Contents</summary><nav aria-label="Contents">
$toc$
</nav></details></aside>
<article class="doc">
$body$
</article>
</div>
`);

/** Markdown to an HTML fragment, optionally laid out with a contents sidebar. */
function pandoc(markdown: string, toc = false): Html {
  const args = ["-f", "markdown+autolink_bare_uris-implicit_figures", "-t", "html5", "--mathml"];
  if (toc) args.push("-s", "--template", TOC_TEMPLATE, "--toc", "--toc-depth=3", "-M", "pagetitle=protocol");
  return raw(execFileSync("pandoc", args, { input: markdown, encoding: "utf8" }));
}

function page(o: { title: string; description: string; active: string; depth?: number; body: Html; scripts?: string[] }): string {
  const up = "../".repeat(o.depth ?? 0);
  const link = (href: string, label: string, key: string) =>
    html`<a href="${up}${href}"${o.active === key ? raw(' aria-current="page"') : ""}>${label}</a>`;
  return `<!DOCTYPE html>\n${html`<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${o.description}">
  <meta name="color-scheme" content="light dark">
  <title>${o.title}</title>
  <link rel="icon" href="${up}icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${up}app.css">
  <link rel="stylesheet" href="${up}site.css">
</head>
<body>
  <a class="skip" href="#content">Skip to content</a>
  <header class="site-header"><div class="bar">
    <a class="brand" href="${up}./"><img src="${up}icon.svg" alt=""><span>A Study On Myself</span></a>
    <nav class="site-nav" aria-label="Site">
      ${link("./", "Results", "results")}
      ${link("protocol.html", "Protocol", "protocol")}
      ${link("review.html", "Review record", "review")}
      <a href="${REPO_URL}">Code</a>
    </nav>
  </div></header>
  <main class="page" id="content">
${o.body}
  </main>
  <footer class="site-footer"><div class="bar">
    <p>A Study On Myself is an N-of-1 study of one person's mood, by <a href="https://choxos.github.io">Ahmad Sofi-Mahmudi</a>.
      Only model estimates are published; the data stay on the participant's own computer.</p>
    <p><a href="${up}protocol.html">Protocol ${version}</a> · <a href="${up}review.html">Review record</a> · <a href="${REPO_URL}">Source code (GPL-3.0)</a></p>
  </div></footer>
${(o.scripts ?? []).map((s) => html`  <script src="${up}${s}"></script>\n`)}</body>
</html>`}\n`;
}

// ---------------------------------------------------------------- the results page

const HYPOTHESES: [string, string][] = [
  ["H1", "Longer sleep last night goes with higher mood."],
  ["H2", "More steps yesterday go with higher mood."],
  ["H3a", "More screen time other than social media yesterday goes with lower mood."],
  ["H3b", "More social media time yesterday goes with lower mood."],
  ["H4", "More time in person with friends or family yesterday goes with higher mood."],
  ["H5", "The latent daily mood carries over from one day to the next (positive carry-over, φ > 0)."],
];

writeFileSync(path.join(SITE, "index.html"), page({
  title: "A Study On Myself: live results",
  description: "Live results of an N-of-1 Bayesian study of what goes with one person's daily mood. Estimates only; no data are published.",
  active: "results",
  scripts: ["charts.js", "results.js"],
  body: html`<section class="hero">
  <p class="eyebrow">An N-of-1 study of mood</p>
  <h1>A Study On Myself</h1>
  <p class="lede">Which daily factors go with one person's mood? Three times a day I rate my mood as Sad, Meh or Happy.
    Sleep, activity, weather and indoor air are recorded automatically, and a Bayesian model estimates how each factor
    goes with a better or worse mood. This page shows its estimates as they update; the data themselves are never published.</p>
  <div class="actions">
    <a class="btn primary" href="protocol.html">Read the protocol</a>
    <a class="btn" href="review.html">Review record</a>
    <a class="btn" href="${REPO_URL}">Source code</a>
  </div>
</section>

<section class="stats" aria-label="Study status">
  <div class="stat"><span class="label">Study day</span><span class="value" id="study-day">&nbsp;</span><span class="note" id="study-day-note">&nbsp;</span></div>
  <div class="stat"><span class="label">Reports modeled</span><span class="value" id="n-reports">None yet</span><span class="note" id="n-note">The first estimates need 30 reports on 14 days.</span></div>
  <div class="stat"><span class="label">Next analysis</span><span class="value" id="next-analysis">&nbsp;</span><span class="note" id="next-note">&nbsp;</span></div>
</section>
<p id="status" class="status-note" aria-live="polite">Loading results…</p>

<div id="results" hidden>
  <section class="section">
    <h2>What goes with a Happy report</h2>
    <p class="intro">Change in the chance that a report is Happy for one unit more of each factor, with the other factors held fixed.
      Dots are posterior medians and lines 95% credible intervals. Blue: moderate or strong evidence of a better mood;
      red: of a worse mood; gray: unclear. The factors of the confirmatory hypotheses stay gray until the 6 and 12 month analyses.</p>
    <div class="card">
      <div class="chart" id="effects-chart"></div>
      <details class="more"><summary>Table view</summary>
        <div class="table-wrap"><table>
          <thead><tr><th>Factor</th><th>Unit</th><th class="num">Odds ratio (95% CrI)</th><th class="num">Happy, pp</th><th class="num">Sad, pp</th><th class="num">P(better)</th><th>Evidence</th></tr></thead>
          <tbody id="effects-table"></tbody>
        </table></div>
      </details>
      <p class="small muted" id="no-effects" hidden>No daily factor has enough data yet.</p>
    </div>
  </section>

  <section class="section">
    <h2>Rhythms</h2>
    <p class="intro">The model's chance of a Happy report by time of day and by weekday, with 95% credible intervals.</p>
    <div class="grid">
      <div class="card"><h3>Time of day</h3><div class="chart" id="tod-chart"></div></div>
      <div class="card"><h3>Weekday</h3><div class="chart" id="weekday-chart"></div></div>
    </div>
  </section>

  <section class="section">
    <h2>Mood dynamics</h2>
    <div class="card"><p id="dynamics" class="prose"></p></div>
  </section>
</div>

<section class="section">
  <h2>Prespecified hypotheses</h2>
  <p class="intro">Fixed in the protocol before data collection began, and judged at 6 and 12 months by a posterior probability rule
    (<a href="protocol.html#confirmatory-analysis-and-decision-rule">Section 2.9.5</a>). Until then their estimates are shown without a verdict.</p>
  <ul class="hypotheses">
    ${HYPOTHESES.map(([id, text]) => html`<li><span class="id">${id}</span><p>${text}</p></li>`)}
  </ul>
</section>

<section class="section">
  <h2>How the study works</h2>
  <div class="steps">
    <div class="card"><span class="step-no">1</span><h3>Measure</h3>
      <p>A tap on the phone three times a day records momentary mood, and an evening question rates the whole day.
        A smart ring, Apple Health, a weather service and an indoor air monitor add the daily factors automatically.</p></div>
    <div class="card"><span class="step-no">2</span><h3>Model</h3>
      <p>A Bayesian ordinal model with a latent daily mood that carries over between days, effects for time of day and weekday,
        and the day's factors. It is written in Stan and refits every hour as new reports arrive.</p></div>
    <div class="card"><span class="step-no">3</span><h3>Publish</h3>
      <p>Only fits that pass the convergence checks are published, and only their estimates: effects with 95% credible intervals.
        Reports, notes and daily values stay on the participant's computer.</p></div>
  </div>
  <details class="more prose"><summary>Technical details of the model</summary>
    <p>Each report is modeled with a Bayesian cumulative logit (ordinal) model. The linear predictor adds effects for time of day and weekday
      (sum-to-zero), the day's factors, and a latent daily mood that follows a stationary first-order autoregressive process, so moods can carry over
      from one day to the next and days without reports are handled naturally. Factors are standardized; the five in the hypotheses have normal(0, 0.5)
      priors and the others share a hierarchical shrinkage prior; cutpoints are ordered. Factors enter only with information available before the day's
      reports: last night's sleep and physiology, yesterday's behavior, and same-day context such as weather or a work day. Missing factor values are
      imputed within the model, which assumes they are missing at random. The model is fitted from R with cmdstanr (NUTS, four chains), with
      convergence checked by R-hat, effective sample size and divergent transitions.</p>
    <p>"Evidence" is the posterior probability that an effect points the way shown: strong at 97.5% or more (the 95% interval excludes zero),
      moderate at 90%, weak at 75%. With many factors some moderate results will be chance findings. These are associations in observational data
      from one person; they are not causal effects and say nothing about anyone else.</p>
  </details>
</section>`,
}));

// ---------------------------------------------------------------- the protocol

const fingerprint = html`<details class="more"><summary>Fingerprint</summary>
  <p class="small">SHA-256 of <a href="study_protocol.md">study_protocol.md</a>, so that anyone can check that this is the published version:</p>
  <p class="hash">${sha256}</p></details>`;

writeFileSync(path.join(SITE, "protocol.html"), page({
  title: "Study protocol · A Study On Myself",
  description: "Protocol of an N-of-1 Bayesian study of momentary mood and daily satisfaction.",
  active: "protocol",
  scripts: ["site.js"],
  body: html`<header class="doc-head">
  <p class="eyebrow">Study protocol</p>
  <h1>${titleOf(protocol)}</h1>
  <p class="meta"><span class="chip ${/final/.test(version) ? "ok" : "warn"}">Version ${version}</span><span>${protocolDate}</span>
    <a href="study_protocol.md">Markdown source</a><a href="review.html">How it was reviewed</a></p>
  ${fingerprint}
</header>
${pandoc(protocol, true)}`,
}));
copyFileSync(path.join(ROOT, "study_protocol.md"), path.join(SITE, "study_protocol.md"));

// ---------------------------------------------------------------- the review record

interface Point { id: string; section: string; problem: string; requested_change: string }
interface Review {
  verdict: "accept" | "revise";
  summary: string;
  prior_points: { id: string; status: string; comment: string }[];
  must_fix: Point[];
  should_fix: Point[];
  minor: Point[];
}
interface Meta { cli: string; reasoning_effort: string; started: string; finished: string }

const rounds = existsSync(REVIEW)
  ? readdirSync(REVIEW).map((d) => /^round-(\d+)$/.exec(d)?.[1]).filter(Boolean).map(Number).sort((a, b) => a - b)
  : [];
const readJson = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null);
const reviewOf = (round: number, who: string) => readJson<Review>(path.join(REVIEW, `round-${round}`, `${who}.json`));
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const verdictLabel = (v?: string) => (v === "accept" ? "Accept" : v === "revise" ? "Revise" : "Pending");
const verdictChip = (v?: string, prefix = "") =>
  html`<span class="chip ${v === "accept" ? "ok" : v === "revise" ? "warn" : ""}">${prefix}${verdictLabel(v)}</span>`;
const counts = (r: Review) => `${r.must_fix.length} must fix, ${r.should_fix.length} should fix, ${r.minor.length} minor`;

const pointList = (title: string, points: Point[]) =>
  points.length
    ? html`<h4>${title}</h4>
<ol class="points">${points.map((p) => html`<li><strong>${p.id}</strong> <span class="sec">(${p.section})</span> ${p.problem}
  <span class="ask"><em>Requested change:</em> ${p.requested_change}</span></li>`)}</ol>`
    : "";

const STATUS: Record<string, string> = { resolved: "Resolved", partly_resolved: "Partly resolved", not_resolved: "Not resolved" };

function reviewSection(round: number, who: string): Html {
  const dir = path.join(REVIEW, `round-${round}`);
  const r = reviewOf(round, who);
  const meta = readJson<Meta>(path.join(dir, `${who}.meta.json`));
  const reviewer = REVIEWERS[who];
  const responseFile = path.join(dir, `response-${who}.md`);
  return html`<section class="reviewer" id="round-${round}-${who}">
<header><h3>${reviewer.name}</h3>${verdictChip(r?.verdict)}</header>
<p class="by">${reviewer.maker} ${reviewer.name} through ${reviewer.tool}${meta ? ` (${meta.cli})` : ""}, reasoning effort xhigh${meta ? `; ${day(meta.started)}` : ""}.</p>
${r ? html`<p>${r.summary}</p>
<p class="small muted">${counts(r)}.</p>
${r.prior_points.length ? html`<details><summary>Points from the previous round (${r.prior_points.length})</summary>
<div class="table-wrap"><table><thead><tr><th>Point</th><th>Status</th><th>Comment</th></tr></thead><tbody>
${r.prior_points.map((p) => html`<tr><td>${p.id}</td><td>${STATUS[p.status] ?? p.status}</td><td>${p.comment}</td></tr>`)}
</tbody></table></div></details>` : ""}
${pointList("Must fix", r.must_fix)}
${pointList("Should fix", r.should_fix)}
${pointList("Minor", r.minor)}` : html`<p class="muted">Report pending.</p>`}
${existsSync(responseFile) ? html`<h4>Response</h4>
<div class="response">${pandoc(readFileSync(responseFile, "utf8"))}</div>` : ""}
</section>`;
}

mkdirSync(path.join(SITE, "versions"), { recursive: true });
for (const round of rounds) {
  const snapshot = path.join(REVIEW, `round-${round}`, "protocol.md");
  if (!existsSync(snapshot)) continue;
  const text = readFileSync(snapshot, "utf8");
  writeFileSync(path.join(SITE, "versions", `round-${round}.html`), page({
    title: `Protocol as reviewed in round ${round} · A Study On Myself`,
    description: `The version of the study protocol the reviewers received in round ${round}.`,
    active: "",
    depth: 1,
    scripts: ["site.js"],
    body: html`<header class="doc-head">
  <p class="eyebrow">Archived version, review round ${round}</p>
  <h1>${titleOf(text)}</h1>
  <p class="notice">This is the version the reviewers received in round ${round}, kept for the record.
    The current protocol is <a href="../protocol.html">here</a>; the reports are in the <a href="../review.html#round-${round}">review record</a>.</p>
</header>
${pandoc(text, true)}`,
  }));
}

const prompt = (name: string) => {
  const file = path.join(REVIEW, "prompts", name);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const verdictRows = rounds.map((round) => {
  const cell = (who: string) => {
    const r = reviewOf(round, who);
    return html`<td>${verdictChip(r?.verdict)}${r ? html`<span class="counts">${counts(r)}</span>` : ""}</td>`;
  };
  return html`<tr><td><a href="#round-${round}">Round ${round}</a></td>${cell("gpt-6-astra")}${cell("grok-4.6")}
<td><a href="versions/round-${round}.html">Version reviewed</a></td></tr>`;
});
const last = rounds.at(-1);
const intro = readFileSync(path.join(REVIEW, "README.md"), "utf8");

writeFileSync(path.join(SITE, "review.html"), page({
  title: "Review record · A Study On Myself",
  description: "How the study protocol was reviewed by two AI models, with every report and response.",
  active: "review",
  scripts: ["site.js"],
  body: html`<header class="doc-head">
  <p class="eyebrow">Protocol review</p>
  <h1>Review record</h1>
  <p class="lede">Two AI models reviewed version 3.0 of the protocol in ${rounds.length} rounds. Every report, every response and every
    version they received is kept here. This is review by AI models, not peer review by human experts.</p>
</header>

<section class="section">
  <h2>Verdicts by round</h2>
  <div class="table-wrap card"><table class="verdicts">
    <thead><tr><th>Round</th><th>GPT-6-Astra</th><th>Grok 4.6</th><th>Protocol</th></tr></thead>
    <tbody>${verdictRows}</tbody>
  </table></div>
</section>

<section class="section">
  <h2>How the review worked</h2>
  <div class="doc">${pandoc(intro)}</div>
</section>

<section class="section">
  <h2>Reports and responses</h2>
  ${rounds.map((round) => html`<details class="round" id="round-${round}"${round === last ? raw(" open") : ""}>
<summary><h2>Round ${round}</h2>${Object.keys(REVIEWERS).map((who) => verdictChip(reviewOf(round, who)?.verdict, `${REVIEWERS[who].name}: `))}</summary>
<div class="round-body">
${Object.keys(REVIEWERS).map((who) => reviewSection(round, who))}
</div>
</details>`)}
</section>

<section class="section" id="prompts">
  <h2>The instructions the reviewers received</h2>
  <details class="more"><summary>Round 1</summary><pre class="prompt">${prompt("round-1.md")}</pre></details>
  ${prompt("round-n.md") ? html`<details class="more"><summary>Round 2 and later</summary><pre class="prompt">${prompt("round-n.md")}</pre></details>` : ""}
</section>`,
}));

rmSync(templateDir, { recursive: true, force: true });
console.log(`Built the results page, protocol ${version} (sha256 ${sha256.slice(0, 12)}) and the review record for ${rounds.length} round(s).`);
