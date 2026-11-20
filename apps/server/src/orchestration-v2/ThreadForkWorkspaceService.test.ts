// @effect-diagnostics nodeBuiltinImport:off
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type Project,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitManager from "../git/GitManager.ts";
import * as GitWorkflowService from "../git/GitWorkflowService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { OrchestratorProjectionError } from "./Orchestrator.ts";
import * as ThreadForkWorkspaceService from "./ThreadForkWorkspaceService.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";

const projectId = ProjectId.make("project:fork-workspace");
const sourceThreadId = ThreadId.make("thread:fork-workspace-source");
const targetThreadId = ThreadId.make("thread:fork-workspace-target");

const layerPlatform = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);
const layerGit = Layer.mergeAll(GitVcsDriver.layer, VcsDriverRegistry.layer).pipe(
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-fork-workspace-" }).pipe(
      Layer.provide(layerPlatform),
    ),
  ),
  Layer.provideMerge(layerPlatform),
);

interface Harness {
  readonly dispatched: Array<Extract<OrchestrationV2Command, { readonly type: "thread.fork" }>>;
  readonly threads: Map<ThreadId, OrchestrationV2ThreadProjection>;
}

const makeLayer = (
  harness: Harness,
  workspaceRoot: string,
  options: { readonly restoreFails?: boolean } = {},
) => {
  const threadManagement = Layer.mock(ThreadManagementService.ThreadManagementService)({
    getThreadRecords: (threadId) => {
      const projection = harness.threads.get(threadId);
      return projection === undefined
        ? Effect.fail(new OrchestratorProjectionError({ threadId }))
        : Effect.succeed(projection);
    },
    dispatch: (command) =>
      Effect.suspend(() => {
        if (command.type !== "thread.fork") return Effect.die("unexpected command");
        harness.dispatched.push(command);
        const source = harness.threads.get(command.sourceThreadId)!;
        harness.threads.set(command.targetThreadId, {
          ...source,
          thread: {
            ...source.thread,
            id: command.targetThreadId,
            worktreePath: command.worktreePath ?? source.thread.worktreePath,
            branch: command.branch ?? source.thread.branch,
            lineage: {
              parentThreadId: command.sourceThreadId,
              relationshipToParent: "fork",
              rootThreadId: command.sourceThreadId,
            },
          },
        });
        return Effect.succeed({ sequence: 1, storedEvents: [] });
      }),
  });
  const checkpointStore = Layer.effect(
    CheckpointStore.CheckpointStore,
    Effect.map(CheckpointStore.make, (store) =>
      options.restoreFails
        ? CheckpointStore.CheckpointStore.of({
            ...store,
            restoreCheckpoint: () => Effect.succeed(false),
          })
        : store,
    ),
  );
  const gitWorkflow = GitWorkflowService.layer.pipe(
    Layer.provide(
      Layer.effect(
        GitManager.GitManager,
        Effect.map(GitVcsDriver.GitVcsDriver, (driver) =>
          GitManager.GitManager.of({
            createWorktree: driver.createWorktree,
          } as unknown as GitManager.GitManager["Service"]),
        ),
      ),
    ),
  );
  return ThreadForkWorkspaceService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        threadManagement,
        checkpointStore,
        gitWorkflow,
        Layer.mock(ProjectService.ProjectService)({
          getById: () =>
            Effect.succeedSome({ id: projectId, workspaceRoot, scripts: [] } as unknown as Project),
        }),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" }),
        }),
      ),
    ),
    Layer.provide(layerGit),
  );
};

const git = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(GitVcsDriver.GitVcsDriver, (driver) =>
    driver.execute({ operation: "ThreadForkWorkspaceService.test", cwd, args }),
  ).pipe(Effect.map((result) => result.stdout.trim()));

/** A project checkout plus a thread worktree on `feature/x` with a modified and a new file. */
const setupRepo = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-fork-workspace-repo-" });
  const repo = NodePath.join(root, "repo");
  const parentWorktree = NodePath.join(root, "parent");
  yield* fs.makeDirectory(repo);
  yield* git(repo, ["init", "-b", "main"]);
  yield* git(repo, ["config", "user.email", "t@t"]);
  yield* git(repo, ["config", "user.name", "t"]);
  yield* fs.writeFileString(NodePath.join(repo, "tracked.txt"), "committed\n");
  yield* git(repo, ["add", "."]);
  yield* git(repo, ["commit", "-m", "init"]);
  yield* git(repo, ["worktree", "add", "-b", "feature/x", parentWorktree]);
  yield* fs.writeFileString(NodePath.join(parentWorktree, "tracked.txt"), "edited\n");
  yield* fs.writeFileString(NodePath.join(parentWorktree, "new.txt"), "untracked\n");
  return { repo, parentWorktree };
});

const sourceProjection = (worktreePath: string | null) =>
  ({
    thread: {
      id: sourceThreadId,
      projectId,
      title: "Source",
      branch: worktreePath === null ? "main" : "feature/x",
      worktreePath,
      deletedAt: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: sourceThreadId },
    },
    runs: [],
  }) as unknown as OrchestrationV2ThreadProjection;

const forkInput = {
  sourceThreadId,
  targetThreadId,
  createdBy: "user",
  creationSource: "web",
} as const;

