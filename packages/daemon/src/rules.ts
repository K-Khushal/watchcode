// A rule whose payload contains a literal `)` or newline can break Claude
// Code's matcher and produce a malformed entry in settings. Rather than try
// to escape, we drop such rules — Slice 2 keeps the rule grammar exact-match
// only; Slice 6 may add a richer grammar.
function safeArg(s: string): string | null {
  if (s.includes(")") || /[\r\n]/.test(s)) return null;
  return s;
}

export function buildPermissionRules(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  const str = (k: string): string | null => {
    const v = input[k];
    if (typeof v !== "string") return null;
    return safeArg(v);
  };

  switch (toolName) {
    case "Bash": {
      const cmd = str("command");
      return cmd ? [`Bash(${cmd})`] : [];
    }
    case "Edit": {
      const p = str("file_path");
      return p ? [`Edit(${p})`] : [];
    }
    case "Write": {
      const p = str("file_path");
      return p ? [`Write(${p})`] : [];
    }
    case "WebFetch": {
      const u = str("url");
      return u ? [`WebFetch(${u})`] : [];
    }
    default:
      // No safe parameterised rule for unknown tools — return empty so the
      // hook emits an `allow` with no rule, never a too-broad bare-tool rule.
      return [];
  }
}

export function buildTitle(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const str = (k: string): string | null =>
    typeof input[k] === "string" ? (input[k] as string) : null;
  switch (toolName) {
    case "Bash": {
      const desc = str("description")?.trim();
      const cmd = str("command") ?? "";
      return `Allow Claude to run "${desc || truncate(cmd, 60)}"?`;
    }
    case "Edit":
      return `Do you want to make this edit to ${baseName(str("file_path") ?? "")}?`;
    case "Write":
      return `Do you want to create ${baseName(str("file_path") ?? "")}?`;
    case "WebFetch":
      return `Allow Claude to fetch ${urlHost(str("url") ?? "")}?`;
    default:
      return `Allow Claude to use ${toolName}?`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function baseName(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function urlHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}
