import type {
  IssueComment,
  IssueDetail,
  LinearIssueDetail,
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

export function buildLinearIssuePrompt(detail: LinearIssueDetail, branch: string): string {
  return buildPrompt(
    {
      identifier: detail.issue.identifier,
      title: detail.issue.title,
      url: detail.issue.url,
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
 * Where a worktree for an issue starts when no forge names a default branch: the repository's
 * default ref, else `main` or `master`. It starts from origin only when origin has that branch.
 */
export function worktreeBase(
  refs: ReadonlyArray<VcsRef>,
): { readonly branch: string; readonly startFromOrigin: boolean } | null {
  const local = new Set(refs.filter((ref) => ref.isRemote !== true).map((ref) => ref.name));
  const remote = new Set(refs.filter((ref) => ref.isRemote === true).map((ref) => ref.name));
  const remoteDefault = refs.find((ref) => ref.isRemote === true && ref.isDefault)?.name;
  const branch =
    refs.find((ref) => ref.isRemote !== true && ref.isDefault)?.name ??
    (remoteDefault?.startsWith("origin/") ? remoteDefault.slice("origin/".length) : undefined) ??
    ["main", "master"].find((name) => local.has(name) || remote.has(`origin/${name}`));
  return branch === undefined ? null : { branch, startFromOrigin: remote.has(`origin/${branch}`) };
}

/** The newest open thread already working on `branch` in the project, if any. */
export function dispatchedThreadId(
  threads: ReadonlyArray<{
    readonly id: ThreadId;
    readonly projectId: string;
    readonly branch: string | null;
    readonly archivedAt: string | null;
    readonly updatedAt: string;
  }>,
  projectId: string | undefined,
  branch: string,
): ThreadId | null {
  if (projectId === undefined) return null;
  const matches = threads.filter(
    (thread) =>
      thread.projectId === projectId && thread.branch === branch && thread.archivedAt === null,
  );
  return (
    matches.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.id ?? null
  );
}
