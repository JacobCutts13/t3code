import type { FilesystemEntryMetadata } from "@t3tools/contracts";

/** Folders searched for clones, relative to the home folder of the machine that hosts the project. */
const REPO_SCAN_ROOT = "~/dev";
const REPO_SCAN_DEPTH = 2;
const REPO_SCAN_CONCURRENCY = 8;
/** Matches FILESYSTEM_METADATA_BATCH_LIMIT. */
const METADATA_BATCH = 64;
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", "dist", "build", "target"]);

export interface RepoCandidate {
  readonly name: string;
  readonly path: string;
}

export interface RepoScanner {
  /** Child folders of `path`; must tolerate a missing or unreadable folder by returning []. */
  readonly listFolders: (path: string) => Promise<ReadonlyArray<RepoCandidate>>;
  /** Metadata per path in request order; null for missing or unreadable. */
  readonly stat: (
    paths: ReadonlyArray<string>,
  ) => Promise<ReadonlyArray<FilesystemEntryMetadata | null>>;
}

const trimSlash = (value: string) => value.replace(/\/+$/, "");

async function findGitClones(
  scanner: RepoScanner,
  folders: ReadonlyArray<RepoCandidate>,
): Promise<{ repos: RepoCandidate[]; plain: RepoCandidate[] }> {
  const repos: RepoCandidate[] = [];
  const plain: RepoCandidate[] = [];
  for (let start = 0; start < folders.length; start += METADATA_BATCH) {
    const batch = folders.slice(start, start + METADATA_BATCH);
    const stats = await scanner.stat(batch.map((folder) => `${trimSlash(folder.path)}/.git`));
    batch.forEach((folder, index) => {
      // A `.git` folder is a clone; a `.git` file is a linked worktree, which is not a repo to pick.
      const kind = stats[index]?.kind;
      if (kind === "directory") repos.push(folder);
      else if (kind !== "file") plain.push(folder);
    });
  }
  return { repos, plain };
}

/** Finds git clones under the scan root, looking inside non-repo folders down to the scan depth. */
export async function scanRepos(
  scanner: RepoScanner,
  root: string = REPO_SCAN_ROOT,
): Promise<ReadonlyArray<RepoCandidate>> {
  const found = new Map<string, RepoCandidate>();
  let level = (await scanner.listFolders(root)).filter(isScannable);
  for (let depth = 1; depth <= REPO_SCAN_DEPTH && level.length > 0; depth++) {
    const { repos, plain } = await findGitClones(scanner, level);
    for (const repo of repos) found.set(repo.path, repo);
    if (depth === REPO_SCAN_DEPTH) break;
    level = [];
    for (let start = 0; start < plain.length; start += REPO_SCAN_CONCURRENCY) {
      const children = await Promise.all(
        plain
          .slice(start, start + REPO_SCAN_CONCURRENCY)
          .map((folder) => scanner.listFolders(folder.path)),
      );
      for (const list of children) level.push(...list.filter(isScannable));
    }
  }
  return [...found.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

function isScannable(folder: RepoCandidate): boolean {
  return !folder.name.startsWith(".") && !SKIPPED_FOLDERS.has(folder.name);
}

export function filterRepos(
  repos: ReadonlyArray<RepoCandidate>,
  query: string,
): ReadonlyArray<RepoCandidate> {
  const needle = query.trim().toLowerCase();
  if (needle === "") return repos;
  return repos.filter(
    (repo) => repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle),
  );
}

/** Why a repo cannot join the current selection, or null. Folder names must be unique, ignoring case. */
export function repoDisabledReason(
  repo: RepoCandidate,
  selected: ReadonlyArray<RepoCandidate>,
): string | null {
  if (selected.some((entry) => entry.path === repo.path)) return null;
  if (selected.length === 0) return null;
  // Several repos share one project, so each name becomes a folder inside every thread's worktree.
  const unusable = [repo, ...selected].find((entry) => !isValidNestedRepoName(entry.name));
  if (unusable !== undefined)
    return `${unusable.name} can't be combined with other repositories: its folder name has characters that aren't allowed.`;
  const clash = selected.find((entry) => entry.name.toLowerCase() === repo.name.toLowerCase());
  return clash === undefined
    ? null
    : `A repository named ${clash.name} is already selected; both would use the same folder.`;
}

/** Whether a repo name works as a folder name inside a thread's worktree (see ProjectNestedRepo). */
function isValidNestedRepoName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);
}

export function defaultProjectName(repos: ReadonlyArray<RepoCandidate>): string {
  return repos.map((repo) => repo.name).join("-");
}

export function toggleRepo(
  selected: ReadonlyArray<RepoCandidate>,
  repo: RepoCandidate,
): ReadonlyArray<RepoCandidate> {
  if (selected.some((entry) => entry.path === repo.path)) {
    return selected.filter((entry) => entry.path !== repo.path);
  }
  return repoDisabledReason(repo, selected) === null ? [...selected, repo] : selected;
}
