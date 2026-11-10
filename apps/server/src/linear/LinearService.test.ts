import { it } from "@effect/vitest";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { expect, vi } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as LinearService from "./LinearService.ts";

const layer = (apiKey: string, env: Record<string, string> = {}) =>
  Layer.effect(LinearService.LinearService, LinearService.make({ env })).pipe(
    Layer.provideMerge(ServerSettings.layerTest({ linear: { apiKey } })),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
  );

const node = (id: string, updatedAt: string, stateType = "unstarted") => ({
  id,
  identifier: `ENG-${id}`,
  title: `Issue ${id}`,
  url: `https://linear.app/acme/issue/ENG-${id}`,
  priority: 2,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt,
  state: { name: "Todo", type: stateType, color: "#e2e2e2" },
  team: { id: "team-1", key: "ENG", name: "Engineering" },
  project: { name: "Login" },
  assignee: null,
});

type Reply = { readonly status?: number; readonly body: unknown };

/** Answers each GraphQL call in turn and keeps the parsed requests. */
function linearApi(...replies: ReadonlyArray<Reply>) {
  const requests: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    expect(String(url)).toBe("https://api.linear.app/graphql");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("lin_api_secret");
    requests.push(JSON.parse(String(init?.body)));
    const reply = replies[requests.length - 1];
    if (reply === undefined) throw new Error("Unexpected Linear request");
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  return { fetch, requests };
}

const run = <A, E>(
  apiKey: string,
  api: ReturnType<typeof linearApi>,
  use: (service: LinearService.LinearService["Service"]) => Effect.Effect<A, E>,
  env?: Record<string, string>,
) =>
  LinearService.LinearService.pipe(
    Effect.flatMap(use),
    Effect.provide(layer(apiKey, env)),
    Effect.provideService(FetchHttpClient.Fetch, api.fetch),
  );

it.each([
  {
    input: { involvement: "mine", state: "open" },
    expected: {
      assigned: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } },
      created: {
        state: { type: { nin: ["completed", "canceled", "duplicate"] } },
        assignee: { null: true },
      },
      withAssigned: true,
      withCreated: true,
    },
  },
  {
    input: { involvement: "assigned", state: "closed" },
    expected: {
      assigned: { state: { type: { in: ["completed", "canceled", "duplicate"] } } },
      created: { state: { type: { in: ["completed", "canceled", "duplicate"] } } },
      withAssigned: true,
      withCreated: false,
    },
  },
  {
    input: { involvement: "authored" },
    expected: {
      assigned: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } },
      created: { state: { type: { nin: ["completed", "canceled", "duplicate"] } } },
      withAssigned: false,
      withCreated: true,
    },
  },
] as const)(
  "$input.involvement $input.state reads the matching viewer issues",
  ({ input, expected }) => {
    expect(LinearService.listVariables(input)).toEqual({ ...expected, first: 100 });
  },
);

