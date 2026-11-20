import {
  CheckpointRef,
  CommandId,
  type OrchestrationV2Actor,
  type OrchestrationV2CreationSource,
  OrchestrationV2ThreadForkError,
  type OrchestrationV2ThreadForkResult,
  type ThreadId,
} from "@t3tools/contracts";
import { orchestrationV2WorktreePending } from "@t3tools/shared/orchestrationV2ThreadError";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";

export interface ThreadForkWorkspaceInput {
  readonly sourceThreadId: ThreadId;
  /** Also the idempotency key: a retry with the same id returns the fork it made. */
  readonly targetThreadId: ThreadId;
  readonly title?: string | undefined;
  readonly createdBy: OrchestrationV2Actor;
  readonly creationSource: OrchestrationV2CreationSource;
}

export class ThreadForkWorkspaceService extends Context.Service<
  ThreadForkWorkspaceService,
  {
    readonly fork: (
      input: ThreadForkWorkspaceInput,
    ) => Effect.Effect<OrchestrationV2ThreadForkResult, OrchestrationV2ThreadForkError>;
  }
>()("t3/orchestration-v2/ThreadForkWorkspaceService") {}

/** `<parent>-fork-<n>` with the lowest free n; a detached parent gets `fork-<suffix>`. */
export function forkBranchName(
  parentBranch: string | null,
  existing: ReadonlyArray<string>,
  detachedSuffix: string,
): string {
  if (parentBranch === null) return `fork-${detachedSuffix}`;
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`${parentBranch}-fork-${n}`)) n++;
  return `${parentBranch}-fork-${n}`;
}

