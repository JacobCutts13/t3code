import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** Names become folder names inside a thread's worktree, so keep them to a safe, portable set. */
const NESTED_REPO_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const NESTED_REPO_MAX_COUNT = 20;

export const isValidNestedRepoName = (name: string): boolean => NESTED_REPO_NAME_PATTERN.test(name);

/** A git repository that every new worktree thread of a project also gets a worktree of. */
export const ProjectNestedRepo = Schema.Struct({
  /** Folder name inside the thread's worktree. */
  name: Schema.String.check(Schema.isPattern(NESTED_REPO_NAME_PATTERN)),
  /** Existing clone on the environment; a leading `~` is the home folder. */
  path: TrimmedNonEmptyString,
  /** Ref the worktree starts from; defaults to the first of origin/main, origin/master, main, master, HEAD the clone has. */
  base: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ProjectNestedRepo = typeof ProjectNestedRepo.Type;

export const ProjectNestedRepos = Schema.Array(ProjectNestedRepo).check(
  Schema.isMaxLength(NESTED_REPO_MAX_COUNT),
  Schema.makeFilter((entries) => {
    // Case-insensitive: the default macOS file system treats Api and api as one folder.
    const names = entries.map((entry) => entry.name.toLowerCase());
    return new Set(names).size === names.length ? true : "Repository names must be unique.";
  }),
);
export type ProjectNestedRepos = typeof ProjectNestedRepos.Type;
