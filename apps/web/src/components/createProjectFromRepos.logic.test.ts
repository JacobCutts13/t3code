import type { FilesystemEntryMetadata } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type RepoCandidate,
  type RepoScanner,
  defaultProjectName,
  filterRepos,
  repoDisabledReason,
  scanRepos,
  toggleRepo,
} from "./createProjectFromRepos.logic";

const folder = (path: string): RepoCandidate => ({ name: path.split("/").pop()!, path });

/** A fake disk: folders map to their child folder names; `gits` maps a folder to what its `.git` is. */
function fakeDisk(
  tree: Record<string, ReadonlyArray<string>>,
  gits: Record<string, "directory" | "file">,
): RepoScanner & { listed: string[] } {
  const listed: string[] = [];
  return {
    listed,
    listFolders: async (path) => {
      listed.push(path);
      return (tree[path] ?? []).map((name) => folder(`${path}/${name}`));
    },
    stat: async (paths) =>
      paths.map((path): FilesystemEntryMetadata | null => {
        const kind = gits[path.replace(/\/\.git$/, "")];
        return kind === undefined ? null : { kind };
      }),
  };
}

describe("scanRepos", () => {
  it("finds clones directly under the root and one folder deeper, sorted by name", async () => {
    const disk = fakeDisk(
      { "~/dev": ["zeta", "plain", "notes"], "~/dev/plain": ["services", "support-app"] },
      {
        "~/dev/zeta": "directory",
        "~/dev/plain/services": "directory",
        "~/dev/plain/support-app": "directory",
      },
    );
    const repos = await scanRepos(disk);
    expect(repos.map((repo) => repo.name)).toEqual(["services", "support-app", "zeta"]);
  });

  it("does not descend into a clone, and skips linked worktrees (.git is a file)", async () => {
    const disk = fakeDisk(
      { "~/dev": ["app", "app-feature"], "~/dev/app": ["inner"], "~/dev/app-feature": [] },
      { "~/dev/app": "directory", "~/dev/app-feature": "file" },
    );
    const repos = await scanRepos(disk);
    expect(repos.map((repo) => repo.name)).toEqual(["app"]);
    expect(disk.listed).not.toContain("~/dev/app");
  });

  it("ignores hidden and build folders, stops at the scan depth, and tolerates an empty or missing root", async () => {
    const disk = fakeDisk(
      { "~/dev": [".cache", "node_modules", "a"], "~/dev/a": ["b"], "~/dev/a/b": ["deep"] },
      { "~/dev/a/b": "directory", "~/dev/a/b/deep": "directory", "~/dev/.cache": "directory" },
    );
    expect((await scanRepos(disk)).map((repo) => repo.name)).toEqual(["b"]);
    expect(await scanRepos(fakeDisk({}, {}))).toEqual([]);
  });

  it("checks more than one batch of folders", async () => {
    const names = Array.from({ length: 150 }, (_, index) => `r${String(index).padStart(3, "0")}`);
    const gits = Object.fromEntries(names.map((name) => [`~/dev/${name}`, "directory" as const]));
    expect(await scanRepos(fakeDisk({ "~/dev": names }, gits))).toHaveLength(150);
  });
});

describe("selection", () => {
  const api = folder("~/dev/acme/api");
  const web = folder("~/dev/acme/web");
  const otherApi = folder("~/dev/other/API");

  it("filters by name or path, ignoring case", () => {
    expect(filterRepos([api, web], "WEB")).toEqual([web]);
    expect(filterRepos([api, web], "acme")).toEqual([api, web]);
    expect(filterRepos([api, web], "  ")).toEqual([api, web]);
  });

  it("disables a repo whose folder name matches a selected one, ignoring case", () => {
    expect(repoDisabledReason(otherApi, [api])).toMatch(/already selected/);
    expect(repoDisabledReason(web, [api])).toBeNull();
    expect(toggleRepo([api], otherApi)).toEqual([api]);
  });

  it("toggles a selected repo off, and always allows the first pick", () => {
    expect(toggleRepo([api, web], api)).toEqual([web]);
    expect(toggleRepo([], folder("~/dev/my repo"))).toHaveLength(1);
  });

  it("does not combine a repo whose name cannot be a folder name inside the thread", () => {
    const spaced = folder("~/dev/my repo");
    expect(repoDisabledReason(web, [spaced])).toMatch(/can't be combined/);
    expect(repoDisabledReason(spaced, [web])).toMatch(/can't be combined/);
  });

  it("names a multi-repo project from its repos", () => {
    expect(defaultProjectName([api, web])).toBe("api-web");
  });
});
