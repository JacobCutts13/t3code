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

import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

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

const decodeIssues = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RestIssue)));
const decodeIssue = Schema.decodeUnknownOption(Schema.fromJsonString(RestIssue));
const decodeComments = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Array(RestComment)));

const DEFAULT_LIMIT = 50;
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

const fromGitHub = (operation: string) => (error: GitHubRequestPolicy.GitHubApiError) =>
  new PullRequestOperationError({
    operation,
    detail: error.message.trim() === "" ? `GitHub request failed (${error._tag}).` : error.message,
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

  const read = (host: string, operation: string, path: string) =>
    api.rest({ host, operation, path }).pipe(Effect.mapError(fromGitHub(operation)));

  const readIssues = Effect.fn("GitHubIssueProvider.readIssues")(function* (
    host: string,
    path: string,
    fallback?: string,
  ) {
    const operation = "listIssues";
    const response = yield* read(host, operation, path);
    const decoded = decodeIssues(response.body);
    if (Option.isNone(decoded)) {
      return yield* failure(operation, "GitHub sent issues in a shape this server cannot read.");
    }
    return decoded.value.flatMap((issue) => toSummary(host, issue, fallback) ?? []);
  });

  const list: IssueProviderApi["list"] = Effect.fn("GitHubIssueProvider.list")(function* (input) {
    const limit = input.limit ?? DEFAULT_LIMIT;
    const query = (extra: string) =>
      `state=${input.state ?? "open"}&sort=updated&per_page=${limit}${extra}`;

    if (input.involvement === "repository") {
      if (input.repository === undefined || !isRepository(input.repository)) {
        return yield* failure("listIssues", "Name the repository as owner/name.");
      }
      return yield* readIssues(
        input.host,
        `repos/${input.repository}/issues?${query("")}`,
        input.repository,
      );
    }

    const filters = filtersFor(input.involvement);
    const lists = yield* Effect.all(
      filters.map((filter) => readIssues(input.host, `issues?${query(`&filter=${filter}`)}`)),
      { concurrency: 2 },
    );
    const unique = new Map(lists.flat().map((issue) => [issue.url, issue] as const));
    return [...unique.values()].toSorted(byNewestUpdate).slice(0, limit);
  });

  const get: IssueProviderApi["get"] = Effect.fn("GitHubIssueProvider.get")(function* (input) {
    const operation = "getIssue";
    if (!isRepository(input.repository)) {
      return yield* failure(operation, "Name the repository as owner/name.");
    }
    const path = `repos/${input.repository}/issues/${input.number}`;
    const [issueResponse, commentsResponse] = yield* Effect.all(
      [
        read(input.host, operation, path),
        read(input.host, operation, `${path}/comments?per_page=100`),
      ],
      { concurrency: 2 },
    );
    const issue = decodeIssue(issueResponse.body);
    const comments = decodeComments(commentsResponse.body);
    if (Option.isNone(issue) || Option.isNone(comments)) {
      return yield* failure(operation, "GitHub sent the issue in a shape this server cannot read.");
    }
    const summary = toSummary(input.host, issue.value, input.repository);
    if (summary === null) return yield* failure(operation, "That is a pull request.", true);
    return {
      issue: summary,
      body: issue.value.body ?? "",
      comments: comments.value.map((comment) => ({
        author: comment.user?.login ?? null,
        body: comment.body ?? "",
        createdAt: comment.created_at,
      })),
    } satisfies IssueDetail;
  });

  return { list, get } satisfies IssueProviderApi;
});

/** `/issues` answers for the signed-in account only, one relationship at a time. */
function filtersFor(involvement: Exclude<IssueListInput["involvement"], "repository">) {
  switch (involvement) {
    case "assigned":
      return ["assigned"] as const;
    case "authored":
      return ["created"] as const;
    case "mine":
      return ["assigned", "created"] as const;
  }
}
