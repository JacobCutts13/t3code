import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ModelSelection, ReviewRequestSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ExternalLinkIcon, EyeIcon, PlayIcon } from "lucide-react";
import { useState } from "react";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { buildThreadRouteParams } from "~/threadRoutes";

import { dispatchedThreadId, threadsByBranch } from "../issues/issueDispatch.logic";
import { IssueModelPicker } from "../issues/IssueModelPicker";
import { RelativeTime } from "../RelativeTime";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { PullRequestGroupHeader } from "./PullRequestListGroups";
import type { PullRequestRowTarget } from "./PullRequestRow";
import { reviewRequestKey } from "./pullRequestReviewDispatch.logic";

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
    loading: query.data === null && query.error === null,
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
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null);
  // The model picked in this session; each review uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [pickedProjects, setPickedProjects] = useLocalStorage(
    `t3code:review-requests:projects:${environmentId}`,
    {},
    PickedProjectsSchema,
  );
  const { projectFor, modelFor, dispatchReview, reviewBlockedReason, isReviewLinked } =
    useDispatchIssue(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const threads = useThreadShells().filter(
    (thread) => thread.environmentId === environmentId && thread.archivedAt === null,
  );
  const byBranch = threadsByBranch(threads);

  const { entries } = props;
  if (entries.length === 0 && props.error === null) return null;

  const pickKey = (pr: ReviewRequestSummary) => `${pr.host}/${pr.repository}`.toLowerCase();
  /** The last project picked for the repository while it still exists, else its own project. */
  const projectOf = (pr: ReviewRequestSummary) => {
    const id = pickedProjects[pickKey(pr)];
    return projects.find((project) => project.id === id) ?? projectFor(pr);
  };
  const blockedReason = (pr: ReviewRequestSummary) =>
    reviewBlockedReason() ??
    (projectOf(pr) === undefined ? `Add ${pr.repository} as a project, or choose one` : null);
  const reviewThreadOf = (pr: ReviewRequestSummary, projectId: string | undefined) =>
    threads.find((thread) => isReviewLinked(thread, pr.url))?.id ??
    dispatchedThreadId(byBranch, projectId, pr.headBranch);

  const review = async (pr: ReviewRequestSummary) => {
    const project = projectOf(pr);
    if (project === undefined) return;
    const key = reviewRequestKey(pr);
    setDispatchingKey(key);
    // Reports its own failures and never rejects.
    await dispatchReview(pr, project, picked);
    setDispatchingKey(null);
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
          const dispatching = dispatchingKey === key;
          const blocked = blockedReason(pr);
          const threadId = reviewThreadOf(pr, project?.id);
          const ownProject = projectFor(pr);
          return (
            <li key={key} className={cn("rounded-md", selected && "bg-accent")}>
              <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-accent/50">
                <button
                  type="button"
                  aria-expanded={selected}
                  className="flex min-w-0 flex-1 flex-col gap-1 text-start outline-none focus-visible:underline"
                  onClick={() => setSelectedKey(selected ? null : key)}
                >
                  <span className="truncate text-sm font-medium">{pr.title}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
                    <span>
                      {pr.repository}#{pr.number}
                    </span>
                    {pr.author ? <span>{pr.author}</span> : null}
                    <RelativeTime timestamp={pr.updatedAt} />
                    {pr.isDraft ? (
                      <Badge variant="outline" size="sm">
                        Draft
                      </Badge>
                    ) : null}
                  </span>
                </button>
                {threadId === null || threadId === undefined ? null : (
                  <Badge
                    variant="info"
                    size="sm"
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={buildThreadRouteParams(scopeThreadRef(environmentId, threadId))}
                      />
                    }
                    title="A thread is already reviewing this pull request"
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
                  onClick={() => void review(pr)}
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
                  <Button
                    type="button"
                    size="icon"
                    aria-label="Start review"
                    disabled={dispatching || blocked !== null}
                    title={blocked ?? "Start a read-only review agent on this pull request"}
                    onClick={() => void review(pr)}
                  >
                    <PlayIcon />
                  </Button>
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
          Showing the 100 most recently updated review requests.
        </p>
      ) : null}
    </div>
  );
}
