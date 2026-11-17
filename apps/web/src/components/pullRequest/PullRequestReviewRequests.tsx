import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  ReviewRequestSummary,
  ThreadId,
} from "@t3tools/contracts";
import { sourceControlClients } from "@t3tools/client-runtime/source-control-clients";
import { visibleThreadPullRequests } from "@t3tools/client-runtime/thread-pull-requests";
import * as Schema from "effect/Schema";
import { PlayIcon } from "lucide-react";
import { useState } from "react";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { reviewRequestEnvironment } from "~/state/reviewRequests";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { IssueModelPicker } from "../issues/IssueModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { ExternalRefLink, openExternalUrl } from "./ExternalRefLink";
import { openOnHostLabel } from "./pullRequestLinkContextMenu";
import { PullRequestChangeBreakdownStat } from "./PullRequestChangeBreakdownStat";
import { PullRequestGroupHeader } from "./PullRequestListGroups";
import {
  PULL_REQUEST_PAGE_ROW_BUTTON_CLASS,
  PULL_REQUEST_PAGE_ROW_FRAME_CLASS,
  PULL_REQUEST_PAGE_ROW_TRAILING_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowGlyph,
  PullRequestRowLines,
} from "./PullRequestListRow";
import type { PullRequestRowTarget } from "./PullRequestRow";
import { reviewRequestKey } from "./pullRequestList.logic";

const CHOOSE_PROJECT = "Choose a project to review this pull request in";
const START_REVIEW = "Start a read-only review agent on this pull request";
const OPEN_ON_GITHUB = openOnHostLabel(sourceControlClients.get("github"));

// Per environment: the project each repository's review requests were last dispatched into.
const PickedProjectsSchema = Schema.Record(Schema.String, Schema.String);

/** Open GitHub pull requests in any repository that ask the viewer, or a team of theirs, to review. */
export function useReviewRequests(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : reviewRequestEnvironment.list({ environmentId, input: {} }),
  );
  return {
    entries: query.data?.entries ?? [],
    truncated: query.data?.truncated ?? false,
    error: query.error,
    refresh: query.refresh,
  };
}

/** Review state the list's Review buttons and the detail panel's dispatch bar share. */
export function useReviewDispatchState() {
  // The model picked in this session; each review uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [dispatchingKeys, setDispatchingKeys] = useState<ReadonlySet<string>>(() => new Set());
  const setDispatching = (key: string, dispatching: boolean) =>
    setDispatchingKeys((current) => {
      const next = new Set(current);
      if (dispatching) next.add(key);
      else next.delete(key);
      return next;
    });
  return { picked, setPicked, dispatchingKeys, setDispatching };
}

export type ReviewDispatchState = ReturnType<typeof useReviewDispatchState>;

