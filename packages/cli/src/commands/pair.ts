import { DAEMON_HOST, DAEMON_PORT } from "@watchcode/shared";

export interface PairOptions {
  host?: string;
  port?: number;
}

export async function pairCommand(opts: PairOptions = {}): Promise<void> {
  const host = opts.host ?? DAEMON_HOST;
  const port = opts.port ?? DAEMON_PORT;
  const base = `http://${host}:${port}`;

  const beginRes = await fetch(`${base}/pair/begin`, { method: "POST" });
  if (!beginRes.ok) {
    throw new Error(`Daemon returned ${beginRes.status} — is it running? (watchcode start)`);
  }
  const { code, expires_in_seconds } = (await beginRes.json()) as {
    code: string;
    expires_in_seconds: number;
  };

  process.stdout.write(`Pairing code: ${code} (${expires_in_seconds}s remaining)\n`);
  process.stdout.write("On your Galaxy Watch, open WatchCode and enter this code.\n");

  const deadline = Date.now() + expires_in_seconds * 1000;
  let paired = false;

  while (Date.now() < deadline) {
    await sleep(1000);

    const statusRes = await fetch(`${base}/pair/status`);
    if (statusRes.status === 204) {
      // No active session — window expired without pairing
      break;
    }
    if (!statusRes.ok) continue;

    const status = (await statusRes.json()) as
      | { active: true; code: string; seconds_remaining: number }
      | { active: false; completed: true };

    if (!status.active && status.completed) {
      // Watch completed pairing successfully
      paired = true;
      break;
    }

    if (status.active) {
      process.stdout.write(`\rPairing code: ${code} (${status.seconds_remaining}s remaining)   `);
    }
  }

  process.stdout.write("\n");
  if (paired) {
    process.stdout.write("Paired successfully!\n");
  } else {
    process.stdout.write("Pairing window expired. Run `watchcode pair` to try again.\n");
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
