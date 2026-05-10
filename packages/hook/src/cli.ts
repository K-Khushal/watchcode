#!/usr/bin/env node
import { run } from "./run.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const stdin = await readStdin();
  const out = await run(stdin);
  if (out !== null) {
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
}

main().catch(() => {
  // Hook must never block CC: exit 0 silently on any unexpected error.
  process.exit(0);
});
