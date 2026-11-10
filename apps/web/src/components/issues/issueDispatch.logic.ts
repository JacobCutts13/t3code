import type { IssueDetail } from "@t3tools/contracts";

const SLUG_MAX = 40;

/** Lowercase words joined by dashes, at most 40 characters, as cockpit names its branches. */
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

/**
 * The first message of a dispatched thread: `/complete-task` plans the work, asks for approval,
 * builds it and opens a draft pull request. T3 chooses where the worktree lives, so unlike
 * cockpit's version this names no workspace paths.
 */
export function buildIssuePrompt(detail: IssueDetail, branch: string): string {
  const { issue } = detail;
  const comments =
    detail.comments.length === 0
      ? ""
      : `\n\n## Comments\n\n${detail.comments
          .map(
            (comment) =>
              `### ${comment.author ?? "unknown"} - ${comment.createdAt}\n\n${comment.body}`,
          )
          .join("\n\n---\n\n")}`;
  const description = detail.body.trim() === "" ? "(no description)" : detail.body;
  return `/complete-task # Source: #${issue.number} - ${issue.title}

Source: ${issue.url}
Identifier: #${issue.number}
Title: ${issue.title}
Branch: ${branch}

---

## Description

${description}${comments}`;
}
