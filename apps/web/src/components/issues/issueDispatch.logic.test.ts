import {
  type IssueDetail,
  type LinearIssueDetail,
  type LinearIssueSummary,
  ThreadId,
  type VcsRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildIssuePrompt,
  buildLinearIssuePrompt,
  dispatchedThreadId,
  issueBranchName,
  issueSlug,
  linearBranchName,
  threadsByBranch,
  worktreeBase,
} from "./issueDispatch.logic";

const detail = (overrides: Partial<IssueDetail> = {}): IssueDetail => ({
  issue: {
    host: "github.com",
    repository: "acme/api",
    number: 12,
    title: "Crash when saving: a draft!",
    state: "open",
    url: "https://github.com/acme/api/issues/12",
    author: "ada",
    assignees: [],
    labels: [],
    commentCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
  },
  body: "Steps to reproduce",
  defaultBranch: "main",
  comments: [],
  commentsTruncated: false,
  ...overrides,
});

describe("issueSlug", () => {
  it("keeps lowercase words and drops punctuation", () => {
    expect(issueSlug("Crash when saving: a draft!")).toBe("crash-when-saving-a-draft");
  });

  it("stops at 40 characters without a trailing dash", () => {
    const slug = issueSlug("word ".repeat(20));
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back to task when nothing is left", () => {
    expect(issueSlug("!!! ???")).toBe("task");
  });
});

describe("issueBranchName", () => {
  it("is fix/<number>-<slug>", () => {
    expect(issueBranchName({ number: 12, title: "Crash when saving" })).toBe(
      "fix/12-crash-when-saving",
    );
  });
});

describe("buildIssuePrompt", () => {
  it("renders the whole GitHub prompt exactly", () => {
    const prompt = buildIssuePrompt(
      detail({
        comments: [{ author: "grace", body: "On it", createdAt: "2026-01-03T00:00:00Z" }],
        commentsTruncated: true,
      }),
      "fix/12-crash",
    );
    expect(prompt).toBe(`/complete-task # Source: #12 - Crash when saving: a draft!

Source: https://github.com/acme/api/issues/12
Identifier: #12
Title: Crash when saving: a draft!
Branch: fix/12-crash

---

## Description

Steps to reproduce

## Comments

### grace - 2026-01-03T00:00:00Z

On it

(The thread has more comments than are shown here.)`);
  });

  it("runs /complete-task with the issue's header, description and no comments section", () => {
    const prompt = buildIssuePrompt(detail(), "fix/12-crash");
    expect(prompt.startsWith("/complete-task # Source: #12 - Crash when saving: a draft!")).toBe(
      true,
    );
    expect(prompt).toContain("Source: https://github.com/acme/api/issues/12");
    expect(prompt).toContain("Branch: fix/12-crash");
    expect(prompt).toContain("## Description\n\nSteps to reproduce");
    expect(prompt).not.toContain("## Comments");
  });

  it("says when the thread has more comments than the prompt carries", () => {
    const prompt = buildIssuePrompt(
      detail({
        comments: [{ author: "grace", body: "On it", createdAt: "2026-01-03T00:00:00Z" }],
        commentsTruncated: true,
      }),
      "fix/12-crash",
    );
    expect(prompt).toContain("more comments than are shown");
    expect(buildIssuePrompt(detail(), "fix/12-crash")).not.toContain("more comments");
  });

  it("appends comments oldest first and says so when there is no description", () => {
    const prompt = buildIssuePrompt(
      detail({
        body: "  ",
        comments: [
          { author: "grace", body: "On it", createdAt: "2026-01-03T00:00:00Z" },
          { author: null, body: "Thanks", createdAt: "2026-01-04T00:00:00Z" },
        ],
      }),
      "fix/12-crash",
    );
    expect(prompt).toContain("(no description)");
    expect(prompt.indexOf("### grace")).toBeLessThan(prompt.indexOf("### unknown"));
  });
});

const linearIssue: LinearIssueSummary = {
  id: "uuid-1",
  identifier: "ENG-123",
  title: "Fix login",
  url: "https://linear.app/acme/issue/ENG-123/fix-login",
  priority: 2,
  state: { name: "Todo", type: "unstarted", color: "#e2e2e2" },
  team: { id: "team-1", name: "Engineering" },
  project: null,
  assignee: null,
  updatedAt: "2026-01-02T00:00:00Z",
};

const linearDetail: LinearIssueDetail = {
  description: "",
  comments: [],
  commentsTruncated: false,
};

describe("Linear dispatch", () => {
  it("branches as <identifier>-<slug>", () => {
    expect(linearBranchName(linearIssue)).toBe("eng-123-fix-login");
  });

  it("uses the GitHub template with the Linear identifier", () => {
    expect(buildLinearIssuePrompt(linearIssue, linearDetail, "eng-123-fix-login")).toBe(
      `/complete-task # Source: ENG-123 - Fix login

Source: https://linear.app/acme/issue/ENG-123/fix-login
Identifier: ENG-123
Title: Fix login
Branch: eng-123-fix-login

---

## Description

(no description)`,
    );
  });
});

const ref = (name: string, overrides: Partial<VcsRef> = {}): VcsRef => ({
  name,
  current: false,
  isDefault: false,
  worktreePath: null,
  ...overrides,
});

describe("worktreeBase", () => {
  it.each([
    {
      name: "the local default",
      refs: [ref("trunk", { isDefault: true }), ref("origin/trunk", { isRemote: true })],
      expected: "trunk",
    },
    {
      name: "origin's default when no local branch is marked",
      refs: [ref("origin/develop", { isRemote: true, remoteName: "origin", isDefault: true })],
      expected: "develop",
    },
    {
      name: "main without a remote, locally",
      refs: [ref("feature"), ref("main")],
      expected: "main",
    },
    { name: "nothing to start from", refs: [ref("feature")], expected: null },
  ])("picks $name", ({ refs, expected }) => {
    expect(worktreeBase(refs)).toEqual(expected);
  });
});

describe("dispatchedThreadId", () => {
  const thread = (
    id: string,
    projectId: string,
    updatedAt: string,
    archivedAt: string | null = null,
  ) => ({
    id: ThreadId.make(id),
    projectId,
    branch: "fix/12-crash",
    archivedAt,
    updatedAt,
  });

  it("finds the newest open thread on the branch in that project only", () => {
    const threads = [
      thread("other-repo", "p2", "2026-01-09T00:00:00Z"),
      thread("old", "p1", "2026-01-01T00:00:00Z"),
      thread("new", "p1", "2026-01-02T00:00:00Z"),
      thread("archived", "p1", "2026-01-08T00:00:00Z", "2026-01-08T00:00:00Z"),
    ];
    const byBranch = threadsByBranch(threads);
    expect(dispatchedThreadId(byBranch, "p1", "fix/12-crash")).toBe("new");
    expect(dispatchedThreadId(byBranch, "p3", "fix/12-crash")).toBeNull();
    expect(dispatchedThreadId(byBranch, undefined, "fix/12-crash")).toBeNull();
  });
});
