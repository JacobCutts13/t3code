import type { ProjectNestedRepo } from "@t3tools/contracts";
import { expandHomePath } from "@t3tools/provider-core/server/pathExpansion";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import type * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import type * as GitWorkflow from "../git/GitWorkflowService.ts";

type Git = GitWorkflow.GitWorkflowService["Service"];

/** Tried in order when a repo has no explicit base: common remote names, then local ones, then the checkout. */
const DEFAULT_BASE_CANDIDATES = ["origin/main", "origin/master", "main", "master", "HEAD"] as const;
const ENV_FILE_PREFIX = ".env";
const ENV_SCAN_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set(["node_modules", ".git"]);
const ENV_SCAN_MAX_DEPTH = 8;

export class NestedRepoWorktreeError extends Schema.TaggedError<NestedRepoWorktreeError>()(
  "NestedRepoWorktreeError",
  { repo: Schema.String, detail: Schema.String },
) {
  override get message(): string {
    return `Repository "${this.repo}": ${this.detail}`;
  }
}

/** A worktree this launch added to a source clone, kept so a failed or cancelled launch can undo it. */
export interface CreatedNestedWorktree {
  readonly repoPath: string;
  readonly path: string;
  branch: string;
}

const detailOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** The first candidate that exists in the clone, so a repo without `origin/main` still gets a base. */
const resolveDefaultBase = Effect.fn("NestedRepoWorktrees.defaultBase")(function* (
  git: Git,
  repoPath: string,
) {
  for (const candidate of DEFAULT_BASE_CANDIDATES) {
    if (yield* git.hasCommit({ cwd: repoPath, refName: candidate })) return candidate;
  }
  return yield* new NestedRepoWorktreeError({
    repo: repoPath,
    detail: "has no commits to start a worktree from.",
  });
});

/**
 * Keeps the nested checkouts out of the container's `git status`. Without this they read as untracked
 * files, and storage cleanup keeps every thread as having uncommitted work. The exclude file is shared
 * by all worktrees of the container, so the lines are added once and left alone afterwards.
 */
const excludeNestedFolders = Effect.fn("NestedRepoWorktrees.exclude")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  worktreePath: string,
  names: ReadonlyArray<string>,
) {
  // A worktree's `.git` is a file: "gitdir: <common>/.git/worktrees/<id>", whose `commondir` points back.
  const pointer = yield* fs.readFileString(path.join(worktreePath, ".git"));
  const gitDir = path.resolve(worktreePath, pointer.trim().replace(/^gitdir:\s*/, ""));
  const commonDir = path.resolve(
    gitDir,
    (yield* fs.readFileString(path.join(gitDir, "commondir"))).trim(),
  );
  const excludePath = path.join(commonDir, "info", "exclude");
  const existing = yield* fs.readFileString(excludePath).pipe(Effect.orElseSucceed(() => ""));
  const have = new Set(existing.split("\n").map((line) => line.trim()));
  const missing = names.map((name) => `/${name}/`).filter((line) => !have.has(line));
  if (missing.length === 0) return;
  yield* fs.makeDirectory(path.dirname(excludePath), { recursive: true });
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  // Append, never rewrite: threads launching together share this file, and a rewrite could drop a line.
  yield* fs.writeFileString(excludePath, `${separator}${missing.join("\n")}\n`, { flag: "a" });
});

/**
 * Adds one worktree per repo under `worktreePath/<name>` on `branch`, each started from its base.
 * Sequential and all-or-nothing: the caller removes everything reported through `onCreated` on failure.
 */