const runFork = (harness: Harness, repo: string, options?: { readonly restoreFails?: boolean }) =>
  Effect.flatMap(ThreadForkWorkspaceService.ThreadForkWorkspaceService, (service) =>
    service.fork(forkInput),
  ).pipe(Effect.provide(makeLayer(harness, repo, options)));

const newHarness = (worktreePath: string | null): Harness => ({
  dispatched: [],
  threads: new Map([[sourceThreadId, sourceProjection(worktreePath)]]),
});

it.layer(layerGit)("ThreadForkWorkspaceService", (it) => {
  it.effect("forks a thread without a worktree into the same folder", () =>
    Effect.gen(function* () {
      const { repo } = yield* setupRepo;
      const harness = newHarness(null);
      const result = yield* runFork(harness, repo);

      assert.deepEqual(result, { threadId: targetThreadId, worktreePath: null, branch: "main" });
      assert.equal(harness.dispatched.length, 1);
      assert.notProperty(harness.dispatched[0], "worktreePath");
    }).pipe(Effect.scoped),
  );

  it.effect("copies uncommitted edits into a new worktree on the next free fork branch", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { repo, parentWorktree } = yield* setupRepo;
      yield* git(repo, ["branch", "feature/x-fork-1"]);
      const harness = newHarness(parentWorktree);
      const result = yield* runFork(harness, repo);

      assert.equal(result.branch, "feature/x-fork-2");
      const forkPath = result.worktreePath!;
      assert.notEqual(forkPath, parentWorktree);
      assert.equal(yield* fs.readFileString(NodePath.join(forkPath, "tracked.txt")), "edited\n");
      assert.equal(yield* fs.readFileString(NodePath.join(forkPath, "new.txt")), "untracked\n");
      assert.equal(
        yield* git(forkPath, ["rev-parse", "HEAD"]),
        yield* git(repo, ["rev-parse", "main"]),
      );
      assert.equal(yield* git(repo, ["for-each-ref", "refs/t3/fork-capture"]), "");
      assert.deepEqual(
        {
          worktreePath: harness.dispatched[0]?.worktreePath,
          branch: harness.dispatched[0]?.branch,
        },
        { worktreePath: forkPath, branch: "feature/x-fork-2" },
      );

      // A retry with the same target returns that fork instead of making another worktree.
      const retried = yield* runFork(harness, repo);
      assert.deepEqual(retried, result);
      assert.equal(harness.dispatched.length, 1);
      assert.equal(
        (yield* git(repo, ["worktree", "list", "--porcelain"])).match(/^worktree /gm)?.length,
        3,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("removes the new worktree and branch when the copy cannot be restored", () =>
    Effect.gen(function* () {
      const { repo, parentWorktree } = yield* setupRepo;
      const harness = newHarness(parentWorktree);
      const exit = yield* Effect.exit(runFork(harness, repo, { restoreFails: true }));

      assert.isTrue(Exit.isFailure(exit));
      assert.equal(harness.dispatched.length, 0);
      assert.equal(yield* git(repo, ["branch", "--list", "feature/x-fork-*"]), "");
      assert.equal(
        (yield* git(repo, ["worktree", "list", "--porcelain"])).match(/^worktree /gm)?.length,
        2,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("removes the new worktree and branch when its checkout hook fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { repo, parentWorktree } = yield* setupRepo;
      const hook = NodePath.join(repo, ".git", "hooks", "post-checkout");
      yield* fs.writeFileString(hook, "#!/bin/sh\nexit 1\n");
      yield* fs.chmod(hook, 0o755);
      const harness = newHarness(parentWorktree);
      const exit = yield* Effect.exit(runFork(harness, repo));

      assert.isTrue(Exit.isFailure(exit));
      assert.equal(harness.dispatched.length, 0);
      assert.equal(yield* git(repo, ["branch", "--list", "feature/x-fork-*"]), "");
      assert.equal(
        (yield* git(repo, ["worktree", "list", "--porcelain"])).match(/^worktree /gm)?.length,
        2,
      );
    }).pipe(Effect.scoped),
  );

  it.effect("refuses to fork a worktree with uncommitted submodule changes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { repo, parentWorktree } = yield* setupRepo;
      const sub = NodePath.join(NodePath.dirname(repo), "sub");
      yield* fs.makeDirectory(sub);
      yield* git(sub, ["init", "-b", "main"]);
      yield* git(sub, [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "commit",
        "--allow-empty",
        "-m",
        "s",
      ]);
      yield* git(parentWorktree, [
        "-c",
        "protocol.file.allow=always",
        "submodule",
        "add",
        sub,
        "sub",
      ]);
      yield* git(parentWorktree, ["commit", "-m", "add submodule"]);
      yield* fs.writeFileString(NodePath.join(parentWorktree, "sub", "dirty.txt"), "dirty\n");
      const harness = newHarness(parentWorktree);
      const exit = yield* Effect.exit(runFork(harness, repo));

      assert.isTrue(Exit.isFailure(exit));
      assert.match(String(Exit.isFailure(exit) && exit.cause), /submodule/);
      assert.equal(yield* git(repo, ["branch", "--list", "feature/x-fork-*"]), "");
    }).pipe(Effect.scoped),
  );
});

it("names forks of a detached thread from a fixed suffix", () => {
  assert.equal(ThreadForkWorkspaceService.forkBranchName(null, [], "abcd1234"), "fork-abcd1234");
  assert.equal(ThreadForkWorkspaceService.forkBranchName("b", ["b-fork-2"], "x"), "b-fork-1");
});
