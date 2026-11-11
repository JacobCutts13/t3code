import {
  type IssueDetail,
  type IssueListInput,
  type IssueSummary,
  PullRequestOperationError,
} from "@t3tools/contracts";
import type { IssueProviderApi } from "@t3tools/source-control-core/server/IssueProvider";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as GitHubPullRequestApi from "./GitHubPullRequestApi.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";
import { fromGitHubApiError } from "./GitHubSourceControlProvider.ts";

const User = Schema.NullOr(Schema.Struct({ login: Schema.String }));

// GitHub lists pull requests as issues too; `pull_request` is what tells them apart.
const RestIssue = Schema.Struct({
  number: Schema.Int,
  title: Schema.String,
  state: Schema.String,
  html_url: Schema.String,
  repository_url: Schema.optional(Schema.String),
  user: Schema.optional(User),
  assignees: Schema.optional(Schema.NullOr(Schema.Array(Schema.Struct({ login: Schema.String })))),
  labels: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.String,
        Schema.Struct({
          name: Schema.String,
          color: Schema.optional(Schema.NullOr(Schema.String)),
        }),
      ]),
    ),
  ),
  comments: Schema.optional(Schema.Int),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
  updated_at: Schema.String,
  pull_request: Schema.optional(Schema.Unknown),
});
type RestIssue = typeof RestIssue.Type;

const RestComment = Schema.Struct({
  user: Schema.optional(User),
  body: Schema.optional(Schema.NullOr(Schema.String)),
  created_at: Schema.String,
});

const RestRepository = Schema.Struct({
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
});
const decodeRepository = Schema.decodeUnknownOption(Schema.fromJsonString(RestRepository));
// Rows decode one at a time, so a single odd row from GitHub cannot blank the whole list.
const decodeRows = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(Schema.Unknown)));
const decodeRow = Schema.decodeUnknownOption(RestIssue);
const decodeIssue = Schema.decodeUnknownOption(Schema.fromJsonString(RestIssue));
const decodeComments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RestComment)));

// The most GitHub serves per request, and the most a list shows. GitHub counts pull requests
// against `per_page` and they are dropped afterwards, so a smaller page could come back empty.
const PAGE_SIZE = 100;
// Comments are read this many pages deep; a longer thread is reported as truncated.
const MAX_COMMENT_PAGES = 5;
const SEGMENT = /^[\w.-]+$/;
// "." and ".." match SEGMENT and would walk the request path out of repos/.
const isRepository = (value: string) => {
  const segments = value.split("/");
  return (
    segments.length === 2 && segments.every((part) => SEGMENT.test(part) && !/^\.+$/.test(part))
  );
};

const failure = (operation: string, detail: string, notFound = false) =>
  new PullRequestOperationError({
    operation,
    detail,
    ...(notFound ? { reason: "not-found" as const } : {}),
  });

const ISSUE_NOT_FOUND = "Issue not found. Check the repository and issue number and try again.";

const fromGitHub = (operation: string) => (error: GitHubRequestPolicy.GitHubApiError) =>
  new PullRequestOperationError({
    operation,
    detail: fromGitHubApiError(error, ISSUE_NOT_FOUND).detail,
    ...(error._tag === "GitHubApiNotFoundError" ? { reason: "not-found" as const } : {}),
    cause: error,
  });

/** `https://api.github.com/repos/owner/name` to `owner/name`. */
const repositoryOf = (issue: RestIssue, fallback: string | undefined) => {
  const parts = issue.repository_url?.split("/").slice(-2);
  return parts?.length === 2 && parts.every((part) => part !== "") ? parts.join("/") : fallback;
};

const toSummary = (
  host: string,
  issue: RestIssue,
  fallback: string | undefined,
): IssueSummary | null => {
  const repository = repositoryOf(issue, fallback);
  if (repository === undefined || issue.pull_request !== undefined) return null;
  return {
    host,
    repository,
    number: issue.number,
    title: issue.title,
    state: issue.state === "closed" ? "closed" : "open",
    url: issue.html_url,
    author: issue.user?.login ?? null,
    assignees: (issue.assignees ?? []).map((assignee) => assignee.login),
    labels: (issue.labels ?? []).map((label) =>
      typeof label === "string"
        ? { name: label }
        : { name: label.name, ...(label.color ? { color: label.color } : {}) },
    ),
    commentCount: issue.comments ?? 0,
    createdAt: issue.created_at,
    updatedAt: issue.updated_at,
  };
};

const byNewestUpdate = (left: IssueSummary, right: IssueSummary) =>
  right.updatedAt.localeCompare(left.updatedAt);

