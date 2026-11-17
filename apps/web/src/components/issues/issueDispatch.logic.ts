import { deriveLocalBranchNameFromRemoteRef } from "@t3tools/shared/git";
import type { IssueDetail, IssueState, ThreadId, VcsRef } from "@t3tools/contracts";

const SLUG_MAX = 40;

/** Lowercase words joined by dashes, at most 40 characters. */
export function issueSlug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, SLUG_MAX)
      .replace(/-+$/, "") || "task"
  );
}

/** `fix/12-<slug>` for a git host's `#12`, `eng-123-<slug>` for a tracker key like `ENG-123`. */
export function issueBranchName(issue: { readonly displayKey: string; readonly title: string }) {
  const slug = issueSlug(issue.title);
  return issue.displayKey.startsWith("#")
    ? `fix/${issue.displayKey.slice(1)}-${slug}`
    : `${issue.displayKey.toLowerCase()}-${slug}`;
}

/**
 * The first message of a dispatched thread: `/complete-task` plans the work, asks for approval,
 * builds it and opens a draft pull request. T3 chooses where the worktree lives, so the prompt
 * names no workspace paths.
 */
export function buildIssuePrompt(detail: IssueDetail, branch: string): string {
  const older = detail.commentsCursor === null ? "" : "(Older comments are not shown here.)\n\n";
  const comments =
    detail.comments.length === 0
      ? ""
      : `\n\n## Comments\n\n${older}${detail.comments
          .map(
            (comment) =>
              `### ${comment.author?.login ?? "unknown"} - ${comment.createdAt}\n\n${comment.body}`,
          )
          .join("\n\n---\n\n")}`;
  const description = detail.body.trim() === "" ? "(no description)" : detail.body;
  return `/complete-task # Source: ${detail.displayKey} - ${detail.title}

Source: ${detail.url}
Identifier: ${detail.displayKey}
Title: ${detail.title}
Branch: ${branch}

---

## Description

${description}${comments}`;
}

/**
 * The state a dispatched issue moves to: the first started one in its workflow, while it is
 * open and not started yet. Null where the tracker marks no state as started.
 */
export function issueStartState(detail: Pick<IssueDetail, "state" | "states">): IssueState | null {
  if (detail.state.category !== "open" || detail.state.started === true) return null;
  return detail.states.find((state) => state.started === true) ?? null;
}

/**
 * The branch a worktree for an issue starts from when no forge names a default branch: the
 * repository's default ref, else `main` or `master`.
 */
export function worktreeBase(refs: ReadonlyArray<VcsRef>): string | null {
  const local = new Set(refs.filter((ref) => ref.isRemote !== true).map((ref) => ref.name));
  const remote = new Set(refs.filter((ref) => ref.isRemote === true).map((ref) => ref.name));
  const originDefault = refs.find(
    (ref) => ref.isRemote === true && ref.remoteName === "origin" && ref.isDefault,
  );
  const branch =
    refs.find((ref) => ref.isRemote !== true && ref.isDefault)?.name ??
    (originDefault ? deriveLocalBranchNameFromRemoteRef(originDefault.name) : undefined) ??
    ["main", "master"].find((name) => local.has(name) || remote.has(`origin/${name}`));
  return branch ?? null;
}

const branchKey = (projectId: string, branch: string) => `${projectId}\0${branch}`;

/** The newest open thread on each project branch, for looking up many issues at once. */
export function threadsByBranch(
  threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: string;
    readonly branch: string | null;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  }>,
): ReadonlyMap<string, { readonly id: ThreadId; readonly updatedAt: string }> {
  const byBranch = new Map<string, { readonly id: ThreadId; readonly updatedAt: string }>();
  for (const thread of threads) {
    if (thread.branch === null || thread.archivedAt !== null) continue;
    const key = branchKey(thread.projectId, thread.branch);
    const current = byBranch.get(key);
    if (current === undefined || thread.updatedAt > current.updatedAt) byBranch.set(key, thread);
  }
  return byBranch;
}

/** The thread already working on `branch` in the project, if any. */
export function dispatchedThreadId(
  byBranch: ReturnType<typeof threadsByBranch>,
  projectId: string | undefined,
  branch: string,
): ThreadId | null {
  return projectId === undefined ? null : (byBranch.get(branchKey(projectId, branch))?.id ?? null);
}
