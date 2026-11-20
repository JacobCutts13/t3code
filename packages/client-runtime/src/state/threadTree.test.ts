import { EnvironmentId, ThreadId, type OrchestrationV2ThreadShell } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildThreadTree,
  flattenThreadTree,
  resolveThreadTreeRowRef,
  sortThreadTreeRoots,
  type ThreadTreeThread,
} from "./threadTree.ts";

const env = EnvironmentId.make("env");
const otherEnv = EnvironmentId.make("other-env");

type Row = ThreadTreeThread & { readonly archivedAt: string | null; readonly at: number };

function row(
  id: string,
  options: {
    parent?: string;
    relationship?: "fork" | "subagent";
    sideChat?: boolean;
    creationSource?: OrchestrationV2ThreadShell["creationSource"];
    delegatedFrom?: { environmentId: EnvironmentId; threadId: string };
    environmentId?: EnvironmentId;
    createdAt?: string;
    at?: number;
  } = {},
): Row {
  return {
    id: ThreadId.make(id),
    environmentId: options.environmentId ?? env,
    lineage: {
      rootThreadId: ThreadId.make(options.parent ?? id),
      parentThreadId: options.parent === undefined ? null : ThreadId.make(options.parent),
      relationshipToParent: options.parent === undefined ? null : (options.relationship ?? "fork"),
      ...(options.sideChat ? { sideChat: true } : {}),
    },
    delegatedFrom:
      options.delegatedFrom === undefined
        ? null
        : {
            environmentId: options.delegatedFrom.environmentId,
            threadId: ThreadId.make(options.delegatedFrom.threadId),
          },
    createdAt: options.createdAt ?? "2026-01-01T00:00:00.000Z",
    source: { creationSource: options.creationSource ?? "web" },
    archivedAt: null,
    at: options.at ?? 0,
  } as Row;
}

const ids = (threads: readonly Row[]) => threads.map((thread) => thread.id);

describe("buildThreadTree", () => {
  it("nests forks, app-owned subagents and delegated tasks under listed parents, recursively", () => {
    const parent = row("parent");
    const fork = row("fork", { parent: "parent", createdAt: "2026-01-02T00:00:00.000Z" });
    const subagent = row("subagent", {
      parent: "parent",
      relationship: "subagent",
      creationSource: "mcp",
      createdAt: "2026-01-01T12:00:00.000Z",
    });
    const forkOfFork = row("fork-of-fork", { parent: "fork" });
    const delegated = row("delegated", {
      environmentId: otherEnv,
      delegatedFrom: { environmentId: env, threadId: "parent" },
      createdAt: "2026-01-03T00:00:00.000Z",
    });
    const tree = buildThreadTree([forkOfFork, delegated, fork, subagent, parent]);

    expect(ids(tree.roots)).toEqual(["parent"]);
    expect(ids(tree.children(parent))).toEqual(["subagent", "fork", "delegated"]);
    expect(ids(tree.children(fork))).toEqual(["fork-of-fork"]);
    expect(tree.parent(forkOfFork)).toBe(fork);
    expect(
      flattenThreadTree(tree, tree.roots, () => false).map((entry) => [
        entry.thread.id,
        entry.depth,
      ]),
    ).toEqual([
      ["parent", 0],
      ["subagent", 1],
      ["fork", 1],
      ["fork-of-fork", 2],
      ["delegated", 1],
    ]);
    expect(
      ids(flattenThreadTree(tree, tree.roots, (t) => t === fork).map((e) => e.thread)),
    ).toEqual(["parent", "subagent", "fork", "delegated"]);
  });

  it("keeps a child whose parent is not listed as its own root, and breaks parent cycles", () => {
    const orphan = row("orphan", { parent: "missing" });
    const left = row("left", { parent: "right" });
    const right = row("right", { parent: "left" });
    const hanger = row("hanger", { parent: "left" });
    const tree = buildThreadTree([orphan, left, right, hanger]);

    expect(ids(tree.roots)).toEqual(["orphan", "left", "right"]);
    expect(ids(tree.children(left))).toEqual(["hanger"]);
  });
});

describe("sortThreadTreeRoots", () => {
  const byActivity = (threads: readonly Row[]) => [...threads].sort((a, b) => b.at - a.at);

  it("ranks a root by the latest activity in its group, unless it keeps a manual place", () => {
    const quiet = row("quiet", { at: 1 });
    const busy = row("busy", { at: 5 });
    const child = row("child", { parent: "quiet", at: 9 });
    const tree = buildThreadTree([quiet, busy, child]);

    expect(ids(sortThreadTreeRoots(tree.roots, tree, byActivity))).toEqual(["quiet", "busy"]);
    expect(ids(sortThreadTreeRoots(tree.roots, tree, byActivity, (r) => r === quiet))).toEqual([
      "busy",
      "quiet",
    ]);
  });
});

describe("resolveThreadTreeRowRef", () => {
  const parent = row("parent");
  const child = row("child", { parent: "parent", relationship: "subagent", creationSource: "mcp" });
  const sideChat = row("side", { parent: "child", sideChat: true });
  const nativeSubagent = row("native", {
    parent: "parent",
    relationship: "subagent",
    creationSource: "provider",
  });
  const threads = [parent, child, sideChat, nativeSubagent];
  const ref = (id: string) => ({ environmentId: env, threadId: ThreadId.make(id) });

  it("highlights a visible child, and its collapsed ancestor otherwise", () => {
    expect(resolveThreadTreeRowRef(ref("child"), threads, () => false)).toEqual(ref("child"));
    expect(resolveThreadTreeRowRef(ref("child"), threads, (t) => t === parent)).toEqual(
      ref("parent"),
    );
  });

  it("resolves side chats and provider-native subagents to the nearest row", () => {
    expect(resolveThreadTreeRowRef(ref("side"), threads, () => false)).toEqual(ref("child"));
    expect(resolveThreadTreeRowRef(ref("native"), threads, () => false)).toEqual(ref("parent"));
  });
});
