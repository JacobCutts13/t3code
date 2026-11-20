import * as Effect from "effect/Effect";
import * as ChildProcess from "effect/process/ChildProcess";
import { spawnAndCollect } from "@t3tools/provider-core/server/snapshotProbe";

export interface CursorCloudRepository {
  readonly url: string;
  readonly startingRef?: string;
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

const git = (cwd: string, args: ReadonlyArray<string>) =>
  spawnAndCollect("git", ChildProcess.make("git", args, { cwd })).pipe(
    Effect.map((result) => (result.code === 0 ? result.stdout.trim() : "")),
    Effect.orElseSucceed(() => ""),
  );

export const resolveCursorCloudRepository = Effect.fn("resolveCursorCloudRepository")(function* (
  cwd: string,
) {
  const [remoteUrl, branch] = yield* Effect.all(
    [
      git(cwd, ["remote", "get-url", "origin"]),
      git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]),
    ],
    { concurrency: "unbounded" },
  );
  const url = cursorCloudRepositoryUrl(remoteUrl);
  if (url === undefined) return undefined;
  // A detached HEAD has no branch to start from; Cursor then uses the repository's default.
  return {
    url,
    ...(branch === "" ? {} : { startingRef: branch }),
  } satisfies CursorCloudRepository;
}, Effect.scoped);