function useReviewDispatch(environmentId: EnvironmentId, state: ReviewDispatchState) {
  const [pickedProjects, setPickedProjects] = useLocalStorage(
    `t3code:review-requests:projects:${environmentId}`,
    {},
    PickedProjectsSchema,
  );
  const { projectFor, modelFor, dispatchReview, reviewBlockedReason } =
    useDispatchIssue(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const pickKey = (pr: ReviewRequestSummary) => `${pr.host}/${pr.repository}`.toLowerCase();
  /** The last project picked for the repository while it still exists, else its own project. */
  const projectOf = (pr: ReviewRequestSummary) => {
    const id = pickedProjects[pickKey(pr)];
    return projects.find((project) => project.id === id) ?? projectFor(pr);
  };
  /** The project the pull request is read through: its own, else any, since the server reads public GitHub through any project. */
  const readProjectOf = (pr: ReviewRequestSummary) => projectOf(pr) ?? projects[0];
  /** Why the review cannot start; a missing project is picked in the dispatch bar. */
  const blockedReason = (pr: ReviewRequestSummary) =>
    reviewBlockedReason() ?? (projectOf(pr) === undefined ? CHOOSE_PROJECT : null);
  const review = async (pr: ReviewRequestSummary) => {
    const key = reviewRequestKey(pr);
    const project = projectOf(pr);
    if (project === undefined || state.dispatchingKeys.has(key)) return;
    state.setDispatching(key, true);
    // Reports its own failures and never rejects.
    await dispatchReview(pr, project, state.picked);
    state.setDispatching(key, false);
  };
  const chooseProject = (pr: ReviewRequestSummary, projectId: string) =>
    setPickedProjects((current) => ({ ...current, [pickKey(pr)]: projectId }));
  return {
    projects,
    projectOf,
    readProjectOf,
    modelFor,
    reviewBlockedReason,
    blockedReason,
    review,
    chooseProject,
  };
}

export function PullRequestReviewRequests(props: {
  readonly environmentId: EnvironmentId;
  readonly state: ReviewDispatchState;
  readonly entries: ReadonlyArray<ReviewRequestSummary>;
  readonly truncated: boolean;
  readonly error: string | null;
  /** The pull request open in the detail panel, highlighted like the main list's selection. */
  readonly selected: {
    readonly repository: string;
    readonly host: string | undefined;
    readonly number: number;
  } | null;
  readonly onOpen: (target: PullRequestRowTarget) => void;
}) {
  const { environmentId, state } = props;
  const { readProjectOf } = useReviewDispatch(environmentId, state);
  // The thread each pull request is linked to; a review dispatch links its PR to the new thread.
  const linkedThreads = new Map<string, ThreadId>();
  for (const thread of useThreadShells()) {
    if (thread.environmentId !== environmentId || thread.archivedAt !== null) continue;
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      linkedThreads.set(reviewRequestKey(link), thread.id);
    }
  }

  const { entries } = props;
  if (entries.length === 0 && props.error === null) return null;

  /** The PR in the detail panel, read through any project; on GitHub only when there is none. */
  const openPullRequest = (pr: ReviewRequestSummary) => {
    const project = readProjectOf(pr);
    if (project === undefined) {
      openExternalUrl(pr.url);
      return;
    }
    props.onOpen({
      environmentId,
      projectId: project.id,
      host: pr.host,
      repository: pr.repository,
      number: pr.number,
    });
  };

  return (
    <div className="space-y-0.5">
      <PullRequestGroupHeader
        group={{ key: "reviewRequested", label: "Review requested" }}
        count={entries.length}
      />
      {props.error === null ? null : (
        <p role="alert" className="px-3 py-1 text-destructive-foreground text-xs">
          GitHub: {props.error}
        </p>
      )}
      <ul>
        {entries.map((pr) => {
          const key = reviewRequestKey(pr);
          const threadId = linkedThreads.get(key);
          const readProject = readProjectOf(pr);
          const open =
            props.selected !== null &&
            props.selected.number === pr.number &&
            props.selected.repository.toLowerCase() === pr.repository.toLowerCase() &&
            (props.selected.host ?? pr.host).toLowerCase() === pr.host.toLowerCase();
          return (
            <li
              key={key}
              className={cn(
                PULL_REQUEST_PAGE_ROW_FRAME_CLASS,
                open ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <button
                type="button"
                aria-current={open ? "true" : undefined}
                className={PULL_REQUEST_PAGE_ROW_BUTTON_CLASS}
                onClick={() => openPullRequest(pr)}
              >
                <PullRequestRowGlyph
                  state="open"
                  isDraft={pr.isDraft}
                  className="mt-0.75 self-start"
                />
                <PullRequestRowLines
                  number={
                    <ExternalRefLink
                      inRow
                      url={pr.url}
                      label={`#${pr.number}`}
                      openLabel={OPEN_ON_GITHUB}
                      ariaLabel={`Open #${pr.number} on GitHub`}
                      className={PULL_REQUEST_ROW_NUMBER_CLASS}
                    />
                  }
                  title={pr.title}
                  status={
                    <PullRequestChangeBreakdownStat
                      environmentId={environmentId}
                      reference={
                        readProject === undefined
                          ? null
                          : {
                              projectId: readProject.id,
                              host: pr.host,
                              repository: pr.repository,
                              number: pr.number,
                            }
                      }
                      additions={pr.additions ?? 0}
                      deletions={pr.deletions ?? 0}
                      className="font-mono"
                    />
                  }
                  meta={
                    <>
                      <PullRequestRowAuthor actor={pr.author} className="min-w-3.5 max-w-40" />
                      <span className="truncate">{pr.repository}</span>
                    </>
                  }
                  updatedAt={pr.updatedAt}
                />
              </button>
              <div className={cn(PULL_REQUEST_PAGE_ROW_TRAILING_CLASS, "flex items-center gap-2")}>
                {threadId === undefined ? null : (
                  <Badge
                    variant="info"
                    size="sm"
                    title="A review thread is already open for this pull request"
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
                      />
                    }
                  >
                    Dispatched
                  </Badge>
                )}
                <PullRequestReviewButton
                  environmentId={environmentId}
                  state={state}
                  pr={pr}
                  onChooseProject={() => openPullRequest(pr)}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {props.truncated ? (
        <p className="px-3 pt-1 text-muted-foreground text-xs">
          Showing the most recently updated review requests.
        </p>
      ) : null}
    </div>
  );
}

/** Starts a read-only review agent in its own worktree on the pull request's head. */
export function PullRequestReviewButton(props: {
  readonly environmentId: EnvironmentId;
  readonly state: ReviewDispatchState;
  readonly pr: ReviewRequestSummary;
  /** Opens the pull request's dispatch bar, where a project is chosen when none matches. */
  readonly onChooseProject: () => void;
}) {
  const { projectOf, readProjectOf, reviewBlockedReason, blockedReason, review } =
    useReviewDispatch(props.environmentId, props.state);
  const dispatching = props.state.dispatchingKeys.has(reviewRequestKey(props.pr));
  const chooseProject =
    projectOf(props.pr) === undefined && readProjectOf(props.pr) !== undefined
      ? props.onChooseProject
      : undefined;
  const blocked = chooseProject ? reviewBlockedReason() : blockedReason(props.pr);
  return (
    <Button
      type="button"
      size="compact"
      variant="outline"
      disabled={dispatching || blocked !== null}
      title={blocked ?? (chooseProject ? CHOOSE_PROJECT : START_REVIEW)}
      onClick={chooseProject ?? (() => void review(props.pr))}
    >
      {dispatching ? <Spinner /> : <PlayIcon />}
      Review
    </Button>
  );
}

/** The Issues page's dispatch bar, above a review request's detail panel. */
export function PullRequestReviewDispatchBar(props: {
  readonly environmentId: EnvironmentId;
  readonly state: ReviewDispatchState;
  readonly pr: ReviewRequestSummary;
}) {
  const { environmentId, state, pr } = props;
  const { projects, projectOf, modelFor, blockedReason, review, chooseProject } = useReviewDispatch(
    environmentId,
    state,
  );
  const project = projectOf(pr);
  const dispatching = state.dispatchingKeys.has(reviewRequestKey(pr));
  const blocked = blockedReason(pr);
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2">
      <div className="min-w-0 flex-1">
        <Select
          value={project?.id ?? null}
          disabled={dispatching}
          onValueChange={(value) => {
            if (typeof value === "string") chooseProject(pr, value);
          }}
        >
          <SelectTrigger size="sm" className="min-w-0" aria-label="Project">
            <SelectValue>
              {(value: string | null) =>
                projects.find((candidate) => candidate.id === value)?.title ?? "Choose a project"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {projects.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="shrink-0">
        <IssueModelPicker
          environmentId={environmentId}
          projectId={project?.id ?? null}
          value={project === undefined ? state.picked : modelFor(project, state.picked)}
          disabled={dispatching}
          onChange={state.setPicked}
        />
      </div>
      <Button
        type="button"
        size="icon"
        aria-label="Start review"
        disabled={dispatching || blocked !== null}
        title={blocked ?? START_REVIEW}
        onClick={() => void review(pr)}
      >
        {dispatching ? <Spinner /> : <PlayIcon />}
      </Button>
    </div>
  );
}
