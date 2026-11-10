import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** `mine` is assigned to or opened by the signed-in account; `repository` lists one repository. */
export const IssueInvolvement = Schema.Literals(["mine", "assigned", "authored", "repository"]);
export type IssueInvolvement = typeof IssueInvolvement.Type;

export const IssueState = Schema.Literals(["open", "closed"]);
export type IssueState = typeof IssueState.Type;

export const IssueLabel = Schema.Struct({
  name: TrimmedNonEmptyString,
  /** Hex without the leading `#`. */
  color: Schema.optional(TrimmedNonEmptyString),
});
export type IssueLabel = typeof IssueLabel.Type;

export const IssueSummary = Schema.Struct({
  host: TrimmedNonEmptyString,
  /** `owner/name`. */
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: Schema.String,
  state: IssueState,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(TrimmedNonEmptyString),
  assignees: Schema.Array(TrimmedNonEmptyString),
  labels: Schema.Array(IssueLabel),
  commentCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type IssueSummary = typeof IssueSummary.Type;

export const IssueListInput = Schema.Struct({
  involvement: IssueInvolvement,
  /** Required when `involvement` is `repository`. */
  repository: Schema.optional(TrimmedNonEmptyString),
  state: Schema.optional(IssueState),
  host: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  entries: Schema.Array(IssueSummary),
});
export type IssueListResult = typeof IssueListResult.Type;

export const IssueGetInput = Schema.Struct({
  host: Schema.optional(TrimmedNonEmptyString),
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
});
export type IssueGetInput = typeof IssueGetInput.Type;

export const IssueComment = Schema.Struct({
  author: Schema.NullOr(TrimmedNonEmptyString),
  body: Schema.String,
  createdAt: IsoDateTime,
});
export type IssueComment = typeof IssueComment.Type;

export const IssueDetail = Schema.Struct({
  issue: IssueSummary,
  body: Schema.String,
  /** Oldest first; the first 100 only. */
  comments: Schema.Array(IssueComment),
});
export type IssueDetail = typeof IssueDetail.Type;
