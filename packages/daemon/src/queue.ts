import type { DaemonDecision } from "@watchcode/shared";

export interface PendingApproval {
  id: string;
  session_id: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  title: string;
  body: string;
  permissionRules: string[];
  createdAt: number;
}

export type ResolveResult = DaemonDecision | "local";

type Waiter = {
  resolve: (r: ResolveResult | null) => void;
  timer: NodeJS.Timeout;
};

// How long a terminal result lingers so racing long-polls and stop/check
// callers can observe it instead of getting "unknown id" → 204 forever.
const RESOLVED_RETENTION_MS = 60_000;

export class Queue {
  private map = new Map<string, PendingApproval>();
  private waiters = new Map<string, Set<Waiter>>();
  private resolved = new Map<string, ResolveResult>();
  private resolvedTimers = new Map<string, NodeJS.Timeout>();

  enqueue(p: PendingApproval): void {
    this.map.set(p.id, p);
  }

  findByRequestId(id: string): PendingApproval | undefined {
    return this.map.get(id);
  }

  list(): PendingApproval[] {
    return Array.from(this.map.values());
  }

  /**
   * Distinguish three states for the HTTP layer:
   *   "pending"  — id is known and unresolved
   *   "resolved" — id was resolved within retention window
   *   "unknown"  — never seen (or expired)
   */
  state(id: string): "pending" | "resolved" | "unknown" {
    if (this.map.has(id)) return "pending";
    if (this.resolved.has(id)) return "resolved";
    return "unknown";
  }

  getResolved(id: string): ResolveResult | undefined {
    return this.resolved.get(id);
  }

  resolve(id: string, decision: DaemonDecision): boolean {
    if (!this.map.has(id)) return false;
    this.map.delete(id);
    this.recordResolved(id, decision);
    this.flushWaiters(id, decision);
    return true;
  }

  resolveLocal(id: string): boolean {
    if (!this.map.has(id)) return false;
    this.map.delete(id);
    this.recordResolved(id, "local");
    this.flushWaiters(id, "local");
    return true;
  }

  waitForDecision(id: string, timeoutMs: number): Promise<ResolveResult | null> {
    // Fast path: already resolved within retention window.
    const prior = this.resolved.get(id);
    if (prior !== undefined) return Promise.resolve(prior);
    if (!this.map.has(id)) return Promise.resolve(null);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const set = this.waiters.get(id);
        set?.delete(waiter);
        if (set && set.size === 0) this.waiters.delete(id);
        resolve(null);
      }, timeoutMs);
      const waiter: Waiter = { resolve, timer };
      const set = this.waiters.get(id) ?? new Set<Waiter>();
      set.add(waiter);
      this.waiters.set(id, set);
    });
  }

  private flushWaiters(id: string, result: ResolveResult): void {
    const set = this.waiters.get(id);
    if (!set) return;
    this.waiters.delete(id);
    for (const w of set) {
      clearTimeout(w.timer);
      w.resolve(result);
    }
  }

  private recordResolved(id: string, result: ResolveResult): void {
    this.resolved.set(id, result);
    const prev = this.resolvedTimers.get(id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      this.resolved.delete(id);
      this.resolvedTimers.delete(id);
    }, RESOLVED_RETENTION_MS);
    t.unref?.();
    this.resolvedTimers.set(id, t);
  }
}
