// Pull the review JSON out of the grok answer, check both reviewers' JSON against
// the schema's required fields, and clean the codex event log for publication.
//
//   node peer-review/extract.ts <round>
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const out = path.join(import.meta.dirname, `round-${process.argv[2]}`);

// The event log records the commands a reviewer ran on this computer. Paths in the
// home folder become "~", and the output of commands that read files outside the
// review workspace (the reviewer tool's own settings and plugins) is left out.
const HOME = homedir();
for (const file of readdirSync(out).filter((f) => f.endsWith(".events.jsonl"))) {
  const events = readFileSync(path.join(out, file), "utf8").split("\n").filter(Boolean).map((line) => {
    const event = JSON.parse(line);
    const item = event.item;
    if (item?.type === "command_execution" && item.command?.includes(`${HOME}/.`) && item.aggregated_output) {
      item.aggregated_output = "[omitted: output that includes files outside the review workspace]";
    }
    return JSON.stringify(event).replaceAll(HOME, "~");
  });
  writeFileSync(path.join(out, file), `${events.join("\n")}\n`);
}
const raw = path.join(out, "grok-4.6.raw.json");
if (existsSync(raw) && statSync(raw).size) {
  const text: string = JSON.parse(readFileSync(raw, "utf8")).text;
  const blocks = [...text.matchAll(/```json\s*(\{[\s\S]*?\})\s*```/g)];
  const body = blocks.length ? blocks.at(-1)![1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  writeFileSync(path.join(out, "grok-4.6.json"), `${JSON.stringify(JSON.parse(body), null, 2)}\n`);
}
for (const who of ["gpt-6-astra", "grok-4.6"]) {
  const file = path.join(out, `${who}.json`);
  if (!existsSync(file)) {
    console.log(who, "missing");
    continue;
  }
  const text = readFileSync(file, "utf8");
  const r = JSON.parse(text);
  if (!["accept", "revise"].includes(r.verdict)) throw new Error(`${who}: verdict ${r.verdict}`);
  for (const key of ["summary", "prior_points", "must_fix", "should_fix", "minor"]) {
    if (!(key in r)) throw new Error(`${who}: missing ${key}`);
  }
  for (const p of r.prior_points) {
    if (!["resolved", "partly_resolved", "not_resolved"].includes(p.status)) throw new Error(`${who}: status ${p.status}`);
  }
  const dashes = (text.match(/[–—]/g) ?? []).length;
  console.log(`${who}: ${r.verdict}, must ${r.must_fix.length}, should ${r.should_fix.length}, minor ${r.minor.length}, prior ${r.prior_points.length}, dashes ${dashes}`);
}
