import {
  type IssueComment,
  type IssueDetail,
  IssueTrackerKind,
  ProjectId,
  ThreadId,
  type VcsRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildIssuePrompt,
  dispatchedThreadId,
  issueBranchName,
  issueSlug,
  issueStartState,
  threadsByBranch,
  worktreeBase,
} from "./issueDispatch.logic";

const capabilities = {
  create: true,
  edit: true,
  comment: true,
  labels: true,
  assignees: true,
  reactions: true,
  templates: true,
  linkedPullRequests: true,
  events: true,
  search: true,
};

const detail = (overrides: Partial<IssueDetail> = {}): IssueDetail => ({
  tracker: IssueTrackerKind.make("github"),
  host: "github.com",
  scope: "acme/api",
  key: "12",
  displayKey: "#12",
  title: "Crash when saving: a draft!",
  url: "https://github.com/acme/api/issues/12",
  author: { login: "ada", name: null, avatarUrl: null },
  state: { category: "open", name: "Open" },
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
  closedAt: null,
  assignees: [],
  labels: [],
  commentCount: 0,
  projectId: ProjectId.make("p1"),
  projectTitle: "api",
  writable: true,
  capabilities,
  viewerPermissions: { setState: true, comment: true, edit: true, labels: true, assignees: true },
  states: [],
  viewer: "ada",
  body: "Steps to reproduce",
  comments: [],
  commentsCursor: null,
  events: [],
  linkedPullRequests: [],
  ...overrides,
});

const comment = (login: string | null, body: string, createdAt: string): IssueComment => ({
  id: `${login}-${createdAt}`,
  author: login === null ? null : { login, name: null, avatarUrl: null },
  body,
  createdAt,
  url: null,
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
  it.each([
    { displayKey: "#12", expected: "fix/12-crash-when-saving" },
    { displayKey: "ENG-123", expected: "eng-123-crash-when-saving" },
  ])("names $displayKey's branch $expected", ({ displayKey, expected }) => {
    expect(issueBranchName({ displayKey, title: "Crash when saving" })).toBe(expected);
  });
});

describe("buildIssuePrompt", () => {
  it("renders the whole prompt exactly, saying older comments were left out", () => {
    const prompt = buildIssuePrompt(
      detail({
        comments: [comment("grace", "On it", "2026-01-03T00:00:00Z")],
        commentsCursor: "older",
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

(Older comments are not shown here.)

### grace - 2026-01-03T00:00:00Z

On it`);
  });

  it("leaves out the comments section when there are none", () => {
    const prompt = buildIssuePrompt(detail(), "fix/12-crash");
    expect(prompt).toContain("## Description\n\nSteps to reproduce");
    expect(prompt).not.toContain("## Comments");
    expect(prompt).not.toContain("Older comments");
  });

  it("keeps comments oldest first and says so when there is no description", () => {
    const prompt = buildIssuePrompt(
      detail({
        body: "  ",
        comments: [
          comment("grace", "On it", "2026-01-03T00:00:00Z"),
          comment(null, "Thanks", "2026-01-04T00:00:00Z"),
        ],
      }),
      "fix/12-crash",
    );
    expect(prompt).toContain("(no description)");
    expect(prompt.indexOf("### grace")).toBeLessThan(prompt.indexOf("### unknown"));
  });
});

describe("issueStartState", () => {
  const todo = { category: "open", name: "Todo" } as const;
  const inProgress = { category: "open", name: "In Progress", started: true } as const;
  const done = { category: "closed", name: "Done", closeReason: "completed" } as const;
  const states = [todo, inProgress, { ...inProgress, name: "In Review" }, done];

  it.each([
    { name: "an unstarted issue to the first started state", state: todo, expected: inProgress },
    { name: "a started issue nowhere", state: inProgress, expected: null },
    { name: "a closed issue nowhere", state: done, expected: null },
  ])("moves $name", ({ state, expected }) => {
    expect(issueStartState({ state, states })).toEqual(expected);
  });

  it("moves nothing on a tracker that marks no state started", () => {
    expect(issueStartState({ state: todo, states: [todo, done] })).toBeNull();
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
