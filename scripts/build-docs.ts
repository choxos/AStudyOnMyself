// Build the public protocol pages from their Markdown sources (needs pandoc):
//
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

const REVIEWERS: Record<string, { name: string; maker: string; tool: string }> = {
  "gpt-6-astra": { name: "GPT-6-Astra", maker: "OpenAI", tool: "the Codex command line tool" },
  "grok-4.6": { name: "Grok 4.6", maker: "xAI", tool: "the Grok command line tool" },
};

const templateDir = mkdtempSync(path.join(tmpdir(), "asom-docs-"));
const TOC_TEMPLATE = path.join(templateDir, "toc.html");
writeFileSync(TOC_TEMPLATE, '<nav class="toc" aria-label="Contents">\n$toc$\n</nav>\n$body$\n');

/** Markdown to an HTML fragment, optionally with a table of contents. */
function pandoc(markdown: string, toc = false): Html {
  const args = ["-f", "markdown+autolink_bare_uris-implicit_figures", "-t", "html5", "--mathml"];
  if (toc) args.push("-s", "--template", TOC_TEMPLATE, "--toc", "--toc-depth=3", "-M", "pagetitle=protocol");
  return raw(execFileSync("pandoc", args, { input: markdown, encoding: "utf8" }));
}

function page(o: { title: string; description: string; active: string; depth?: number; body: Html }): string {
  const up = "../".repeat(o.depth ?? 0);
  const link = (href: string, label: string, key: string) =>
    html`<a href="${up}${href}"${o.active === key ? raw(' aria-current="page"') : ""}>${label}</a>`;
  return `<!DOCTYPE html>\n${html`<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="${o.description}">
  <title>${o.title}</title>
  <link rel="stylesheet" href="${up}app.css">
</head>
<body>
  <nav class="nav">
    <a class="brand" href="${up}./">A Study On Myself</a>
    ${link("./", "Results", "results")}
    ${link("protocol.html", "Protocol", "protocol")}
    ${link("review.html", "Review record", "review")}
  </nav>
  <main class="doc">
${o.body}
  </main>
</body>
</html>`}\n`;
}

// ---------------------------------------------------------------- the protocol

const protocol = readFileSync(path.join(ROOT, "study_protocol.md"), "utf8");
const sha256 = createHash("sha256").update(protocol).digest("hex");
const version = /\| Protocol version \| ([^|]+) \|/.exec(protocol)?.[1].trim() ?? "";
writeFileSync(path.join(SITE, "protocol.html"), page({
  title: "Study protocol · A Study On Myself",
  description: "Protocol of an N-of-1 Bayesian study of momentary mood and daily satisfaction.",
  active: "protocol",
  body: html`<p class="small muted">Protocol version ${version}. SHA-256 of
  <a href="study_protocol.md">study_protocol.md</a>: <code class="hash">${sha256}</code>.
  How it was reviewed: <a href="review.html">review record</a>.</p>
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
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const verdictLabel = (v?: string) => (v === "accept" ? "Accept" : v === "revise" ? "Revise" : "Pending");

const pointList = (title: string, points: Point[]) =>
  points.length
    ? html`<h4>${title}</h4>
<ol class="points">${points.map((p) => html`<li><strong>${p.id}</strong> <span class="muted">(${p.section})</span> ${p.problem}
  <br><em>Requested change:</em> ${p.requested_change}</li>`)}</ol>`
    : "";

const STATUS: Record<string, string> = { resolved: "Resolved", partly_resolved: "Partly resolved", not_resolved: "Not resolved" };

function reviewSection(round: number, who: string): Html {
  const dir = path.join(REVIEW, `round-${round}`);
  const r = readJson<Review>(path.join(dir, `${who}.json`));
  const meta = readJson<Meta>(path.join(dir, `${who}.meta.json`));
  const reviewer = REVIEWERS[who];
  const responseFile = path.join(dir, `response-${who}.md`);
  return html`<section class="card review" id="round-${round}-${who}">
<h3>${reviewer.name}: ${verdictLabel(r?.verdict)}</h3>
<p class="small muted">${reviewer.maker} ${reviewer.name} through ${reviewer.tool}${meta ? ` (${meta.cli})` : ""}, reasoning effort xhigh${meta ? `; ${day(meta.started)}` : ""}.</p>
${r ? html`<p><strong>Summary.</strong> ${r.summary}</p>
${r.prior_points.length ? html`<h4>Points from the previous round</h4>
<div class="table-wrap"><table><thead><tr><th>Point</th><th>Status</th><th>Comment</th></tr></thead><tbody>
${r.prior_points.map((p) => html`<tr><td>${p.id}</td><td>${STATUS[p.status] ?? p.status}</td><td>${p.comment}</td></tr>`)}
</tbody></table></div>` : ""}
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
  writeFileSync(path.join(SITE, "versions", `round-${round}.html`), page({
    title: `Protocol as reviewed in round ${round} · A Study On Myself`,
    description: `The version of the study protocol the reviewers received in round ${round}.`,
    active: "",
    depth: 1,
    body: html`<p class="small muted">This is the version the reviewers received in round ${round}, kept for the record.
  The current protocol is <a href="../protocol.html">here</a>; the reports are in the <a href="../review.html#round-${round}">review record</a>.</p>
${pandoc(readFileSync(snapshot, "utf8"), true)}`,
  }));
}

const prompt = (name: string) => {
  const file = path.join(REVIEW, "prompts", name);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};
const summaryRows = rounds.map((round) => {
  const verdict = (who: string) => verdictLabel(readJson<Review>(path.join(REVIEW, `round-${round}`, `${who}.json`))?.verdict);
  return html`<tr><td><a href="#round-${round}">Round ${round}</a></td><td><a href="versions/round-${round}.html">Version reviewed</a></td>
<td>${verdict("gpt-6-astra")}</td><td>${verdict("grok-4.6")}</td></tr>`;
});
const intro = readFileSync(path.join(REVIEW, "README.md"), "utf8");

writeFileSync(path.join(SITE, "review.html"), page({
  title: "Review record · A Study On Myself",
  description: "How the study protocol was reviewed by two AI models, with every report and response.",
  active: "review",
  body: html`${pandoc(intro)}
<div class="table-wrap"><table>
<thead><tr><th>Round</th><th>Protocol</th><th>GPT-6-Astra</th><th>Grok 4.6</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table></div>
${rounds.map((round) => html`<h2 id="round-${round}">Round ${round}</h2>
${Object.keys(REVIEWERS).map((who) => reviewSection(round, who))}`)}
<h2 id="prompts">The instructions the reviewers received</h2>
<details><summary>Round 1</summary><pre class="prompt">${prompt("round-1.md")}</pre></details>
${prompt("round-n.md") ? html`<details><summary>Round 2 and later</summary><pre class="prompt">${prompt("round-n.md")}</pre></details>` : ""}`,
}));

rmSync(templateDir, { recursive: true, force: true });
console.log(`Built protocol ${version} (sha256 ${sha256.slice(0, 12)}) and the review record for ${rounds.length} round(s).`);
