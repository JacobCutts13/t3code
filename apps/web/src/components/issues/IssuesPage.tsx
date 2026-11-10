import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type IssueComment,
  type IssueInvolvement,
  type IssueState,
  type IssueSummary,
  type LinearIssueSummary,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { CircleDotIcon, ExternalLinkIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { useProjects, useThreadShells } from "~/state/entities";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { buildThreadRouteParams } from "~/threadRoutes";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import ChatMarkdown from "../ChatMarkdown";
import { RelativeTime } from "../RelativeTime";
import { IssueModelPicker } from "./IssueModelPicker";
import {
  dispatchedThreadId,
  issueBranchName,
  linearBranchName,
  threadsByBranch,
} from "./issueDispatch.logic";
import { type IssueEntry, mergeIssuePages, mergeIssueSources } from "./issueList.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const INVOLVEMENTS: ReadonlyArray<{ readonly value: IssueInvolvement; readonly label: string }> = [
  { value: "mine", label: "Mine" },
  { value: "assigned", label: "Assigned" },
  { value: "authored", label: "Opened by me" },
];

const STATES: ReadonlyArray<{ readonly value: IssueState; readonly label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
];

type IssueSource = "all" | "github" | "linear";

const SOURCES: ReadonlyArray<{ readonly value: IssueSource; readonly label: string }> = [
  { value: "all", label: "All" },
  { value: "github", label: "GitHub" },
  { value: "linear", label: "Linear" },
];

const PRIORITY_LABELS = ["", "Urgent", "High", "Medium", "Low"] as const;

// Per viewer: the project each Linear team's or GitHub repository's issues were last dispatched into.
const PickedProjectsSchema = Schema.Record(Schema.String, Schema.String);

function FilterGroup<T extends string>(props: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onChange: (value: T) => void;
}) {
  return (
    <ToggleGroup
      aria-label={props.label}
      className="shrink-0"
      size="segmented"
      variant="segmented"
      value={[props.value]}
      onValueChange={(next) => {
        // Deselecting the active option sends an empty list; keep the current one.
        const option = props.options.find((candidate) => candidate.value === next[0]);
        if (option) props.onChange(option.value);
      }}
    >
      {props.options.map((option) => (
        <Toggle key={option.value} value={option.value}>
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

function IssueRow(props: {
  readonly title: string;
  readonly meta: ReactNode;
  readonly selected: boolean;
  readonly dispatching: boolean;
  /** Why Dispatch is unavailable, or null when it can run. */
  readonly blockedReason: string | null;
  readonly environmentId: EnvironmentId;
  readonly dispatchedThreadId: ThreadId | null;
  readonly onSelect: () => void;
  readonly onDispatch: () => void;
}) {
  return (
    <li
      className={cn(
        "flex items-start gap-2 border-b px-3 py-2.5 transition-colors hover:bg-accent/50",
        props.selected && "bg-accent",
      )}
    >
      <button
        type="button"
        aria-current={props.selected}
        className="flex min-w-0 flex-1 flex-col gap-1 text-start outline-none focus-visible:underline"
        onClick={props.onSelect}
      >
        <span className="truncate text-sm font-medium">{props.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          {props.meta}
        </span>
      </button>
      {props.dispatchedThreadId === null ? null : (
        <Badge
          variant="info"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(
                scopeThreadRef(props.environmentId, props.dispatchedThreadId),
              )}
            />
          }
          title="A thread is already working on this issue's branch"
        >
          Dispatched
        </Badge>
      )}
      <Button
        type="button"
        size="compact"
        variant="outline"
        disabled={props.dispatching || props.blockedReason !== null}
        title={props.blockedReason ?? "Start an agent on this issue"}
        onClick={props.onDispatch}
      >
        {props.dispatching ? <Spinner /> : <PlayIcon />}
        Dispatch
      </Button>
    </li>
  );
}

function GitHubIssueMeta(props: { readonly issue: IssueSummary }) {
  const { issue } = props;
  return (
    <>
      <span>
        {issue.repository}#{issue.number}
      </span>
      <RelativeTime timestamp={issue.updatedAt} />
      {issue.labels.slice(0, 3).map((label) => (
        <Badge key={label.name} variant="outline" size="sm">
          {label.name}
        </Badge>
      ))}
    </>
  );
}

function LinearStateLabel(props: { readonly state: LinearIssueSummary["state"] }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: props.state.color }}
      />
      {props.state.name}
    </span>
  );
}

function LinearIssueMeta(props: { readonly issue: LinearIssueSummary }) {
  const { issue } = props;
  const priority = PRIORITY_LABELS[issue.priority];
  return (
    <>
      <span>{issue.identifier}</span>
      <LinearStateLabel state={issue.state} />
      {priority ? <span>{priority}</span> : null}
      <span>{issue.project ?? issue.team.name}</span>
      <RelativeTime timestamp={issue.updatedAt} />
    </>
  );
}

/** An issue's description and comments, whichever tracker it comes from. */
function IssueDetailBody(props: {
  readonly environmentId: EnvironmentId;
  readonly error: string | null;
  readonly detail: {
    readonly description: string;
    readonly comments: ReadonlyArray<IssueComment>;
    readonly commentsTruncated: boolean;
  } | null;
}) {
  const { environmentId, error, detail } = props;
  if (error !== null) {
    return (
      <p role="alert" className="text-destructive-foreground text-sm">
        {error}
      </p>
    );
  }
  if (detail === null) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Loading…
      </p>
    );
  }
  return (
    <>
      {detail.description.trim() === "" ? (
        <p className="text-muted-foreground text-sm">No description.</p>
      ) : (
        <ChatMarkdown text={detail.description} cwd={undefined} environmentId={environmentId} />
      )}
      {detail.commentsTruncated ? (
        <p className="text-muted-foreground text-xs">
          Showing the first {detail.comments.length} comments.
        </p>
      ) : null}
      {detail.comments.map((comment) => (
        <section
          key={`${comment.createdAt}:${comment.author ?? ""}`}
          className="flex flex-col gap-1 border-t pt-3"
        >
          <h3 className="text-muted-foreground text-xs">
            {comment.author ?? "unknown"} · <RelativeTime timestamp={comment.createdAt} />
          </h3>
          <ChatMarkdown text={comment.body} cwd={undefined} environmentId={environmentId} />
        </section>
      ))}
    </>
  );
}