/** Reads issues as the account GitHub knows the server by. */
export const make = Effect.gen(function* () {
  const api = yield* GitHubRest.GitHubRest;
  const pullRequests = yield* GitHubPullRequestApi.GitHubPullRequestApi;

  const read = (host: string, operation: string, path: string) =>
    api.rest({ host, operation, path }).pipe(Effect.mapError(fromGitHub(operation)));

  const readIssues = Effect.fn("GitHubIssueProvider.readIssues")(function* (
    host: string,
    path: string,
  ) {
    const operation = "listIssues";
    const response = yield* read(host, operation, path);
    const rows = decodeRows(response.body);
    if (Option.isNone(rows)) {
      yield* Effect.logWarning("GitHub sent a list this server cannot read", { host, path });
      return yield* failure(operation, "GitHub sent issues in a shape this server cannot read.");
    }
    const issues = rows.value.flatMap((row) => Option.toArray(decodeRow(row)));
    if (issues.length < rows.value.length) {
      yield* Effect.logWarning("Skipped GitHub issues this server cannot read", {
        host,
        path,
        skipped: rows.value.length - issues.length,
      });
    }
    return {
      issues: issues.flatMap((issue) => toSummary(host, issue, undefined) ?? []),
      full: rows.value.length >= PAGE_SIZE,
    };
  });

  const readComments = Effect.fn("GitHubIssueProvider.readComments")(function* (
    host: string,
    path: string,
  ) {
    const operation = "getIssue";
    const comments: Array<typeof RestComment.Type> = [];
    for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
      const response = yield* read(
        host,
        operation,
        `${path}/comments?per_page=${PAGE_SIZE}&page=${page}`,
      );
      const decoded = decodeComments(response.body);
      if (Option.isNone(decoded)) {
        yield* Effect.logWarning("GitHub sent comments this server cannot read", { host, path });
        return yield* failure(
          operation,
          "GitHub sent comments in a shape this server cannot read.",
        );
      }
      comments.push(...decoded.value);
      if (decoded.value.length < PAGE_SIZE) return { comments, truncated: false };
    }
    return { comments, truncated: true };
  });

  const list: IssueProviderApi["list"] = Effect.fn("GitHubIssueProvider.list")(function* (input) {
    const query = (filter: string) =>
      `issues?state=${input.state ?? "open"}&sort=updated&per_page=${PAGE_SIZE}&page=${input.page ?? 1}&filter=${filter}`;
    const pages = yield* Effect.all(
      filtersFor(input.involvement).map((filter) => readIssues(input.host, query(filter))),
      { concurrency: 2 },
    );
    const unique = new Map(
      pages.flatMap((page) => page.issues).map((issue) => [issue.url, issue] as const),
    );
    return {
      entries: [...unique.values()].toSorted(byNewestUpdate),
      hasMore: pages.some((page) => page.full),
    };
  });

  const get: IssueProviderApi["get"] = Effect.fn("GitHubIssueProvider.get")(function* (input) {
    const operation = "getIssue";
    if (!isRepository(input.repository)) {
      return yield* failure(operation, "Name the repository as owner/name.");
    }
    const path = `repos/${input.repository}/issues/${input.number}`;
    const [issueResponse, repositoryResponse, comments] = yield* Effect.all(
      [
        read(input.host, operation, path),
        read(input.host, operation, `repos/${input.repository}`),
        readComments(input.host, path),
      ],
      { concurrency: 3 },
    );
    const issue = decodeIssue(issueResponse.body);
    const repository = decodeRepository(repositoryResponse.body);
    if (Option.isNone(issue) || Option.isNone(repository)) {
      yield* Effect.logWarning("GitHub sent an issue this server cannot read", {
        host: input.host,
        repository: input.repository,
        number: input.number,
      });
      return yield* failure(operation, "GitHub sent the issue in a shape this server cannot read.");
    }
    const summary = toSummary(input.host, issue.value, input.repository);
    if (summary === null) return yield* failure(operation, "That is a pull request.", true);
    return {
      issue: summary,
      body: issue.value.body ?? "",
      defaultBranch: repository.value.default_branch ?? null,
      comments: comments.comments.map((comment) => ({
        author: comment.user?.login ?? null,
        body: comment.body ?? "",
        createdAt: comment.created_at,
      })),
      commentsTruncated: comments.truncated,
    } satisfies IssueDetail;
  });

  const reviewRequests: IssueProviderApi["reviewRequests"] = Effect.fn(
    "GitHubIssueProvider.reviewRequests",
  )(function* (input) {
    const batch = yield* pullRequests.searchReviewRequests({ host: input.host }).pipe(
      Effect.mapError(
        (cause) =>
          new PullRequestOperationError({
            operation: "reviewRequests",
            detail:
              cause._tag === "GitHubPullRequestReadError"
                ? "GitHub sent review requests in a shape this server cannot read."
                : fromGitHubApiError(cause, "No pull requests found.").detail,
            cause,
          }),
      ),
    );
    return {
      entries: batch.items.map((item) => ({
        host: input.host,
        repository: item.repository,
        number: item.number,
        title: item.title,
        url: item.url,
        author: item.author?.login ?? null,
        isDraft: item.isDraft,
        headBranch: item.headBranch,
        updatedAt: item.updatedAt,
      })),
      truncated: batch.truncated,
    };
  });

  return { list, get, reviewRequests } satisfies IssueProviderApi;
});

/** `/issues` answers for the signed-in account only, one relationship at a time. */
function filtersFor(involvement: IssueListInput["involvement"]) {
  switch (involvement) {
    case "assigned":
      return ["assigned"] as const;
    case "authored":
      return ["created"] as const;
    case "mine":
      return ["assigned", "created"] as const;
  }
}
