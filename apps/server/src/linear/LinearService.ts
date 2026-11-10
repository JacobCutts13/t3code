import {
  type LinearIssueDetail,
  type LinearIssueListInput,
  type LinearIssueListResult,
  type LinearIssueStartResult,
  type LinearIssueSummary,
  LinearOperationError,
  LinearStateType,
  type LinearViewer,
} from "@t3tools/contracts";
import * as SecretResolver from "@t3tools/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as SecretResolverLayer from "../secrets/SecretResolver.ts";
import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";

const ENDPOINT = "https://api.linear.app/graphql";
const TIMEOUT = "25 seconds";
/** Issues read per relationship, and comments per issue. */
const LINEAR_PAGE_SIZE = 100;
const CLOSED_TYPES = ["completed", "canceled", "duplicate"] as const;
const STARTABLE_TYPES: ReadonlySet<string> = new Set(["triage", "backlog", "unstarted"]);

/** Linear issues read and moved as the account whose personal API key the server holds. */
export class LinearService extends Context.Service<
  LinearService,
  {
    readonly viewer: Effect.Effect<LinearViewer, LinearOperationError>;
    readonly list: (
      input: LinearIssueListInput,
    ) => Effect.Effect<LinearIssueListResult, LinearOperationError>;
    readonly get: (id: string) => Effect.Effect<LinearIssueDetail, LinearOperationError>;
    /** Moves the issue to its team's first started state unless it is already past unstarted. */
    readonly start: (id: string) => Effect.Effect<LinearIssueStartResult, LinearOperationError>;
  }
>()("t3/linear/LinearService") {}

const ISSUE_FIELDS = `
  id identifier title url priority updatedAt
  state { name type color }
  team { id name }
  project { name }
  assignee { displayName }
`;

const LIST_QUERY = `
query T3LinearIssues($assigned: IssueFilter, $created: IssueFilter, $withAssigned: Boolean!, $withCreated: Boolean!, $first: Int!) {
  viewer {
    assignedIssues(filter: $assigned, first: $first, orderBy: updatedAt) @include(if: $withAssigned) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage }
    }
    createdIssues(filter: $created, first: $first, orderBy: updatedAt) @include(if: $withCreated) {
      nodes { ${ISSUE_FIELDS} }
      pageInfo { hasNextPage }
    }
  }
}`;

const GET_QUERY = `
query T3LinearIssue($id: String!, $first: Int!) {
  issue(id: $id) {
    description
    comments(first: $first) {
      nodes { body createdAt user { displayName } }
      pageInfo { hasNextPage }
    }
  }
}`;

const STATES_QUERY = `
query T3LinearIssueStates($id: String!) {
  issue(id: $id) {
    state { name type }
    team { states { nodes { id name type position } } }
  }
}`;

const START_MUTATION = `
mutation T3LinearStartIssue($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { state { name } }
  }
}`;

const VIEWER_QUERY = `query T3LinearViewer { viewer { displayName } organization { name } }`;

const Named = Schema.NullOr(Schema.Struct({ name: Schema.String }));
const IssueNode = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  priority: Schema.Number,
  updatedAt: Schema.String,
  state: Schema.Struct({ name: Schema.String, type: LinearStateType, color: Schema.String }),
  team: Schema.Struct({ id: Schema.String, name: Schema.String }),
  project: Schema.optional(Named),
  assignee: Schema.optional(Schema.NullOr(Schema.Struct({ displayName: Schema.String }))),
});
type IssueNode = typeof IssueNode.Type;
// Rows decode one at a time, so one odd issue cannot blank the whole list.
const decodeNode = Schema.decodeUnknownExit(IssueNode);

const Connection = Schema.Struct({
  nodes: Schema.Array(Schema.Unknown),
  pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
});
const ListData = Schema.Struct({
  viewer: Schema.Struct({
    assignedIssues: Schema.optional(Connection),
    createdIssues: Schema.optional(Connection),
  }),
});
const GetData = Schema.Struct({
  issue: Schema.NullOr(
    Schema.Struct({
      description: Schema.optional(Schema.NullOr(Schema.String)),
      comments: Schema.Struct({
        nodes: Schema.Array(
          Schema.Struct({
            body: Schema.String,
            createdAt: Schema.String,
            user: Schema.optional(Schema.NullOr(Schema.Struct({ displayName: Schema.String }))),
          }),
        ),
        pageInfo: Schema.Struct({ hasNextPage: Schema.Boolean }),
      }),
    }),
  ),
});
const StatesData = Schema.Struct({
  issue: Schema.NullOr(
    Schema.Struct({
      state: Schema.Struct({ name: Schema.String, type: Schema.String }),
      team: Schema.Struct({
        states: Schema.Struct({
          nodes: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              name: Schema.String,
              type: Schema.String,
              position: Schema.Number,
            }),
          ),
        }),
      }),
    }),
  ),
});
const StartData = Schema.Struct({
  issueUpdate: Schema.Struct({
    success: Schema.Boolean,
    issue: Schema.optional(
      Schema.NullOr(Schema.Struct({ state: Schema.Struct({ name: Schema.String }) })),
    ),
  }),
});
const ViewerData = Schema.Struct({
  viewer: Schema.Struct({ displayName: Schema.String }),
  organization: Schema.Struct({ name: Schema.String }),
});

