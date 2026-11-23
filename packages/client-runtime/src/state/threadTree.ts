import type { OrchestrationV2ThreadShell, ScopedThreadRef } from "@t3tools/contracts";
import { isProviderNativeSubagentThread } from "@t3tools/contracts";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { parseThreadKey, threadKey } from "./entities.ts";
import type { EnvironmentThreadShell } from "./models.ts";

export type ThreadTreeThread = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "lineage" | "delegatedFrom" | "createdAt"
> & { readonly source: Pick<OrchestrationV2ThreadShell, "creationSource"> };

/** Side chats and provider-native subagents live in their parent's view; every other thread gets a row. */
export function isThreadTreeRow(thread: ThreadTreeThread): boolean {
  return (
    thread.lineage.sideChat !== true &&
    !isProviderNativeSubagentThread({
      lineage: thread.lineage,
      creationSource: thread.source.creationSource,
    })
  );
}

/**
 * The thread a row nests under: a fork's or app-owned subagent's parent, or the thread a
 * linked environment delegated it from. Null for top-level threads and threads with no row.
 */
function threadTreeParentRef(thread: ThreadTreeThread): ScopedThreadRef | null {
  if (!isThreadTreeRow(thread)) return null;
  const { parentThreadId, relationshipToParent } = thread.lineage;
  if (parentThreadId !== null && relationshipToParent !== null) {
    return { environmentId: thread.environmentId, threadId: parentThreadId };
  }
  return thread.delegatedFrom == null
    ? null
    : {
        environmentId: thread.delegatedFrom.environmentId,
        threadId: thread.delegatedFrom.threadId,
      };
}

const refOf = (thread: Pick<ThreadTreeThread, "environmentId" | "id">) =>
  threadKey({ environmentId: thread.environmentId, threadId: thread.id });

export interface ThreadTree<T> {
  /** Rows with no listed parent, in input order. */
  readonly roots: readonly T[];
  /** Direct children, oldest first. */
  readonly children: (thread: T) => readonly T[];
  readonly parent: (thread: T) => T | undefined;
  /** The outermost listed ancestor, or the thread itself. */
  readonly root: (thread: T) => T;
}

const NO_CHILDREN: readonly never[] = [];

/**
 * Nests each row under its parent when the parent is itself one of `rows`; otherwise the row is
 * a root, so a child whose parent is archived, missing or hidden keeps a row of its own. Rows on
 * a parent cycle become roots. Pass the list's own rows, already filtered to `isThreadTreeRow`.
 */
export function buildThreadTree<T extends ThreadTreeThread>(rows: readonly T[]): ThreadTree<T> {
  const byKey = new Map(rows.map((row) => [refOf(row), row] as const));
  const listedParent = (row: T) => {
    const ref = threadTreeParentRef(row);
    return ref === null ? undefined : byKey.get(threadKey(ref));
  };
  const parentByKey = new Map<string, T>();
  for (const row of rows) {
    const parent = listedParent(row);
    if (parent === undefined) continue;
    const seen = new Set([refOf(row)]);
    let ancestor: T | undefined = parent;
    while (ancestor !== undefined && !seen.has(refOf(ancestor))) {
      seen.add(refOf(ancestor));
      ancestor = listedParent(ancestor);
    }
    if (ancestor === undefined || refOf(ancestor) !== refOf(row))
      parentByKey.set(refOf(row), parent);
  }
  const childrenByKey = new Map<string, T[]>();
  const roots: T[] = [];
  for (const row of rows) {
    const parent = parentByKey.get(refOf(row));
    if (parent === undefined) {
      roots.push(row);
      continue;
    }
    const siblings = childrenByKey.get(refOf(parent));
    if (siblings === undefined) childrenByKey.set(refOf(parent), [row]);
    else siblings.push(row);
  }
  for (const siblings of childrenByKey.values()) {
    siblings.sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id),
    );
  }
  return {
    roots,
    children: (thread) => childrenByKey.get(refOf(thread)) ?? NO_CHILDREN,
    parent: (thread) => parentByKey.get(refOf(thread)),
    root: (thread) => {
      let root = thread;
      for (let parent = parentByKey.get(refOf(root)); parent; parent = parentByKey.get(refOf(root)))
        root = parent;
      return root;
    },
  };
}

function threadTreeDescendants<T>(tree: ThreadTree<T>, thread: T): T[] {
  const out: T[] = [];
  const visit = (node: T) => {
    for (const child of tree.children(node)) {
      out.push(child);
      visit(child);
    }
  };
  visit(thread);
  return out;
}

export interface ThreadTreeRowEntry<T> {
  readonly thread: T;
  readonly depth: number;
  readonly parent: T | undefined;
}

