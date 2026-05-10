import { describe, it, expect } from "vitest";
import { Queue } from "../src/queue.js";

const makePending = (id: string) => ({
  id,
  session_id: "s1",
  tool_name: "Bash",
  tool_input: { command: "echo hi" },
  title: "t",
  body: "b",
  permissionRules: ["Bash(echo hi)"],
  createdAt: Date.now(),
});

describe("Queue", () => {
  it("enqueue then findByRequestId returns item", () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    expect(q.findByRequestId("a")?.id).toBe("a");
  });

  it("first resolve wins; second resolve returns false (idempotent)", () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    expect(q.resolve("a", { kind: "approve" })).toBe(true);
    expect(q.resolve("a", { kind: "deny" })).toBe(false);
  });

  it("resolve removes the entry from the queue", () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    q.resolve("a", { kind: "approve" });
    expect(q.findByRequestId("a")).toBeUndefined();
  });

  it("resolve calls awaiting waiter with the decision", async () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    const p = q.waitForDecision("a", 1000);
    q.resolve("a", { kind: "always", permissionRules: ["Bash(echo hi)"] });
    await expect(p).resolves.toEqual({
      kind: "always",
      permissionRules: ["Bash(echo hi)"],
    });
  });

  it("waitForDecision times out if no resolution", async () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    await expect(q.waitForDecision("a", 20)).resolves.toBeNull();
  });

  it("waitForDecision returns 'local' marker when resolved by local", async () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    const p = q.waitForDecision("a", 1000);
    q.resolveLocal("a");
    await expect(p).resolves.toBe("local");
  });

  it("list preserves insertion order", () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    q.enqueue(makePending("b"));
    q.enqueue(makePending("c"));
    expect(q.list().map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("waitForDecision called after resolve still returns the decision (no race)", async () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    q.resolve("a", { kind: "approve" });
    await expect(q.waitForDecision("a", 1000)).resolves.toEqual({ kind: "approve" });
  });

  it("state distinguishes pending / resolved / unknown", () => {
    const q = new Queue();
    expect(q.state("nope")).toBe("unknown");
    q.enqueue(makePending("a"));
    expect(q.state("a")).toBe("pending");
    q.resolve("a", { kind: "approve" });
    expect(q.state("a")).toBe("resolved");
  });

  it("resolveLocal is idempotent like resolve", () => {
    const q = new Queue();
    q.enqueue(makePending("a"));
    expect(q.resolveLocal("a")).toBe(true);
    expect(q.resolveLocal("a")).toBe(false);
    expect(q.resolve("a", { kind: "approve" })).toBe(false);
  });
});