function LinearIssueDetailPane(props: {
  readonly environmentId: EnvironmentId;
  readonly issue: LinearIssueSummary;
}) {
  const { environmentId, issue } = props;
  const detail = useEnvironmentQuery(
    issueEnvironment.linearGet({ environmentId, input: { id: issue.id } }),
  );
  return (
    <article className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold leading-tight">{issue.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
          <span>{issue.identifier}</span>
          <LinearStateLabel state={issue.state} />
          {issue.assignee ? <span>assigned to {issue.assignee}</span> : null}
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            Linear <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </header>
      <IssueDetailBody environmentId={environmentId} error={detail.error} detail={detail.data} />
    </article>
  );
}

function IssueDetailPane(props: {
  readonly environmentId: EnvironmentId;
  readonly issue: IssueSummary;
}) {
  const { environmentId, issue } = props;
  const detail = useEnvironmentQuery(
    issueEnvironment.get({
      environmentId,
      input: { host: issue.host, repository: issue.repository, number: issue.number },
    }),
  );
  return (
    <article className="flex flex-col gap-4 p-6">
      <header className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold leading-tight">{issue.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
          <span>
            {issue.repository}#{issue.number}
          </span>
          {issue.author ? <span>opened by {issue.author}</span> : null}
          {issue.assignees.length > 0 ? (
            <span>assigned to {issue.assignees.join(", ")}</span>
          ) : null}
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            GitHub <ExternalLinkIcon className="size-3" />
          </a>
        </div>
        <div className="flex flex-wrap gap-1">
          {issue.labels.map((label) => (
            <Badge key={label.name} variant="outline">
              {label.name}
            </Badge>
          ))}
        </div>
      </header>
      <IssueDetailBody
        environmentId={environmentId}
        error={detail.error}
        detail={detail.data === null ? null : { ...detail.data, description: detail.data.body }}
      />
    </article>
  );
}

interface MorePages {
  readonly key: string;
  readonly entries: ReadonlyArray<IssueSummary>;
  /** Pages read so far, the first included. */
  readonly pages: number;
  readonly hasMore: boolean;
  readonly loading: boolean;
  readonly error: string | null;
}

const errorMessage = (error: unknown) =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Could not load more issues.";

function SourceNotice(props: { readonly source: "GitHub" | "Linear"; readonly error: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border-b p-3 text-sm">
      <p className="text-destructive-foreground">
        {props.source}: {props.error}
      </p>
      {props.source === "Linear" ? (
        <Link
          to="/settings/source-control"
          className="text-xs underline underline-offset-2 hover:text-foreground"
        >
          Open Settings → Source control
        </Link>
      ) : null}
    </div>
  );
}