/** Each root followed by its descendants depth first, skipping those under a collapsed row. */
export function flattenThreadTree<T>(
  tree: ThreadTree<T>,
  roots: readonly T[],
  isCollapsed: (thread: T) => boolean,
): ThreadTreeRowEntry<T>[] {
  const out: ThreadTreeRowEntry<T>[] = [];
  const visit = (thread: T, depth: number, parent: T | undefined) => {
    out.push({ thread, depth, parent });
    if (isCollapsed(thread)) return;
    for (const child of tree.children(thread)) visit(child, depth + 1, thread);
  };
  for (const root of roots) visit(root, 0, undefined);
  return out;
}

/**
 * Orders roots by their group's activity: `sort` ranks the roots together with their
 * descendants, and each root takes its best-ranked member's place. A root `keepsOwnPlace`
 * (a manual order key) keeps its own rank, so manual order still wins.
 */
export function sortThreadTreeRoots<T>(
  roots: readonly T[],
  tree: ThreadTree<T>,
  sort: (threads: readonly T[]) => readonly T[],
  keepsOwnPlace: (root: T) => boolean = () => false,
): T[] {
  const members = roots.flatMap((root) =>
    keepsOwnPlace(root) ? [root] : [root, ...threadTreeDescendants(tree, root)],
  );
  if (members.length === roots.length) return [...sort(roots)];
  const ordered = new Set<T>();
  for (const thread of sort(members)) ordered.add(tree.root(thread));
  return [...ordered];
}

/**
 * The row standing for an open thread: a side chat or provider-native subagent resolves to the
 * nearest ancestor with a row, and a nested row hidden by a collapsed ancestor to the outermost
 * collapsed one. A broken chain resolves to the thread itself.
 */
export function resolveThreadTreeRowRef<
  T extends ThreadTreeThread & Pick<EnvironmentThreadShell, "archivedAt">,
>(
  ref: ScopedThreadRef,
  threads: readonly T[],
  isCollapsed: (thread: T) => boolean,
): ScopedThreadRef {
  const find = (target: ScopedThreadRef) =>
    threads.find(
      (thread) => thread.id === target.threadId && thread.environmentId === target.environmentId,
    );
  const visited = new Set<string>();
  let current = find(ref);
  while (current !== undefined && !isThreadTreeRow(current)) {
    if (visited.has(refOf(current)) || current.lineage.parentThreadId === null) return ref;
    visited.add(refOf(current));
    current = find({
      environmentId: current.environmentId,
      threadId: current.lineage.parentThreadId,
    });
  }
  if (current === undefined) return ref;
  let row = current;
  for (
    let ancestorRef = threadTreeParentRef(current);
    ancestorRef !== null && !visited.has(threadKey(ancestorRef));
  ) {
    visited.add(threadKey(ancestorRef));
    const ancestor = find(ancestorRef);
    if (ancestor === undefined || ancestor.archivedAt !== null || !isThreadTreeRow(ancestor)) break;
    if (isCollapsed(ancestor)) row = ancestor;
    ancestorRef = threadTreeParentRef(ancestor);
  }
  return { environmentId: row.environmentId, threadId: row.id };
}

/**
 * Why Fork is unavailable, or null; undefined hides it. The server forks at the latest completed
 * run and stays authoritative. `supported`: the server's `forkOnLaunch`, without which a fork's
 * first send would start a plain thread.
 */
export function threadForkBlockedReason(
  thread: {
    readonly lineage: { readonly sideChat?: boolean | undefined };
    readonly latestRun: { readonly completedAt: string | null } | null;
    readonly branch: string | null;
    readonly worktreePath: string | null;
  },
  supported: boolean,
  resolve: MFunctionType = mFallback,
): string | null | undefined {
  // A fork's worktree starts from its parent's branch; a detached worktree has none.
  if (!supported || (thread.worktreePath !== null && thread.branch === null)) return undefined;
  if (thread.lineage.sideChat === true) return resolve(msg("Side chats can't be forked"));
  if (thread.latestRun?.completedAt == null)
    return resolve(msg("Available after a completed turn"));
  return null;
}

const FORK_DRAFT_KEY_PREFIX = "fork:";

/** A fork is a draft of its own, keyed by its source, until its first message creates it. */
export function forkDraftKey(source: ScopedThreadRef): string {
  return `${FORK_DRAFT_KEY_PREFIX}${threadKey(source)}`;
}

/** The thread a draft forks, or null for an ordinary draft. */
export function forkDraftSource(draftKey: string | undefined): ScopedThreadRef | null {
  return draftKey?.startsWith(FORK_DRAFT_KEY_PREFIX) === true
    ? parseThreadKey(draftKey.slice(FORK_DRAFT_KEY_PREFIX.length))
    : null;
}
