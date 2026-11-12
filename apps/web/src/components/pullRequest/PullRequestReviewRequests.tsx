import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ModelSelection,
  ReviewRequestSummary,
  ThreadId,
} from "@t3tools/contracts";
import { visibleThreadPullRequests } from "@t3tools/client-runtime/thread-pull-requests";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { IssueModelPicker } from "../issues/IssueModelPicker";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { PullRequestGroupHeader } from "./PullRequestListGroups";
import {
  PULL_REQUEST_ROW_CLASS,
  PULL_REQUEST_ROW_NUMBER_CLASS,
  PullRequestRowAuthor,
  PullRequestRowGlyph,
  PullRequestRowLines,
} from "./PullRequestListRow";
import type { PullRequestRowTarget } from "./PullRequestRow";
import { reviewRequestKey } from "./pullRequestList.logic";

// Per environment: the project each repository's review requests were last dispatched into.
const PickedProjectsSchema = Schema.Record(Schema.String, Schema.String);

/** Open GitHub pull requests in any repository that ask the viewer, or a team of theirs, to review. */
export function useReviewRequests(environmentId: EnvironmentId | null) {
  const query = useEnvironmentQuery(
    environmentId === null ? null : issueEnvironment.reviewRequests({ environmentId, input: {} }),
  );
  return {
    entries: query.data?.entries ?? [],
    truncated: query.data?.truncated ?? false,
    error: query.error,
    refresh: query.refresh,
  };
}

export function PullRequestReviewRequests(props: {
  readonly environmentId: EnvironmentId;
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
  const { environmentId } = props;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dispatchingKeys, setDispatchingKeys] = useState<ReadonlySet<string>>(() => new Set());
  // The model picked in this session; each review uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
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

  const pickKey = (pr: ReviewRequestSummary) => `${pr.host}/${pr.repository}`.toLowerCase();
  /** The last project picked for the repository while it still exists, else its own project. */
  const projectOf = (pr: ReviewRequestSummary) => {
    const id = pickedProjects[pickKey(pr)];
    return projects.find((project) => project.id === id) ?? projectFor(pr);
  };
  const connectionBlocked = reviewBlockedReason();

  const review = async (pr: ReviewRequestSummary, key: string) => {
    const project = projectOf(pr);
    // Without a project there is nowhere to check out the PR, so ask for one instead.
    if (project === undefined) {
      setSelectedKey(key);
      return;
    }
    if (dispatchingKeys.has(key)) return;
    setDispatchingKeys((current) => new Set(current).add(key));
    // Reports its own failures and never rejects.
    await dispatchReview(pr, project, picked);
    setDispatchingKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  /** The PR's detail panel when its repository is a project, else the PR on GitHub. */
  const openPullRequest = (pr: ReviewRequestSummary) => {
    const ownProject = projectFor(pr);
    if (ownProject === undefined) {
      window.open(pr.url, "_blank", "noopener,noreferrer");
      return;
    }
    props.onOpen({
      environmentId,
      projectId: ownProject.id,
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
      {/* Rows share one grid so the time, thread link and Review columns line up on every row. */}
      <ul className="grid grid-cols-[minmax(0,1fr)_auto_auto]">
        {entries.map((pr) => {
          const key = reviewRequestKey(pr);
          const project = projectOf(pr);
          const configuring = key === selectedKey;
          const dispatching = dispatchingKeys.has(key);
          const threadId = linkedThreads.get(key);
          const open =
            props.selected !== null &&
            props.selected.number === pr.number &&
            props.selected.repository.toLowerCase() === pr.repository.toLowerCase() &&
            (props.selected.host ?? pr.host).toLowerCase() === pr.host.toLowerCase();
          return (
            <li
              key={key}
              className={cn(
                "col-span-3 grid grid-cols-subgrid items-center rounded-md",
                open ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <button
                type="button"
                aria-current={open ? "true" : undefined}
                className={cn(
                  PULL_REQUEST_ROW_CLASS,
                  "min-w-0 cursor-pointer px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                )}
                onClick={() => openPullRequest(pr)}
              >
                <PullRequestRowGlyph
                  state="open"
                  isDraft={pr.isDraft}
                  className="mt-0.75 self-start"
                />
                <PullRequestRowLines
                  number={<span className={PULL_REQUEST_ROW_NUMBER_CLASS}>#{pr.number}</span>}
                  title={pr.title}
                  meta={
                    <>
                      <PullRequestRowAuthor actor={pr.author} className="min-w-3.5 max-w-40" />
                      <span className="truncate">{pr.repository}</span>
                    </>
                  }
                  updatedAt={pr.updatedAt}
                />
              </button>
              <div className="flex justify-end pl-2">
                {threadId === undefined ? null : (
                  <Button
                    size="compact"
                    variant="ghost"
                    aria-label={`Open the review thread for #${pr.number}`}
                    title={`Open the review thread for #${pr.number}`}
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
                      />
                    }
                  >
                    <MessageSquareIcon />
                  </Button>
                )}
              </div>
              <div className="pr-3 pl-2">
                <Group aria-label={`Review #${pr.number}`}>
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    disabled={dispatching || connectionBlocked !== null}
                    title={
                      connectionBlocked ??
                      (project === undefined
                        ? `Choose a project to check out ${pr.repository}`
                        : `Start a read-only review agent in ${project.title}`)
                    }
                    onClick={() => void review(pr, key)}
                  >
                    {dispatching ? <Spinner /> : null}
                    Review
                  </Button>
                  <GroupSeparator />
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    aria-label="Choose the project and model for this review"
                    aria-expanded={configuring}
                    disabled={dispatching}
                    onClick={() => setSelectedKey(configuring ? null : key)}
                  >
                    <ChevronDownIcon />
                  </Button>
                </Group>
              </div>
              {configuring ? (
                <div className="col-span-3 flex items-center justify-end gap-2 px-3 pb-2.5">
                  <Select
                    value={project?.id ?? null}
                    disabled={dispatching}
                    onValueChange={(value) => {
                      if (typeof value !== "string") return;
                      setPickedProjects((current) => ({ ...current, [pickKey(pr)]: value }));
                    }}
                  >
                    <SelectTrigger size="sm" className="w-auto max-w-60" aria-label="Project">
                      <SelectValue>
                        {(value: string | null) =>
                          projects.find((candidate) => candidate.id === value)?.title ??
                          "Choose a project"
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
                  <IssueModelPicker
                    environmentId={environmentId}
                    projectId={project?.id ?? null}
                    value={project === undefined ? picked : modelFor(project, picked)}
                    disabled={dispatching}
                    onChange={setPicked}
                  />
                  <Button
                    type="button"
                    size="compact"
                    disabled={dispatching || project === undefined || connectionBlocked !== null}
                    onClick={() => void review(pr, key)}
                  >
                    {dispatching ? <Spinner /> : null}
                    Start review
                  </Button>
                </div>
              ) : null}
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