const GraphQLError = Schema.Struct({
  message: Schema.optional(Schema.String),
  extensions: Schema.optional(
    Schema.Struct({ code: Schema.optional(Schema.String), type: Schema.optional(Schema.String) }),
  ),
});
const Envelope = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(GraphQLError)),
});
const decodeEnvelope = Schema.decodeUnknownOption(Envelope);

const fail = (
  operation: string,
  reason: LinearOperationError["reason"],
  detail: string,
  cause?: unknown,
) =>
  new LinearOperationError({
    operation,
    reason,
    detail,
    ...(cause === undefined ? {} : { cause }),
  });

const isAuthenticationError = (error: typeof GraphQLError.Type) =>
  error.extensions?.code === "AUTHENTICATION_ERROR" ||
  error.extensions?.type?.toLowerCase() === "authentication error";

/** The viewer relationships an involvement reads, with the filter each one needs. */
export function listVariables(input: LinearIssueListInput) {
  const state = {
    type: input.state === "closed" ? { in: CLOSED_TYPES } : { nin: CLOSED_TYPES },
  };
  return {
    assigned: { state },
    // Created-and-assigned issues already arrive as assigned to you, or belong to someone else.
    created: input.involvement === "mine" ? { state, assignee: { null: true } } : { state },
    withAssigned: input.involvement !== "authored",
    withCreated: input.involvement !== "assigned",
    first: LINEAR_PAGE_SIZE,
  };
}

function toSummary(node: IssueNode): LinearIssueSummary {
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    priority: Math.max(0, Math.round(node.priority)),
    state: node.state,
    team: node.team,
    project: node.project?.name ?? null,
    assignee: node.assignee?.displayName ?? null,
    updatedAt: node.updatedAt,
  };
}

