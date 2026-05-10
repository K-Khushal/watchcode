#!/usr/bin/env node
import { Command } from "commander";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";

const program = new Command();
program
  .name("watchcode")
  .description("Bridge Claude Code permission prompts to a Galaxy Watch")
  .version("0.0.0");

program
  .command("start")
  .description("Register the hook and start the daemon in the background")
  .action(async () => {
    const r = await startCommand();
    process.stdout.write(`watchcode daemon started (pid ${r.pid})\n`);
  });

program
  .command("stop")
  .description("Stop the daemon and remove the hook (use --keep-hook to preserve)")
  .option("--keep-hook", "do not remove the hook entry from settings.json")
  .action(async (opts: { keepHook?: boolean }) => {
    const r = await stopCommand({ keepHook: opts.keepHook });
    process.stdout.write(r.stopped ? "watchcode stopped\n" : "no running daemon\n");
  });

program
  .command("hook")
  .description("Run the hook subprocess (invoked by Claude Code)")
  .action(async () => {
    const { run } = await import("@watchcode/hook");
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const out = await run(Buffer.concat(chunks).toString("utf8"));
    if (out !== null) process.stdout.write(JSON.stringify(out));
  });

program.parseAsync().catch((e) => {
  console.error(e);
  process.exit(1);
});
