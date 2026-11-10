import type { IssueSummary, LinearIssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeIssuePages, mergeIssueSources } from "./issueList.logic";

const issue = (number: number, updatedAt: string): IssueSummary => ({
  host: "github.com",
  repository: "acme/api",
  number,
  title: `Issue ${number}`,
  state: "open",
  url: `https://github.com/acme/api/issues/${number}`,
  author: null,
  assignees: [],
  labels: [],
  commentCount: 0,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt,
});

describe("mergeIssuePages", () => {
  it("joins pages newest update first", () => {
    const merged = mergeIssuePages([
      [issue(1, "2026-01-05T00:00:00Z")],
      [issue(2, "2026-01-07T00:00:00Z"), issue(3, "2026-01-02T00:00:00Z")],
    ]);
    expect(merged.map((entry) => entry.number)).toEqual([2, 1, 3]);
  });

  it("keeps one copy of an issue that arrives on two pages", () => {
    const merged = mergeIssuePages([
      [issue(1, "2026-01-05T00:00:00Z")],
      [issue(1, "2026-01-05T00:00:00Z"), issue(2, "2026-01-04T00:00:00Z")],
    ]);
    expect(merged.map((entry) => entry.number)).toEqual([1, 2]);
  });
});

describe("mergeIssueSources", () => {
  it("interleaves GitHub and Linear issues newest update first", () => {
    const linear = (id: string, updatedAt: string): LinearIssueSummary => ({
      id,
      identifier: `ENG-${id}`,
      title: id,
      url: `https://linear.app/acme/issue/ENG-${id}`,
      priority: 0,
      state: { name: "Todo", type: "unstarted", color: "#e2e2e2" },
      team: { id: "t", name: "Engineering" },
      project: null,
      assignee: null,
      updatedAt,
    });
    const merged = mergeIssueSources(
      [issue(1, "2026-01-05T00:00:00Z")],
      [linear("a", "2026-01-06T00:00:00Z"), linear("b", "2026-01-01T00:00:00Z")],
    );
    expect(merged.map((entry) => entry.key)).toEqual([
      "linear:a",
      "github.com/acme/api#1",
      "linear:b",
    ]);
  });
});
