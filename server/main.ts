import { createServer, type Server } from "node:http";
import { markInterrupted } from "./analysis.ts";
import { PORT } from "./config.ts";
import { createHandler } from "./http.ts";
import { sendDueReminders } from "./push.ts";
import { router } from "./routes.ts";

export function startServer(port = PORT): Promise<Server> {
  const server = createServer(createHandler(router));
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.main) {
  markInterrupted();
  const server = await startServer();
  console.log(`A Study On Myself on http://127.0.0.1:${(server.address() as { port: number }).port}`);
  // Reminders are checked every minute; a slot that comes due while the Mac
  // sleeps is reminded when it wakes, if the slot is still open.
  setInterval(() => {
    sendDueReminders().catch((error: Error) => console.error(`${new Date().toISOString()} Reminders failed: ${error.message}`));
  }, 60_000);
}
