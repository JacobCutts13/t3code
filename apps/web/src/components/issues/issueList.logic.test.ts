import type { IssueSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mergeIssuePages } from "./issueList.logic";

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
