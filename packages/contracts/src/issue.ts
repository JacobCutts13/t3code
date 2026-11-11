import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PullRequestLabel } from "./pullRequest.ts";

/** `mine` is assigned to or opened by the signed-in account. */
export const IssueInvolvement = Schema.Literals(["mine", "assigned", "authored"]);
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
  state: Schema.optional(IssueState),
  host: Schema.optional(TrimmedNonEmptyString),
  /** 1-based; each page is up to 100 issues per relationship. */
  page: Schema.optional(PositiveInt),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  entries: Schema.Array(IssueSummary),
  /** Another page may follow. The same issue can appear on two pages of a merged list. */
  hasMore: Schema.Boolean,
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
  /** The repository's default branch, which a worktree for the issue starts from. */
  defaultBranch: Schema.NullOr(TrimmedNonEmptyString),
  /** Oldest first. */
  comments: Schema.Array(IssueComment),
  /** The thread has more comments than were read. */
  commentsTruncated: Schema.Boolean,
});
export type IssueDetail = typeof IssueDetail.Type;

/** An open pull request asking the signed-in account, or one of its teams, for a review. */
export const ReviewRequestSummary = Schema.Struct({
  host: TrimmedNonEmptyString,
  /** `owner/name`. */
  repository: TrimmedNonEmptyString,
  number: PositiveInt,
  title: Schema.String,
  url: TrimmedNonEmptyString,
  author: Schema.NullOr(TrimmedNonEmptyString),
  isDraft: Schema.Boolean,
  headBranch: TrimmedNonEmptyString,
  labels: Schema.Array(PullRequestLabel),
  updatedAt: IsoDateTime,
});
export type ReviewRequestSummary = typeof ReviewRequestSummary.Type;

export const ReviewRequestListInput = Schema.Struct({
  host: Schema.optional(TrimmedNonEmptyString),
});
export type ReviewRequestListInput = typeof ReviewRequestListInput.Type;

export const ReviewRequestListResult = Schema.Struct({
  /** Newest update first. */
  entries: Schema.Array(ReviewRequestSummary),
  /** More requests exist than were listed. */
  truncated: Schema.Boolean,
});
export type ReviewRequestListResult = typeof ReviewRequestListResult.Type;
