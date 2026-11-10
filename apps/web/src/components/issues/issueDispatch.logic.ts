import { deriveLocalBranchNameFromRemoteRef } from "@t3tools/shared/git";
import type {
  IssueComment,
  IssueDetail,
  LinearIssueDetail,
  LinearIssueSummary,
  ThreadId,
  VcsRef,
} from "@t3tools/contracts";

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

export function issueBranchName(issue: { readonly number: number; readonly title: string }) {
  return `fix/${issue.number}-${issueSlug(issue.title)}`;
}

/** `eng-123-<slug>`: the identifier lowercased, then the title. */
export function linearBranchName(issue: { readonly identifier: string; readonly title: string }) {
  return `${issue.identifier.toLowerCase()}-${issueSlug(issue.title)}`;
}

/** What the dispatch prompt carries, whichever tracker the issue lives in. */
interface PromptSource {
  /** `#12` or `ENG-123`. */
  readonly identifier: string;
  readonly title: string;
  readonly url: string;
  readonly description: string;
  readonly comments: ReadonlyArray<IssueComment>;
  readonly commentsTruncated: boolean;
}

/**
 * The first message of a dispatched thread: `/complete-task` plans the work, asks for approval,
 * builds it and opens a draft pull request. T3 chooses where the worktree lives, so the prompt
 * names no workspace paths.
 */
export function buildIssuePrompt(detail: IssueDetail, branch: string): string {
  return buildPrompt(
    {
      identifier: `#${detail.issue.number}`,
      title: detail.issue.title,
      url: detail.issue.url,
      description: detail.body,
      comments: detail.comments,
      commentsTruncated: detail.commentsTruncated,
    },
    branch,
  );
}

export function buildLinearIssuePrompt(
  issue: LinearIssueSummary,
  detail: LinearIssueDetail,
  branch: string,
): string {
  return buildPrompt(
    {
      identifier: issue.identifier,
      title: issue.title,
      url: issue.url,
      description: detail.description,
      comments: detail.comments,
      commentsTruncated: detail.commentsTruncated,
    },
    branch,
  );
}

function buildPrompt(source: PromptSource, branch: string): string {
  const comments =
    source.comments.length === 0
      ? ""
      : `\n\n## Comments\n\n${source.comments
          .map(
            (comment) =>
              `### ${comment.author ?? "unknown"} - ${comment.createdAt}\n\n${comment.body}`,
          )
          .join("\n\n---\n\n")}`;
  const truncated = source.commentsTruncated
    ? "\n\n(The thread has more comments than are shown here.)"
    : "";
  const description = source.description.trim() === "" ? "(no description)" : source.description;
  return `/complete-task # Source: ${source.identifier} - ${source.title}

Source: ${source.url}
Identifier: ${source.identifier}
Title: ${source.title}
Branch: ${branch}

---

## Description

${description}${comments}${truncated}`;
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
