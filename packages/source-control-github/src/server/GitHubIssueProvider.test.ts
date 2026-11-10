import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";

import * as GitHubIssueProvider from "./GitHubIssueProvider.ts";
import * as GitHubRest from "./GitHubRest.ts";

const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `Issue ${number}`,
  state: "open",
  html_url: `https://github.com/acme/api/issues/${number}`,
  repository_url: "https://api.github.com/repos/acme/api",
  user: { login: "ada" },
  assignees: [{ login: "grace" }],
  labels: [{ name: "bug", color: "d73a4a" }, "legacy"],
  comments: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: `2026-01-0${number}T00:00:00Z`,
  ...extra,
});

/** Answers each path from `answers`, and records the paths asked. */
const provider = (answers: Record<string, unknown>) => {
  const asked: string[] = [];
  const rest = Layer.mock(GitHubRest.GitHubRest)({
    rest: (input) => {
      asked.push(input.path);
      const answer = answers[input.path];
      return answer === undefined
        ? Effect.die(new Error(`unexpected request: ${input.path}`))
        : Effect.succeed({
            status: 200,
            headers: {},
            body: JSON.stringify(answer),
            truncated: false,
            invalidUtf8: false,
          });
    },
  });
  return {
    asked,
    make: GitHubIssueProvider.make.pipe(Effect.provide(rest)),
  };
};

it.effect("merges assigned and authored issues, drops pull requests, newest first", () =>
  Effect.gen(function* () {
    const { make } = provider({
      "issues?state=open&sort=updated&per_page=100&filter=assigned": [
        issue(1),
        issue(3, { pull_request: {} }),
      ],
      "issues?state=open&sort=updated&per_page=100&filter=created": [issue(1), issue(2)],
    });
    const issues = yield* make;
    const entries = yield* issues.list({ involvement: "mine", host: "github.com" });
    assert.deepStrictEqual(
      entries.map((entry) => entry.number),
      [2, 1],
    );
    assert.deepStrictEqual(entries[0]?.labels, [
      { name: "bug", color: "d73a4a" },
      { name: "legacy" },
    ]);
    assert.strictEqual(entries[0]?.repository, "acme/api");
    assert.strictEqual(entries[0]?.author, "ada");
  }),
);

it.effect("lists only the requested state and relationship", () =>
  Effect.gen(function* () {
    const { make, asked } = provider({
      "issues?state=closed&sort=updated&per_page=100&filter=created": [
        issue(4, { state: "closed" }),
      ],
    });
    const issues = yield* make;
    const entries = yield* issues.list({
      involvement: "authored",
      state: "closed",
      host: "github.com",
    });
    assert.deepStrictEqual(asked, ["issues?state=closed&sort=updated&per_page=100&filter=created"]);
    assert.strictEqual(entries[0]?.state, "closed");
  }),
);

it.effect("skips a row it cannot read and keeps the rest", () =>
  Effect.gen(function* () {
    const { make } = provider({
      "issues?state=open&sort=updated&per_page=100&filter=assigned": [
        { number: "not a number" },
        issue(2),
      ],
    });
    const issues = yield* make;
    const entries = yield* issues.list({ involvement: "assigned", host: "github.com" });
    assert.deepStrictEqual(
      entries.map((entry) => entry.number),
      [2],
    );
  }),
);

it.effect("refuses a repository that is not owner/name before asking GitHub", () =>
  Effect.gen(function* () {
    const { make, asked } = provider({});
    const issues = yield* make;
    const exit = yield* Effect.exit(
      issues.get({ host: "github.com", repository: "../orgs", number: 1 }),
    );
    assert.isTrue(Exit.isFailure(exit));
    assert.deepStrictEqual(asked, []);
  }),
);

it.effect("reads an issue with its comments, and refuses a pull request", () =>
  Effect.gen(function* () {
    const { make } = provider({
      "repos/acme/api/issues/7": issue(7, { body: "Steps to reproduce" }),
      "repos/acme/api/issues/7/comments?per_page=100": [
        { user: { login: "grace" }, body: "On it", created_at: "2026-01-08T00:00:00Z" },
      ],
      "repos/acme/api": { default_branch: "develop" },
      "repos/acme/api/issues/8": issue(8, { pull_request: {} }),
      "repos/acme/api/issues/8/comments?per_page=100": [],
    });
    const issues = yield* make;
    const detail = yield* issues.get({ host: "github.com", repository: "acme/api", number: 7 });
    assert.strictEqual(detail.body, "Steps to reproduce");
    assert.strictEqual(detail.defaultBranch, "develop");
    assert.deepStrictEqual(detail.comments, [
      { author: "grace", body: "On it", createdAt: "2026-01-08T00:00:00Z" },
    ]);
    const pull = yield* Effect.exit(
      issues.get({ host: "github.com", repository: "acme/api", number: 8 }),
    );
    assert.isTrue(Exit.isFailure(pull));
  }),
);

it.effect("drops the pull requests that share a page with issues", () =>
  Effect.gen(function* () {
    const { make } = provider({
      "issues?state=open&sort=updated&per_page=100&filter=assigned": [
        issue(9, { pull_request: {} }),
        issue(8, { pull_request: {} }),
        issue(3),
        issue(2),
        issue(1),
      ],
    });
    const issues = yield* make;
    const entries = yield* issues.list({ involvement: "assigned", host: "github.com" });
    assert.deepStrictEqual(
      entries.map((entry) => entry.number),
      [3, 2, 1],
    );
  }),
);