function IssuesView(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const [source, setSource] = useState<IssueSource>("all");
  const [involvement, setInvolvement] = useState<IssueInvolvement>("mine");
  const [state, setState] = useState<IssueState>("open");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null);
  // The model picked in this session; each dispatch uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [pickedProjects, setPickedProjects] = useLocalStorage(
    `t3code:issues:projects:${environmentId}`,
    {},
    PickedProjectsSchema,
  );
  const { projectFor, modelFor, dispatch, dispatchLinear } = useDispatchIssue(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const byBranch = threadsByBranch(
    useThreadShells().filter((thread) => thread.environmentId === environmentId),
  );
  const showGitHub = source !== "linear";
  const showLinear = source !== "github";
  const list = useEnvironmentQuery(
    showGitHub ? issueEnvironment.list({ environmentId, input: { involvement, state } }) : null,
  );
  const linearList = useEnvironmentQuery(
    showLinear
      ? issueEnvironment.linearList({ environmentId, input: { involvement, state } })
      : null,
  );
  const loadPage = useAtomQueryRunner(issueEnvironment.list, {
    reportFailure: false,
    reportDefect: false,
  });
  // GitHub pages after the first, read by "Load more" under the filters in `key`.
  const [more, setMore] = useState<MorePages | null>(null);
  const filterKey = `${involvement}:${state}`;
  const extra = more?.key === filterKey ? more : null;
  const githubEntries = showGitHub
    ? mergeIssuePages([list.data?.entries ?? [], extra?.entries ?? []])
    : [];
  const entries = mergeIssueSources(
    githubEntries,
    showLinear ? (linearList.data?.entries ?? []) : [],
  );
  const hasMore = showGitHub && (extra === null ? (list.data?.hasMore ?? false) : extra.hasMore);
  // With every shown tracker failing, its notice is the whole answer, not "no issues".
  const linearDisconnected = linearList.data?.connected === false;
  const failedEverySource =
    (!showGitHub || list.error !== null) &&
    (!showLinear || linearList.error !== null || linearDisconnected);
  const loading =
    (showGitHub && list.data === null && list.error === null) ||
    (showLinear && linearList.data === null && linearList.error === null);

  const loadMore = async () => {
    const pages = extra?.pages ?? 1;
    const previous = extra?.entries ?? [];
    setMore({
      key: filterKey,
      entries: previous,
      pages,
      hasMore: true,
      loading: true,
      error: null,
    });
    const result = await loadPage({
      environmentId,
      input: { involvement, state, page: pages + 1 },
    });
    const next: MorePages =
      result._tag === "Success"
        ? {
            key: filterKey,
            entries: mergeIssuePages([previous, result.value.entries]),
            pages: pages + 1,
            hasMore: result.value.hasMore,
            loading: false,
            error: null,
          }
        : {
            key: filterKey,
            entries: previous,
            pages,
            hasMore: true,
            loading: false,
            error: isAtomCommandInterrupted(result)
              ? null
              : errorMessage(squashAtomCommandFailure(result)),
          };
    setMore((current) => (current?.key === filterKey ? next : current));
  };

  const pickKey = (entry: IssueEntry) =>
    entry.source === "github"
      ? `github:${entry.issue.host}/${entry.issue.repository}`
      : `linear:${entry.issue.team.id}`;
  /**
   * The project an issue goes to: the last one picked for its team or repository while it still
   * exists, else for GitHub the repository's own project.
   */
  const projectOf = (entry: IssueEntry) => {
    const id = pickedProjects[pickKey(entry)];
    const remembered = id === undefined ? undefined : projects.find((project) => project.id === id);
    return remembered ?? (entry.source === "github" ? projectFor(entry.issue) : undefined);
  };
  const branchOf = (entry: IssueEntry) =>
    entry.source === "github" ? issueBranchName(entry.issue) : linearBranchName(entry.issue);
  const blockedReason = (entry: IssueEntry, project: ReturnType<typeof projectOf>) =>
    project !== undefined
      ? null
      : entry.source === "github"
        ? `Add ${entry.issue.repository} as a project, or choose one in the issue details`
        : "Choose a project in the issue details";

  const selected = entries.find((entry) => entry.key === selectedKey) ?? null;
  const selectedProject = selected === null ? undefined : projectOf(selected);

  const dispatchEntry = async (entry: IssueEntry) => {
    const project = projectOf(entry);
    if (project === undefined) return;
    setDispatchingKey(entry.key);
    // Both report their own failures and never reject.
    if (entry.source === "github") await dispatch(entry.issue, project, picked);
    else await dispatchLinear(entry.issue, project, picked);
    setDispatchingKey(null);
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="border-b">
        <h1 className="font-medium text-sm">Issues</h1>
        <FilterGroup label="Source" value={source} options={SOURCES} onChange={setSource} />
        <FilterGroup
          label="Involvement"
          value={involvement}
          options={INVOLVEMENTS}
          onChange={setInvolvement}
        />
        <FilterGroup label="State" value={state} options={STATES} onChange={setState} />
        <Button
          type="button"
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Refresh issues"
          onClick={() => {
            setMore(null);
            if (showGitHub) list.refresh();
            if (showLinear) linearList.refresh();
          }}
        >
          <RefreshCwIcon
            className={cn((list.isPending || linearList.isPending) && "animate-spin")}
          />
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="w-[28rem] max-w-[45%] shrink-0 overflow-y-auto border-r">
          {showGitHub && list.error !== null && githubEntries.length === 0 ? (
            <SourceNotice source="GitHub" error={list.error} />
          ) : null}
          {showLinear && linearList.error !== null ? (
            <SourceNotice source="Linear" error={linearList.error} />
          ) : null}
          {/* In All, an unconnected Linear stays quiet so GitHub-only users see no noise. */}
          {source === "linear" && linearDisconnected ? (
            <div className="flex flex-col gap-1 p-4 text-muted-foreground text-sm">
              <p>Linear isn't connected.</p>
              <Link
                to="/settings/source-control"
                className="text-xs underline underline-offset-2 hover:text-foreground"
              >
                Add a Linear API key in Settings → Source control
              </Link>
            </div>
          ) : null}
          {entries.length === 0 && loading ? (
            <p role="status" className="p-4 text-muted-foreground text-sm">
              Loading issues…
            </p>
          ) : entries.length === 0 && failedEverySource ? null : entries.length === 0 ? (
            <Empty size="compact">
              <EmptyHeader>
                <CircleDotIcon className="size-5 text-muted-foreground" />
                <EmptyTitle>No {state} issues</EmptyTitle>
                <EmptyDescription>Nothing matches these filters.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <ul>
                {entries.map((entry) => {
                  const project = projectOf(entry);
                  return (
                    <IssueRow
                      key={entry.key}
                      title={entry.issue.title}
                      meta={
                        entry.source === "github" ? (
                          <GitHubIssueMeta issue={entry.issue} />
                        ) : (
                          <LinearIssueMeta issue={entry.issue} />
                        )
                      }
                      selected={entry.key === selectedKey}
                      dispatching={dispatchingKey === entry.key}
                      blockedReason={blockedReason(entry, project)}
                      environmentId={environmentId}
                      dispatchedThreadId={dispatchedThreadId(
                        byBranch,
                        project?.id,
                        branchOf(entry),
                      )}
                      onSelect={() => setSelectedKey(entry.key)}
                      onDispatch={() => void dispatchEntry(entry)}
                    />
                  );
                })}
              </ul>
              {showLinear && linearList.data?.hasMore ? (
                <p className="px-3 pt-3 text-muted-foreground text-xs">
                  Showing the most recently updated Linear issues; refine the filters to see others.
                </p>
              ) : null}
              {hasMore ? (
                <div className="flex flex-col items-start gap-2 p-3">
                  <Button
                    type="button"
                    size="compact"
                    variant="outline"
                    disabled={extra?.loading === true}
                    onClick={() => void loadMore()}
                  >
                    {extra?.loading === true ? <Spinner /> : null}
                    Load more
                  </Button>
                  {extra?.error ? (
                    <p role="alert" className="text-destructive-foreground text-xs">
                      {extra.error}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto">
          {selected === null ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Select an issue</EmptyTitle>
                <EmptyDescription>
                  Dispatch starts an agent in a new worktree and asks you to approve its plan.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div>
              <div className="flex items-center justify-end gap-2 border-b px-6 py-2">
                <Select
                  value={selectedProject?.id ?? null}
                  disabled={dispatchingKey === selectedKey}
                  onValueChange={(value) => {
                    if (typeof value !== "string") return;
                    setPickedProjects((current) => ({ ...current, [pickKey(selected)]: value }));
                  }}
                >
                  <SelectTrigger size="sm" aria-label="Project">
                    <SelectValue>
                      {(value: string | null) =>
                        projects.find((project) => project.id === value)?.title ??
                        "Choose a project"
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {selectedProject === undefined ? null : (
                  <IssueModelPicker
                    environmentId={environmentId}
                    projectId={selectedProject.id}
                    value={modelFor(selectedProject, picked)}
                    disabled={dispatchingKey === selectedKey}
                    onChange={setPicked}
                  />
                )}
                <Button
                  type="button"
                  disabled={dispatchingKey === selectedKey || selectedProject === undefined}
                  title={blockedReason(selected, selectedProject) ?? "Start an agent on this issue"}
                  onClick={() => void dispatchEntry(selected)}
                >
                  <PlayIcon />
                  Dispatch agent
                </Button>
              </div>
              {selected.source === "github" ? (
                <IssueDetailPane environmentId={environmentId} issue={selected.issue} />
              ) : (
                <LinearIssueDetailPane environmentId={environmentId} issue={selected.issue} />
              )}
            </div>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

export function IssuesPage() {
  const environmentId = usePrimaryEnvironmentId();
  return environmentId === null ? (
    <SidebarInset className="h-dvh min-h-0">
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No environment</EmptyTitle>
          <EmptyDescription>Connect to an environment to see its issues.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  ) : (
    <IssuesView environmentId={environmentId} />
  );
}