export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const http = yield* HttpClient.HttpClient;

  const apiKey = Effect.fn("LinearService.apiKey")(function* (operation: string) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError((cause) =>
        fail(operation, "request-failed", "Couldn't read this environment's settings.", cause),
      ),
    );
    const saved = settings.linear.apiKey;
    if (saved !== "") {
      const key = yield* requireSettingsSecret(secrets, saved).pipe(
        Effect.mapError((cause) => fail(operation, "not-connected", cause.message, cause)),
      );
      return key.trim();
    }
    const fromEnv = (yield* HostProcess.Environment).LINEAR_API_KEY?.trim();
    if (fromEnv) return fromEnv;
    return yield* fail(
      operation,
      "not-connected",
      "Not connected. Add a Linear API key in Settings → Source control.",
    );
  });

  const request = Effect.fn("LinearService.request")(function* <S extends Schema.Top>(
    operation: string,
    query: string,
    variables: Record<string, unknown>,
    schema: S,
  ) {
    const key = yield* apiKey(operation);
    // The timeout covers the body too: headers can arrive while the body stalls.
    const { response, body } = yield* http
      .execute(
        HttpClientRequest.post(ENDPOINT).pipe(
          // Personal API keys go in the header as they are, without `Bearer`.
          HttpClientRequest.setHeader("authorization", key),
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
        ),
      )
      .pipe(
        Effect.flatMap((response) =>
          response.json.pipe(
            Effect.orElseSucceed((): unknown => undefined),
            Effect.map((body) => ({ response, body })),
          ),
        ),
        // A redirect could carry the key to another origin.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "error" }),
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.timeout(TIMEOUT),
        Effect.mapError((cause) =>
          fail(operation, "request-failed", "Couldn't reach Linear. Check your connection.", cause),
        ),
      );
    const envelope = decodeEnvelope(body);
    const errors = Option.isSome(envelope) ? (envelope.value.errors ?? []) : [];
    if (response.status === 401 || response.status === 403 || errors.some(isAuthenticationError)) {
      return yield* fail(
        operation,
        "unauthorized",
        "Linear rejected the API key. Check it in Settings → Source control.",
      );
    }
    if (
      response.status === 429 ||
      errors.some((error) => error.extensions?.code === "RATELIMITED")
    ) {
      return yield* fail(
        operation,
        "request-failed",
        "Linear is rate-limiting this API key. Try again in a minute.",
      );
    }
    // Linear can answer 200 with partial data and errors; a partial list would look complete.
    if (errors.length > 0 || response.status < 200 || response.status >= 300) {
      const message = errors
        .find((error) => error.message)
        ?.message?.trim()
        .slice(0, 300);
      return yield* fail(
        operation,
        "request-failed",
        message
          ? `Linear: ${message}`
          : errors.length > 0
            ? "Linear reported an error without a message."
            : `Linear returned HTTP ${response.status}.`,
      );
    }
    return yield* Schema.decodeUnknownEffect(schema)(
      Option.isSome(envelope) ? envelope.value.data : undefined,
    ).pipe(
      Effect.mapError((cause) =>
        fail(operation, "request-failed", "Linear sent a reply this server cannot read.", cause),
      ),
    );
  });

  const decodeNodes = Effect.fn("LinearService.decodeNodes")(function* (
    nodes: ReadonlyArray<unknown>,
  ) {
    const issues: Array<LinearIssueSummary> = [];
    for (const node of nodes) {
      const decoded = decodeNode(node);
      if (Exit.isSuccess(decoded)) {
        issues.push(toSummary(decoded.value));
      } else {
        yield* Effect.logWarning("Linear sent an issue this server cannot read", {
          id: typeof node === "object" && node !== null && "id" in node ? node.id : undefined,
          cause: Cause.pretty(decoded.cause),
        });
      }
    }
    return issues;
  });

  const viewer = request("linear.viewer", VIEWER_QUERY, {}, ViewerData).pipe(
    Effect.map((data) => ({
      name: data.viewer.displayName,
      organization: data.organization.name,
    })),
    Effect.withSpan("LinearService.viewer"),
  );

  const list = Effect.fn("LinearService.list")(function* (input: LinearIssueListInput) {
    const data = yield* request(
      "linear.issuesList",
      LIST_QUERY,
      listVariables(input),
      ListData,
    ).pipe(
      Effect.catchIf(
        (error) => error.reason === "not-connected",
        () => Effect.succeed(null),
      ),
    );
    // No key is a normal state for anyone who only uses GitHub, not a failure to show.
    if (data === null) return { entries: [], hasMore: false, connected: false };
    const connections = [data.viewer.assignedIssues, data.viewer.createdIssues].filter(
      (connection) => connection !== undefined,
    );
    const rows = yield* decodeNodes(connections.flatMap((connection) => connection.nodes));
    const unique = new Map(rows.map((issue) => [issue.id, issue] as const));
    return {
      entries: [...unique.values()],
      hasMore: connections.some((connection) => connection.pageInfo.hasNextPage),
      connected: true,
    } satisfies LinearIssueListResult;
  });

  const get = Effect.fn("LinearService.get")(function* (id: string) {
    const operation = "linear.issuesGet";
    const { issue } = yield* request(
      operation,
      GET_QUERY,
      { id, first: LINEAR_PAGE_SIZE },
      GetData,
    );
    if (issue === null) {
      return yield* fail(operation, "request-failed", "Linear has no issue with that id.");
    }
    return {
      description: issue.description ?? "",
      comments: issue.comments.nodes
        .map((comment) => ({
          author: comment.user?.displayName ?? null,
          body: comment.body,
          createdAt: comment.createdAt,
        }))
        .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt)),
      commentsTruncated: issue.comments.pageInfo.hasNextPage,
    } satisfies LinearIssueDetail;
  });

  const start = Effect.fn("LinearService.start")(function* (id: string) {
    const operation = "linear.issueStart";
    const { issue } = yield* request(operation, STATES_QUERY, { id }, StatesData);
    if (issue === null) {
      return yield* fail(operation, "request-failed", "Linear has no issue with that id.");
    }
    if (!STARTABLE_TYPES.has(issue.state.type)) {
      return { moved: false, stateName: issue.state.name } satisfies LinearIssueStartResult;
    }
    const [target] = issue.team.states.nodes
      .filter((state) => state.type === "started")
      .toSorted((left, right) => left.position - right.position);
    if (target === undefined) {
      return yield* fail(operation, "request-failed", "The issue's team has no started state.");
    }
    const { issueUpdate } = yield* request(
      operation,
      START_MUTATION,
      { id, stateId: target.id },
      StartData,
    );
    if (!issueUpdate.success) {
      return yield* fail(operation, "request-failed", "Linear didn't update the issue.");
    }
    return {
      moved: true,
      stateName: issueUpdate.issue?.state.name ?? target.name,
    } satisfies LinearIssueStartResult;
  });

  return LinearService.of({ viewer, list, get, start });
});

export const layer = Layer.effect(LinearService, make).pipe(
  Layer.provide([SecretResolverLayer.layer, FetchHttpClient.layer]),
);
