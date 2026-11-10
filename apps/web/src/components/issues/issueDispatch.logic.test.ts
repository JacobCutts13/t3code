import type { IssueDetail } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildIssuePrompt, issueBranchName, issueSlug } from "./issueDispatch.logic";

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