const make = Effect.gen(function* () {
  const random = yield* SecureRandom.SecureRandom;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const checkpoints = yield* CheckpointStore.CheckpointStore;
  const setupScripts = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  // One fork at a time: retries and reused target ids never race, and branch numbering stays
  // unique across sources sharing a worktree.
  const forkLock = yield* Semaphore.make(1);

  const performFork = Effect.fn("ThreadForkWorkspaceService.performFork")(function* (
    input: ThreadForkWorkspaceInput,
  ) {
    const fail = (message: string, cause?: unknown) =>
      new OrchestrationV2ThreadForkError({
        sourceThreadId: input.sourceThreadId,
        targetThreadId: input.targetThreadId,
        message,
        ...(cause === undefined ? {} : { cause }),
      });
    const failWith = (prefix: string) =>
      Effect.mapError((cause: unknown) =>
        fail(`${prefix}: ${userFacingDispatchErrorMessage(cause) ?? String(cause)}`, cause),
      );
    const readThread = (threadId: ThreadId) =>
      threads
        .getThreadRecords(threadId, ["runs"])
        .pipe(
          Effect.asSome,
          Effect.catchTags({ OrchestratorProjectionError: () => Effect.succeedNone }),
          failWith(`Unable to read thread ${threadId}`),
        );

    const existing = yield* readThread(input.targetThreadId);
    if (Option.isSome(existing)) {
      const { thread } = existing.value;
      if (
        thread.lineage.parentThreadId !== input.sourceThreadId ||
        thread.lineage.relationshipToParent !== "fork"
      ) {
        return yield* fail(`Thread ${input.targetThreadId} already exists.`);
      }
      return { threadId: thread.id, worktreePath: thread.worktreePath, branch: thread.branch };
    }

    const source = yield* readThread(input.sourceThreadId);
    if (Option.isNone(source) || source.value.thread.deletedAt !== null) {
      return yield* fail(`Thread ${input.sourceThreadId} was not found.`);
    }
    const parent = source.value.thread;
    if (orchestrationV2WorktreePending(parent.worktreePath, source.value.runs)) {
      return yield* fail(
        `Thread ${input.sourceThreadId} has no worktree yet. Fork it once its worktree is set up.`,
      );
    }

    const dispatchFork = (workspace?: { readonly worktreePath: string; readonly branch: string }) =>
      threads
        .dispatch({
          type: "thread.fork",
          commandId: CommandId.make(`thread-fork-workspace:${input.targetThreadId}`),
          createdBy: input.createdBy,
          creationSource: input.creationSource,
          sourceThreadId: input.sourceThreadId,
          targetThreadId: input.targetThreadId,
          sourcePoint: { type: "latest_stable" },
          ...(input.title === undefined ? {} : { title: input.title }),
          ...workspace,
        })
        .pipe(failWith("Unable to fork the thread"));

    const parentWorktree = parent.worktreePath;
    if (parentWorktree === null) {
      yield* dispatchFork();
      return { threadId: input.targetThreadId, worktreePath: null, branch: parent.branch };
    }

    const project = yield* projects.getById(parent.projectId).pipe(
      failWith(`Unable to read project ${parent.projectId}`),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(fail(`Project ${parent.projectId} was not found.`)),
          onSome: Effect.succeed,
        }),
      ),
    );
    const runGit = (args: ReadonlyArray<string>) =>
      git
        .execute({ operation: "ThreadForkWorkspaceService.fork", cwd: parentWorktree, args })
        .pipe(failWith("Unable to read the thread's worktree"));

    // A checkpoint cannot carry a submodule's own edits; refuse rather than copy part of them.
    const status = yield* runGit(["status", "--porcelain=v2", "--ignore-submodules=none"]);
    if (
      status.stdout
        .split("\n")
        .some((line) => /^[12] /.test(line) && line.split(" ")[2]?.startsWith("S") === true)
    ) {
      return yield* fail(
        "The thread's worktree has uncommitted submodule changes. Commit or discard them, then fork again.",
      );
    }

    const head = (yield* runGit(["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
    const parentBranch = yield* gitWorkflow
      .currentBranch(parentWorktree)
      .pipe(failWith("Unable to read the thread's branch"));
    const id = yield* random.uuidV4().pipe(Effect.orDie);
    const captureRef = CheckpointRef.make(`refs/t3/fork-capture/${id}`);

    const forkWorktree = Effect.gen(function* () {
      yield* checkpoints
        .captureCheckpoint({ cwd: parentWorktree, checkpointRef: captureRef })
        .pipe(failWith("Unable to capture the thread's uncommitted changes"));
      // The copy must sit on the commit it was captured against.
      const headAfter = (yield* runGit(["rev-parse", "--verify", "HEAD^{commit}"])).stdout.trim();
      if (headAfter !== head) {
        return yield* fail("The thread's worktree moved to another commit. Fork again.");
      }
      const branchNames = yield* gitWorkflow
        .listLocalBranchNames(project.workspaceRoot)
        .pipe(failWith("Unable to list branches"));
      const branch = forkBranchName(parentBranch, branchNames, id.replaceAll("-", "").slice(0, 8));

      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const removeWorktree = (path: string) =>
            gitWorkflow.removeWorktree({ cwd: project.workspaceRoot, path, force: true }).pipe(
              Effect.andThen(
                gitWorkflow.deleteLocalBranch({
                  cwd: project.workspaceRoot,
                  refName: branch,
                  force: true,
                }),
              ),
              Effect.ignoreCause({ log: true }),
            );
          // A failed checkout hook leaves the worktree on our new branch; find it by that branch.
          const removeLeftoverWorktree = git
            .execute({
              operation: "ThreadForkWorkspaceService.fork",
              cwd: project.workspaceRoot,
              args: ["worktree", "list", "--porcelain", "-z"],
            })
            .pipe(
              Effect.flatMap(({ stdout }) => {
                const entry = stdout
                  .split("\0\0")
                  .map((block) => block.split("\0"))
                  .find((lines) => lines.includes(`branch refs/heads/${branch}`));
                const path = entry?.[0]?.replace(/^worktree /, "");
                return path === undefined
                  ? gitWorkflow.deleteLocalBranch({
                      cwd: project.workspaceRoot,
                      refName: branch,
                      force: true,
                    })
                  : removeWorktree(path);
              }),
              Effect.ignoreCause({ log: true }),
            );
          const created = yield* restore(
            gitWorkflow
              .createWorktree({
                cwd: project.workspaceRoot,
                refName: head,
                newRefName: branch,
                path: null,
              })
              .pipe(failWith("Unable to create the fork's worktree")),
          ).pipe(
            Effect.onError((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : removeLeftoverWorktree,
            ),
          );
          const worktreePath = created.worktree.path;
          const removeCreatedWorktree = removeWorktree(worktreePath);

          yield* Effect.gen(function* () {
            const restored = yield* checkpoints
              .restoreCheckpoint({ cwd: worktreePath, checkpointRef: captureRef })
              .pipe(failWith("Unable to copy uncommitted changes into the fork"));
            if (!restored) {
              return yield* fail("Unable to copy uncommitted changes into the fork.");
            }
            yield* dispatchFork({ worktreePath, branch: created.worktree.refName });
          }).pipe(
            // An interrupt alone may land after the fork committed, so keep its worktree.
            Effect.onError((cause) =>
              Cause.hasInterruptsOnly(cause) ? Effect.void : removeCreatedWorktree,
            ),
          );

          yield* setupScripts
            .runForThread({
              threadId: input.targetThreadId,
              projectId: project.id,
              projectCwd: project.workspaceRoot,
              worktreePath,
              project: {
                id: project.id,
                workspaceRoot: project.workspaceRoot,
                scripts: project.scripts,
              },
            })
            .pipe(Effect.ignoreCause({ log: true }), Effect.forkDetach);

          return {
            threadId: input.targetThreadId,
            worktreePath,
            branch: created.worktree.refName,
          };
        }),
      );
    });

    return yield* forkWorktree.pipe(
      Effect.ensuring(
        checkpoints
          .deleteCheckpointRefs({ cwd: parentWorktree, checkpointRefs: [captureRef] })
          .pipe(Effect.ignoreCause({ log: true })),
      ),
    );
  });

  const fork = Effect.fn("ThreadForkWorkspaceService.fork")(function* (
    input: ThreadForkWorkspaceInput,
  ) {
    return yield* forkLock.withPermits(1)(performFork(input));
  });

  return ThreadForkWorkspaceService.of({ fork });
});

export const layer = Layer.effect(ThreadForkWorkspaceService, make);