export const addNestedRepoWorktrees = Effect.fn("NestedRepoWorktrees.add")(function* (input: {
  readonly git: Git;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly home: string;
  readonly repos: ReadonlyArray<ProjectNestedRepo>;
  readonly worktreePath: string;
  readonly branch: string;
  /** Follows the project's "start from remote" setting: fetch the base before branching from it. */
  readonly startFromOrigin: boolean;
  readonly onCreated: (created: CreatedNestedWorktree) => Effect.Effect<void>;
  readonly onRepo?: (name: string) => Effect.Effect<void>;
}) {
  const { git, fs, path, home } = input;

  // Best effort: the thread still works without it, it only reads as having uncommitted changes.
  yield* excludeNestedFolders(
    fs,
    path,
    input.worktreePath,
    input.repos.map((repo) => repo.name),
  ).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not exclude nested repo folders from the container", { cause }),
    ),
  );

  for (const repo of input.repos) {
    const fail = (cause: unknown) =>
      new NestedRepoWorktreeError({ repo: repo.name, detail: detailOf(cause) });
    if (input.onRepo) yield* input.onRepo(repo.name);

    const repoPath = path.resolve(expandHomePath(repo.path, home));
    const repoRoot = yield* git.repositoryRoot(repoPath).pipe(Effect.mapError(fail));
    if (repoRoot === null) return yield* fail(`${repo.path} is not a git repository.`);

    const base =
      repo.base ?? (yield* resolveDefaultBase(git, repoPath).pipe(Effect.mapError(fail)));
    let startRef = base;
    let baseRefName = base;
    if (input.startFromOrigin) {
      const remote = yield* git
        .resolveWorktreeBaseRemote({ cwd: repoPath, refName: base })
        .pipe(Effect.mapError(fail));
      if (remote !== null) {
        const fetched = yield* git
          .fetchWorktreeBaseCommit({ cwd: repoPath, refName: base, remote })
          .pipe(Effect.mapError(fail));
        if (fetched !== null) {
          startRef = fetched.commitSha;
          baseRefName = `refs/remotes/${fetched.remoteRefName}`;
        }
      }
    }

    const destination = path.join(input.worktreePath, repo.name);
    const created = yield* git
      .createWorktree(
        {
          cwd: repoPath,
          refName: startRef,
          newRefName: input.branch,
          baseRefName,
          path: destination,
        },
        {
          progress: {
            onWorktreeClaimed: (claimedPath) =>
              input.onCreated({ repoPath, path: claimedPath, branch: input.branch }),
          },
        },
      )
      .pipe(Effect.mapError(fail));

    // Best effort: a missing .env file must not fail the thread.
    yield* copyEnvFiles(fs, path, repoPath, created.worktree.path, 0).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not copy .env files into a nested worktree", {
          repo: repo.name,
          cause,
        }),
      ),
    );
  }
});

/** True for a symlink, including a dangling one; false for anything else, including a missing path. */
const isSymbolicLink = (fs: FileSystem.FileSystem, target: string) =>
  fs.readLink(target).pipe(
    Effect.as(true),
    Effect.catchIf(
      (error) =>
        error.cause instanceof Error &&
        "code" in error.cause &&
        (error.cause.code === "EINVAL" || error.cause.code === "ENOENT"),
      () => Effect.succeed(false),
    ),
  );

/** Copies untracked `.env*` files from the source clone; files the checkout already has are left alone. */
const copyEnvFiles = Effect.fn("NestedRepoWorktrees.copyEnvFiles")(function* (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  source: string,
  destination: string,
  depth: number,
): Effect.fn.Return<void, PlatformError.PlatformError> {
  for (const name of yield* fs.readDirectory(source)) {
    if (ENV_SCAN_SKIPPED_DIRECTORIES.has(name)) continue;
    const from = path.join(source, name);
    const to = path.join(destination, name);
    // Effect's stat follows links: a source link could point outside the clone or loop, and a link in
    // the new worktree (a committed symlink) would carry the copy out of it.
    if ((yield* isSymbolicLink(fs, from)) || (yield* isSymbolicLink(fs, to))) continue;
    const info = yield* fs.stat(from);
    if (info.type === "Directory") {
      if (depth < ENV_SCAN_MAX_DEPTH) yield* copyEnvFiles(fs, path, from, to, depth + 1);
    } else if (info.type === "File" && name.startsWith(ENV_FILE_PREFIX)) {
      if (yield* fs.exists(to)) continue;
      yield* fs.makeDirectory(destination, { recursive: true });
      yield* fs.copyFile(from, to);
    }
  }
});

/** Gives the nested branches the container's renamed branch name; failures leave the old name. */
export const renameNestedBranches = Effect.fn("NestedRepoWorktrees.rename")(function* (input: {
  readonly git: Git;
  readonly created: ReadonlyArray<CreatedNestedWorktree>;
  readonly oldBranch: string;
  readonly newBranch: string;
}) {
  for (const nested of input.created) {
    if (nested.branch !== input.oldBranch) continue;
    yield* input.git
      .renameBranch({
        cwd: nested.path,
        oldBranch: input.oldBranch,
        newBranch: input.newBranch,
        exactName: true,
      })
      .pipe(
        Effect.tap((renamed) =>
          Effect.sync(() => {
            nested.branch = renamed.branch;
          }),
        ),
        // A cancel must see the renamed branch, or its cleanup deletes the old name.
        Effect.uninterruptible,
        Effect.catchCause((cause) =>
          Effect.logWarning("Nested worktree branch rename failed", { path: nested.path, cause }),
        ),
      );
  }
});

/** Undoes `addNestedRepoWorktrees`: removes each worktree from its source clone and drops its new branch. */
export const removeNestedWorktrees = Effect.fn("NestedRepoWorktrees.remove")(function* (input: {
  readonly git: Git;
  readonly created: ReadonlyArray<CreatedNestedWorktree>;
}) {
  for (const nested of [...input.created].reverse()) {
    yield* input.git.removeWorktree({ cwd: nested.repoPath, path: nested.path, force: true }).pipe(
      Effect.andThen(
        input.git.deleteLocalBranch({ cwd: nested.repoPath, refName: nested.branch, force: true }),
      ),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not undo a nested worktree", { path: nested.path, cause }),
      ),
    );
  }
});
