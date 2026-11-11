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
import { ExternalLinkIcon, EyeIcon } from "lucide-react";
import { useState } from "react";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { IssueModelPicker } from "../issues/IssueModelPicker";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
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
    if (project === undefined || dispatchingKeys.has(key)) return;
    setDispatchingKeys((current) => new Set(current).add(key));
    // Reports its own failures and never rejects.
    await dispatchReview(pr, project, picked);
    setDispatchingKeys((current) => {
      const next = new Set(current);
      next.delete(key);
      return next;
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
          const project = projectOf(pr);
          const selected = key === selectedKey;
          const dispatching = dispatchingKeys.has(key);
          const blocked =
            connectionBlocked ??
            (project === undefined ? `Add ${pr.repository} as a project, or choose one` : null);
          const threadId = linkedThreads.get(key);
          const ownProject = projectFor(pr);
          return (
            <li key={key} className={cn("rounded-md", !selected && "hover:bg-accent/60")}>
              <div className="flex items-center gap-2 pr-3">
                <button
                  type="button"
                  aria-expanded={selected}
                  className={cn(
                    PULL_REQUEST_ROW_CLASS,
                    "min-w-0 flex-1 cursor-pointer px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
                  )}
                  onClick={() => setSelectedKey(selected ? null : key)}
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
                {threadId === undefined ? null : (
                  <Badge
                    variant="info"
                    size="sm"
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
                      />
                    }
                    title="A thread is linked to this pull request"
                  >
                    Dispatched
                  </Badge>
                )}
                <Button
                  type="button"
                  size="compact"
                  variant="outline"
                  disabled={dispatching || blocked !== null}
                  title={blocked ?? "Start a read-only review agent on this pull request"}
                  onClick={() => void review(pr, key)}
                >
                  {dispatching ? <Spinner /> : <EyeIcon />}
                  Review
                </Button>
              </div>
              {selected ? (
                <div className="flex items-center gap-2 px-3 pb-2.5">
                  <div className="min-w-0 flex-1">
                    <Select
                      value={project?.id ?? null}
                      disabled={dispatching}
                      onValueChange={(value) => {
                        if (typeof value !== "string") return;
                        setPickedProjects((current) => ({ ...current, [pickKey(pr)]: value }));
                      }}
                    >
                      <SelectTrigger size="sm" className="min-w-0" aria-label="Project">
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
                  </div>
                  <div className="shrink-0">
                    <IssueModelPicker
                      environmentId={environmentId}
                      projectId={project?.id ?? null}
                      value={project === undefined ? picked : modelFor(project, picked)}
                      disabled={dispatching}
                      onChange={setPicked}
                    />
                  </div>
                  {ownProject === undefined ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Open on GitHub"
                      title="Open on GitHub"
                      render={<a href={pr.url} target="_blank" rel="noreferrer" />}
                    >
                      <ExternalLinkIcon />
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      onClick={() =>
                        props.onOpen({
                          environmentId,
                          projectId: ownProject.id,
                          host: pr.host,
                          repository: pr.repository,
                          number: pr.number,
                        })
                      }
                    >
                      Open
                    </Button>
                  )}
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
