// Command line tasks. Run with: node scripts/cli.ts <command>
//
//   create-user NAME       password on stdin (use scripts/create-user.sh)
//   set-password NAME      password on stdin
//   refit [--user ID]      fit the model now
//   maintain               the hourly job: weather, ring, indoor air, refit if data changed,
//                          publish, daily backup
//   sync-weather [DAYS]    fill weather for recent complete days (default 7)
//   sync-ring [DAYS]       fetch Ultrahuman ring metrics for recent days (default 3)
//   sync-air               read the indoor air monitor now
//   alexa-login            sign in to Amazon once, for the indoor air monitor
//   backup                 encrypted database snapshot
//   publish [MESSAGE]      push the public site now, with an optional commit message
import { latestDone, markInterrupted, publishable, refitUser } from "../server/analysis.ts";
import { createUser, setPassword } from "../server/auth.ts";
import { BACKUP_GPG_RECIPIENT, DEFAULT_TIME_ZONE } from "../server/config.ts";
import { all, get } from "../server/db.ts";
import { createInterface } from "node:readline/promises";
import { backupDue, backupNow, publish, syncWeather } from "../server/maintenance.ts";
import { alexaSignInFinish, alexaSignInStart, syncIndoorAir, syncUltrahuman } from "../server/sources.ts";

const [command, ...args] = process.argv.slice(2);
const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

const usersWithRatings = (only?: string) =>
  all<{ id: number; username: string }>("SELECT DISTINCT u.id, u.username FROM users u JOIN ratings r ON r.user_id = u.id")
    .filter((u) => !only || String(u.id) === only);

async function refit(ifNewData: boolean, only?: string): Promise<void> {
  markInterrupted();
  for (const user of usersWithRatings(only)) {
    const run = await refitUser(user.id, { ifNewData });
    if (!run) {
      log(`${user.username}: data unchanged or a refit is already running; skipped.`);
      continue;
    }
    log(`${user.username}: ${run.status}. ${run.message}`.trim());
    if (run.status !== "done") continue;
    // A fit that fails the convergence checks is kept for the private dashboard,
    // flagged, but never published.
    if (publishable(run)) log(await publish(run).catch((e: Error) => `Publishing failed: ${e.message}`));
    else log(`${user.username}: the fit failed the convergence checks or used another study start, so it was not published.`);
  }
}

/** One failing step (say, no network for weather) must not block the others. */
async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    log(`${name} failed: ${(error as Error).message}`);
  }
}

switch (command) {
  case "create-user": {
    const name = args[0];
    if (!name) throw new Error("Usage: create-user NAME (password on stdin)");
    await createUser(name, await readStdin(), DEFAULT_TIME_ZONE);
    log(`Created ${name} (time zone ${DEFAULT_TIME_ZONE}; change it in Settings).`);
    break;
  }
  case "set-password": {
    const user = get<{ id: number }>("SELECT id FROM users WHERE username = ?", args[0] ?? "");
    if (!user) throw new Error(`No user named ${args[0]}`);
    await setPassword(user.id, await readStdin());
    log(`Password changed for ${args[0]}.`);
    break;
  }
  case "refit": {
    const i = args.indexOf("--user");
    await refit(false, i >= 0 ? args[i + 1] : undefined);
    break;
  }
  case "maintain":
    await step("Weather", async () => log(await syncWeather()));
    await step("Ultrahuman", async () => log(await syncUltrahuman()));
    await step("Indoor air", async () => log(await syncIndoorAir()));
    await step("Refit", () => refit(true));
    if (BACKUP_GPG_RECIPIENT && backupDue()) await step("Backup", async () => log(await backupNow()));
    break;
  case "sync-weather":
    log(await syncWeather(Number(args[0] ?? 7)));
    break;
  case "sync-ring":
    log(await syncUltrahuman(Number(args[0] ?? 3)));
    break;
  case "sync-air":
    log(await syncIndoorAir());
    break;
  case "alexa-login": {
    // The password and any one-time code go only to Amazon's own page, in the browser.
    const start = alexaSignInStart();
    console.log(`1. Open this address in your browser and sign in to Amazon:\n\n${start.url}\n`);
    console.log("2. After signing in, the browser shows an empty or \"not found\" page on amazon.com.");
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    const returned = await prompt.question("   Copy the whole address from the address bar, paste it here and press Enter:\n");
    prompt.close();
    await alexaSignInFinish(returned, start);
    log("Signed in. Reading the monitor once:");
    log(await syncIndoorAir());
    break;
  }
  case "backup":
    log(await backupNow());
    break;
  case "publish": {
    // Without a fit that passed the convergence checks and used the current study
    // start, the pages go out alone and any results.json already published stays.
    const user = usersWithRatings()[0];
    log(await publish(user ? latestDone(user.id) : null, args[0]));
    break;
  }
  default:
    console.log("Commands: create-user, set-password, refit, maintain, sync-weather, sync-ring, sync-air, alexa-login, backup, publish");
    process.exitCode = command ? 1 : 0;
}
