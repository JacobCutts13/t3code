import type {
  EnvironmentId,
  IssueInvolvement,
  IssueState,
  IssueSummary,
  ModelSelection,
} from "@t3tools/contracts";
import { CircleDotIcon, ExternalLinkIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

import ChatMarkdown from "../ChatMarkdown";
import { RelativeTime } from "../RelativeTime";
import { IssueModelPicker } from "./IssueModelPicker";
import { mergeIssuePages } from "./issueList.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
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

const issueKey = (issue: Pick<IssueSummary, "host" | "repository" | "number">) =>
  `${issue.host}/${issue.repository}#${issue.number}`;

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
  readonly issue: IssueSummary;
  readonly selected: boolean;
  readonly dispatching: boolean;
  readonly hasProject: boolean;
  readonly onSelect: () => void;
  readonly onDispatch: () => void;
}) {
  const { issue } = props;
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
        <span className="truncate text-sm font-medium">{issue.title}</span>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
          <span>
            {issue.repository}#{issue.number}
          </span>
          <RelativeTime timestamp={issue.updatedAt} />
          {issue.labels.slice(0, 3).map((label) => (
            <Badge key={label.name} variant="outline" size="sm">
              {label.name}
            </Badge>
          ))}
        </span>
      </button>
      <Button
        type="button"
        size="compact"
        variant="outline"
        disabled={props.dispatching || !props.hasProject}
        title={
          props.hasProject
            ? "Start an agent on this issue"
            : `Add ${issue.repository} as a project first`
        }
        onClick={props.onDispatch}
      >
        {props.dispatching ? <Spinner /> : <PlayIcon />}
        Dispatch
      </Button>
    </li>
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
      {detail.error !== null ? (
        <p role="alert" className="text-destructive-foreground text-sm">
          {detail.error}
        </p>
      ) : detail.data === null ? (
        <p role="status" className="text-muted-foreground text-sm">
          Loading…
        </p>
      ) : (
        <>
          {detail.data.body.trim() === "" ? (
            <p className="text-muted-foreground text-sm">No description.</p>
          ) : (
            <ChatMarkdown text={detail.data.body} cwd={undefined} environmentId={environmentId} />
          )}
          {detail.data.commentsTruncated ? (
            <p className="text-muted-foreground text-xs">
              Showing the first {detail.data.comments.length} comments.
            </p>
          ) : null}
          {detail.data.comments.map((comment) => (
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
      )}
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

function IssuesView(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const [involvement, setInvolvement] = useState<IssueInvolvement>("mine");
  const [state, setState] = useState<IssueState>("open");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dispatchingKey, setDispatchingKey] = useState<string | null>(null);
  // The model picked in this session; each dispatch uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const { projectFor, modelFor, dispatch } = useDispatchIssue(environmentId);
  const list = useEnvironmentQuery(
    issueEnvironment.list({ environmentId, input: { involvement, state } }),
  );
  const loadPage = useAtomQueryRunner(issueEnvironment.list, {
    reportFailure: false,
    reportDefect: false,
  });
  // Pages after the first, read by "Load more" under the filters in `key`.
  const [more, setMore] = useState<MorePages | null>(null);
  const filterKey = `${involvement}:${state}`;
  const extra = more?.key === filterKey ? more : null;
  const entries = mergeIssuePages([list.data?.entries ?? [], extra?.entries ?? []]);
  const hasMore = extra === null ? (list.data?.hasMore ?? false) : extra.hasMore;

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
  const selected = entries.find((issue) => issueKey(issue) === selectedKey) ?? null;
  const selectedProject = selected === null ? undefined : projectFor(selected);

  const dispatchIssue = async (issue: IssueSummary) => {
    setDispatchingKey(issueKey(issue));
    try {
      await dispatch(issue, picked);
    } finally {
      setDispatchingKey(null);
    }
  };

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <WorkspacePageHeader electron={isElectron} className="border-b">
        <h1 className="font-medium text-sm">Issues</h1>
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
            list.refresh();
          }}
        >
          <RefreshCwIcon className={cn(list.isPending && "animate-spin")} />
        </Button>
      </WorkspacePageHeader>
      <div className="flex min-h-0 flex-1">
        <div className="w-[28rem] max-w-[45%] shrink-0 overflow-y-auto border-r">
          {list.error !== null && entries.length === 0 ? (
            <p role="alert" className="p-4 text-destructive-foreground text-sm">
              {list.error}
            </p>
          ) : list.data === null ? (
            <p role="status" className="p-4 text-muted-foreground text-sm">
              Loading issues…
            </p>
          ) : entries.length === 0 ? (
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
                {entries.map((issue) => {
                  const key = issueKey(issue);
                  return (
                    <IssueRow
                      key={key}
                      issue={issue}
                      selected={key === selectedKey}
                      dispatching={dispatchingKey === key}
                      hasProject={projectFor(issue) !== undefined}
                      onSelect={() => setSelectedKey(key)}
                      onDispatch={() => void dispatchIssue(issue)}
                    />
                  );
                })}
              </ul>
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
                  title={
                    selectedProject === undefined
                      ? `Add ${selected.repository} as a project first`
                      : "Start an agent on this issue"
                  }
                  onClick={() => void dispatchIssue(selected)}
                >
                  <PlayIcon />
                  Dispatch agent
                </Button>
              </div>
              <IssueDetailPane environmentId={environmentId} issue={selected} />
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
