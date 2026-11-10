import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { IssueComment, IssueInvolvement, IssueState } from "./issue.ts";

/** Linear's workflow state categories; `duplicate`, `completed` and `canceled` count as closed. */
export const LinearStateType = Schema.Literals([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
  "duplicate",
]);
export type LinearStateType = typeof LinearStateType.Type;

export const LinearIssueSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  /** `ENG-123`. */
  identifier: TrimmedNonEmptyString,
  title: Schema.String,
  url: TrimmedNonEmptyString,
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: NonNegativeInt,
  state: Schema.Struct({
    name: Schema.String,
    type: LinearStateType,
    /** Hex with the leading `#`. */
    color: Schema.String,
  }),
  team: Schema.Struct({ id: TrimmedNonEmptyString, key: Schema.String, name: Schema.String }),
  project: Schema.NullOr(Schema.String),
  assignee: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type LinearIssueSummary = typeof LinearIssueSummary.Type;

export const LinearIssueListInput = Schema.Struct({
  involvement: IssueInvolvement,
  state: Schema.optional(IssueState),
});
export type LinearIssueListInput = typeof LinearIssueListInput.Type;

export const LinearIssueListResult = Schema.Struct({
  entries: Schema.Array(LinearIssueSummary),
  /** More issues match than the list reads. */
  hasMore: Schema.Boolean,
});
export type LinearIssueListResult = typeof LinearIssueListResult.Type;

export const LinearIssueInput = Schema.Struct({ id: TrimmedNonEmptyString });
export type LinearIssueInput = typeof LinearIssueInput.Type;

export const LinearIssueDetail = Schema.Struct({
  issue: LinearIssueSummary,
  description: Schema.String,
  /** Oldest first. */
  comments: Schema.Array(IssueComment),
  commentsTruncated: Schema.Boolean,
});
export type LinearIssueDetail = typeof LinearIssueDetail.Type;

export const LinearIssueStartResult = Schema.Struct({
  /** False when the issue was already started or closed and was left as it was. */
  moved: Schema.Boolean,
  stateName: Schema.String,
});
export type LinearIssueStartResult = typeof LinearIssueStartResult.Type;

export const LinearViewer = Schema.Struct({
  name: Schema.String,
  organization: Schema.String,
});
export type LinearViewer = typeof LinearViewer.Type;

export const LinearOperationErrorReason = Schema.Literals([
  "not-connected",
  "unauthorized",
  "request-failed",
]);
export type LinearOperationErrorReason = typeof LinearOperationErrorReason.Type;

export class LinearOperationError extends Schema.TaggedError<LinearOperationError>()(
  "LinearOperationError",
  {
    operation: Schema.String,
    reason: LinearOperationErrorReason,
    detail: TrimmedNonEmptyString,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
