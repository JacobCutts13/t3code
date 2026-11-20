import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type IssueDetail,
  type ModelSelection,
  threadIssueKeysEqual,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import { PlayIcon } from "lucide-react";
import { useState } from "react";

import { useDispatchIssue } from "~/hooks/useDispatchIssue";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { useProjects, useThreadShells } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { IssueModelPicker } from "./IssueModelPicker";
import { dispatchedThreadId, issueBranchName, threadsByBranch } from "./issueDispatch.logic";

// Per viewer: the project each tracker scope's issues were last dispatched into.
const PickedProjectsSchema = Schema.Record(Schema.String, Schema.String);

/**
 * Starts an agent on the issue: a thread in a new worktree of the chosen project whose first
 * message runs `/complete-task`, which plans first and waits for approval before building.
 */
export function IssueDispatchBar({
  environmentId,
  detail,
}: {
  environmentId: EnvironmentId;
  detail: IssueDetail;
}) {
  const gt = useGT();
  const [dispatching, setDispatching] = useState(false);
  // The model picked in this session; each dispatch uses it where the project offers it.
  const [picked, setPicked] = useState<ModelSelection | null>(null);
  const [pickedProjects, setPickedProjects] = useLocalStorage(
    `t3code:issues:projects:${environmentId}`,
    {},
    PickedProjectsSchema,
  );
  const { modelFor, dispatch } = useDispatchIssue(environmentId);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.isScratch !== true,
  );
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);

  const pickKey = `${detail.tracker}:${detail.host}/${detail.scope}`.toLowerCase();
  const project =
    projects.find((candidate) => candidate.id === pickedProjects[pickKey]) ??
    projects.find((candidate) => candidate.id === detail.projectId);
  const branch = issueBranchName(detail);
  const existingThreadId =
    threads.find(
      (thread) =>
        thread.archivedAt === null &&
        (thread.issues ?? []).some((link) => threadIssueKeysEqual(link, detail)),
    )?.id ?? dispatchedThreadId(threadsByBranch(threads), project?.id, branch);

  const start = async () => {
    if (project === undefined || dispatching) return;
    setDispatching(true);
    // Reports its own failures and never rejects.
    await dispatch(detail, project, picked);
    setDispatching(false);
  };

  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <div className="min-w-0 flex-1">
        <Select
          value={project?.id ?? null}
          disabled={dispatching}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            setPickedProjects((current) => ({ ...current, [pickKey]: value }));
          }}
        >
          <SelectTrigger
            size="sm"
            className="min-w-0"
            aria-label={gt("Project", { $context: "noun, project selection" })}
          >
            <SelectValue>
              {(value: string | null) =>
                projects.find((candidate) => candidate.id === value)?.title ??
                gt("Choose a project")
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
      {existingThreadId === null ? null : (
        <Badge
          variant="info"
          size="sm"
          render={
            <Link
              to="/$environmentId/$threadId"
              params={buildThreadRouteParams(scopeThreadRef(environmentId, existingThreadId))}
            />
          }
          title={gt("A thread is already working on this issue")}
        >
          <T context="status of an issue assigned to an agent">Dispatched</T>
        </Badge>
      )}
      <Button
        type="button"
        size="icon"
        aria-label={gt("Dispatch agent", { $context: "verb, start an agent on an issue" })}
        disabled={dispatching || project === undefined}
        title={
          project === undefined
            ? gt("Choose a project to dispatch into")
            : gt("Start an agent on this issue")
        }
        onClick={() => void start()}
      >
        {dispatching ? <Spinner /> : <PlayIcon />}
      </Button>
    </div>
  );
}
