import type { ProviderCloudEnvironmentSelection } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";

export interface CursorCloudRepository {
  readonly url: string;
  readonly startingRef?: string;
}

export interface CursorCloudRepositories {
  readonly repos: ReadonlyArray<CursorCloudRepository>;
  /** Changed files in the project checkout, which a cloud agent cannot see. */
  readonly uncommittedFiles: number;
  /** The project branch the agent starts from, once T3 made sure the remote has it. */
  readonly branch?: string;
}

export class CursorCloudStartError extends Schema.TaggedError<CursorCloudStartError>()(
  "CursorCloudStartError",
  {
    reason: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Cursor Cloud could not start this agent: ${this.reason}`;
  }
}

/** Cursor Cloud clones over HTTPS, so SSH remotes become their `https://host/owner/repo` form. */
export function cursorCloudRepositoryUrl(remoteUrl: string): string | undefined {
  const trimmed = remoteUrl.trim();
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(trimmed);
  let url: URL;
  try {
    url = new URL(scp === null ? trimmed : `https://${scp[1]}/${scp[2]}`);
  } catch {
    return undefined;
  }
  if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return undefined;
  const repoPath = url.pathname.replace(/\/+$/, "").replace(/\.git$/, "");
  if (repoPath.split("/").filter(Boolean).length < 2) return undefined;
  return `https://${url.hostname}${repoPath}`;
}

const sameRepository = (left: string, right: string) =>
  cursorCloudRepositoryUrl(left)?.toLowerCase() === cursorCloudRepositoryUrl(right)?.toLowerCase();

// A push from the server has no terminal, so a credential prompt would hang the thread's start.
const NON_INTERACTIVE_GIT_ENV = {
  GCM_INTERACTIVE: "never",
  GIT_ASKPASS: "",
  GIT_TERMINAL_PROMPT: "0",
  SSH_ASKPASS: "",
  SSH_ASKPASS_REQUIRE: "never",
};

const git = (cwd: string, args: ReadonlyArray<string>) =>
  spawnAndCollect(
    "git",
    ChildProcess.make("git", args, { cwd, env: NON_INTERACTIVE_GIT_ENV, extendEnv: true }),
  ).pipe(
    Effect.map((result) => ({
      ok: result.code === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    })),
    Effect.orElseSucceed(() => ({ ok: false, stdout: "", stderr: "" })),
  );

/**
 * The environment's repositories, starting the project's own repository from its current branch.
 * Like Cursor's CLI handoff, commits the remote lacks are pushed first so the agent sees them.
 */
export const prepareCursorCloudRepositories = Effect.fn("prepareCursorCloudRepositories")(
  function* (cwd: string, environment: ProviderCloudEnvironmentSelection) {
    if (environment.repos.length === 0) {
      return yield* new CursorCloudStartError({
        reason: "the selected Cursor Cloud environment has no repositories.",
      });
    }
    const [remote, symbolicBranch, status] = yield* Effect.all(
      [
        git(cwd, ["remote", "get-url", "origin"]),
        git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]),
        git(cwd, ["status", "--porcelain"]),
      ],
      { concurrency: "unbounded" },
    );
    const uncommittedFiles = status.ok
      ? status.stdout.split("\n").filter((line) => line.length > 0).length
      : 0;
    const branch = symbolicBranch.ok && symbolicBranch.stdout ? symbolicBranch.stdout : undefined;
    const projectRepo = remote.ok
      ? environment.repos.find((repo) => sameRepository(repo, remote.stdout))
      : undefined;
    // A detached HEAD or a project outside the environment starts every repo from its default.
    if (projectRepo === undefined || branch === undefined) {
      return {
        repos: environment.repos.map((url) => ({ url })),
        uncommittedFiles,
      } satisfies CursorCloudRepositories;
    }

    // The tracking ref only lags the remote, so containing HEAD there means the remote has it too.
    const remoteHasHead = (yield* git(cwd, [
      "merge-base",
      "--is-ancestor",
      "HEAD",
      `refs/remotes/origin/${branch}`,
    ])).ok;
    if (!remoteHasHead) {
      const pushed = yield* git(cwd, ["push", "origin", `HEAD:refs/heads/${branch}`]);
      if (!pushed.ok) {
        const detail = pushed.stderr.split("\n").find((line) => line.trim().length > 0);
        return yield* new CursorCloudStartError({
          reason: `T3 Code could not push ${branch} to origin, so the cloud agent would not see its commits.${detail ? ` ${detail.trim()}` : ""}`,
        });
      }
    }
    return {
      repos: environment.repos.map((url) =>
        url === projectRepo ? { url, startingRef: branch } : { url },
      ),
      uncommittedFiles,
      branch,
    } satisfies CursorCloudRepositories;
  },
  Effect.scoped,
);