it.effect("lists assigned and created issues once each, newest first, skipping odd rows", () =>
  Effect.gen(function* () {
    const api = linearApi({
      body: {
        data: {
          viewer: {
            assignedIssues: {
              nodes: [node("1", "2026-11-02T00:00:00.000Z"), { id: "broken" }],
              pageInfo: { hasNextPage: false },
            },
            createdIssues: {
              nodes: [node("1", "2026-11-02T00:00:00.000Z"), node("2", "2026-11-03T00:00:00.000Z")],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      },
    });
    const result = yield* run("lin_api_secret", api, (linear) =>
      linear.list({ involvement: "mine", state: "open" }),
    );
    expect(result.entries.map((issue) => issue.identifier)).toEqual(["ENG-2", "ENG-1"]);
    expect(result.entries[0]).toMatchObject({
      state: { name: "Todo", type: "unstarted", color: "#e2e2e2" },
      team: { key: "ENG" },
      project: "Login",
      assignee: null,
    });
    expect(result.hasMore).toBe(true);
    expect(api.requests[0]?.variables).toMatchObject({ withAssigned: true, withCreated: true });
  }),
);

it.effect.each([
  {
    name: "no key anywhere",
    apiKey: "",
    replies: [],
    reason: "not-connected",
  },
  {
    name: "HTTP 401",
    apiKey: "lin_api_secret",
    replies: [{ status: 401, body: { errors: [{ message: "Bad key" }] } }],
    reason: "unauthorized",
  },
  {
    name: "an authentication error on a 200",
    apiKey: "lin_api_secret",
    replies: [
      {
        body: {
          errors: [
            { message: "Authentication required", extensions: { code: "AUTHENTICATION_ERROR" } },
          ],
        },
      },
    ],
    reason: "unauthorized",
  },
  {
    name: "partial data with errors on a 200",
    apiKey: "lin_api_secret",
    replies: [
      {
        body: {
          data: { viewer: { assignedIssues: { nodes: [], pageInfo: { hasNextPage: false } } } },
          errors: [{ message: "Query too complex" }],
        },
      },
    ],
    reason: "request-failed",
  },
] as const)("$name fails the list as $reason", ({ apiKey, replies, reason }) =>
  Effect.gen(function* () {
    const api = linearApi(...replies);
    const failure = yield* Effect.flip(
      run(apiKey, api, (linear) => linear.list({ involvement: "assigned" })),
    );
    expect(failure).toMatchObject({ _tag: "LinearOperationError", reason });
  }),
);

it.effect("falls back to LINEAR_API_KEY when settings hold no key", () =>
  Effect.gen(function* () {
    const api = linearApi({
      body: { data: { viewer: { displayName: "Jacob" }, organization: { name: "Acme" } } },
    });
    const viewer = yield* run("", api, (linear) => linear.viewer, {
      LINEAR_API_KEY: "lin_api_secret",
    });
    expect(viewer).toEqual({ name: "Jacob", organization: "Acme" });
  }),
);

it.effect("reads an issue with its comments oldest first", () =>
  Effect.gen(function* () {
    const api = linearApi({
      body: {
        data: {
          issue: {
            ...node("1", "2026-11-02T00:00:00.000Z"),
            description: "Steps",
            comments: {
              nodes: [
                { body: "second", createdAt: "2026-11-02T00:00:00.000Z", user: null },
                {
                  body: "first",
                  createdAt: "2026-11-01T00:00:00.000Z",
                  user: { displayName: "Ana" },
                },
              ],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      },
    });
    const detail = yield* run("lin_api_secret", api, (linear) => linear.get("1"));
    expect(detail.description).toBe("Steps");
    expect(detail.comments).toEqual([
      { author: "Ana", body: "first", createdAt: "2026-11-01T00:00:00.000Z" },
      { author: null, body: "second", createdAt: "2026-11-02T00:00:00.000Z" },
    ]);
    expect(detail.commentsTruncated).toBe(true);
  }),
);

const states = (currentType: string) => ({
  body: {
    data: {
      issue: {
        state: { name: currentType === "started" ? "In Review" : "Todo", type: currentType },
        team: {
          states: {
            nodes: [
              { id: "s-review", name: "In Review", type: "started", position: 3 },
              { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
              { id: "s-progress", name: "In Progress", type: "started", position: 2 },
            ],
          },
        },
      },
    },
  },
});

it.effect("start moves an unstarted issue to its team's first started state", () =>
  Effect.gen(function* () {
    const api = linearApi(states("unstarted"), {
      body: { data: { issueUpdate: { success: true, issue: { state: { name: "In Progress" } } } } },
    });
    const result = yield* run("lin_api_secret", api, (linear) => linear.start("1"));
    expect(result).toEqual({ moved: true, stateName: "In Progress" });
    expect(api.requests[1]?.variables).toEqual({ id: "1", stateId: "s-progress" });
  }),
);

it.effect("start leaves an issue that is already started", () =>
  Effect.gen(function* () {
    const api = linearApi(states("started"));
    const result = yield* run("lin_api_secret", api, (linear) => linear.start("1"));
    expect(result).toEqual({ moved: false, stateName: "In Review" });
    expect(api.requests).toHaveLength(1);
  }),
);

it.effect("start fails when Linear reports the update unsuccessful", () =>
  Effect.gen(function* () {
    const api = linearApi(states("backlog"), {
      body: { data: { issueUpdate: { success: false, issue: null } } },
    });
    const failure = yield* Effect.flip(run("lin_api_secret", api, (linear) => linear.start("1")));
    expect(failure).toMatchObject({ _tag: "LinearOperationError", reason: "request-failed" });
  }),
);
