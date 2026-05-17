import { DAEMON_HOST, DAEMON_PORT } from "@watchcode/shared";

export interface UnpairOptions {
  host?: string;
  port?: number;
}

export async function unpairCommand(name: string, opts: UnpairOptions = {}): Promise<void> {
  const host = opts.host ?? DAEMON_HOST;
  const port = opts.port ?? DAEMON_PORT;
  const base = `http://${host}:${port}`;

  const res = await fetch(`${base}/pair/remove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });

  if (res.status === 404) {
    process.stdout.write(`No paired watch named "${name}"\n`);
    process.exit(1);
  }
  if (!res.ok) {
    throw new Error(`Daemon returned ${res.status}`);
  }
  process.stdout.write(`Unpaired "${name}"\n`);
}
