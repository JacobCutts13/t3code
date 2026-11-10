import {
  NESTED_REPO_MAX_COUNT,
  type ProjectNestedRepo,
  isValidNestedRepoName,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  useScopedSettings,
  useScopedSettingsWriteAllowed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** Extra repositories every new worktree thread of a project also gets a worktree of. */
export function ProjectRepositoriesSettings() {
  const { scope } = useSettingsScope();
  const repos = useScopedSettings((settings) => settings.nestedRepos);
  const updateScopedSettings = useUpdateScopedSettings();
  const canWriteSettings = useScopedSettingsWriteAllowed();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [base, setBase] = useState("");
  const [error, setError] = useState<string | null>(null);
  // As an environment default these would apply to every project, which is never what you want.
  if (scope.kind !== "project" && scope.kind !== "checkout") return null;

  const save = (next: ReadonlyArray<ProjectNestedRepo>) =>
    updateScopedSettings({ nestedRepos: [...next] });

  const add = () => {
    const entry: ProjectNestedRepo = {
      name: name.trim(),
      path: path.trim(),
      ...(base.trim() ? { base: base.trim() } : {}),
    };
    if (!isValidNestedRepoName(entry.name)) {
      setError("Use letters, numbers, dots, dashes or underscores for the folder name.");
    } else if (entry.path === "") {
      setError("Enter the path of the repository's clone.");
    } else if (repos.some((repo) => repo.name.toLowerCase() === entry.name.toLowerCase())) {
      setError("A repository with that folder name is already listed.");
    } else if (repos.length >= NESTED_REPO_MAX_COUNT) {
      setError(`At most ${NESTED_REPO_MAX_COUNT} repositories.`);
    } else {
      setError(null);
      void save([...repos, entry]);
      setName("");
      setPath("");
      setBase("");
    }
  };

  return (
    <SettingsSection id="project-repositories" title="Repositories">
      <SettingsRow
        serverScoped
        settingKeys={["nestedRepos"]}
        title="Repositories"
        description="Every new worktree thread also gets a worktree of each repository below, in its own folder inside the thread. Paths are clones on this machine."
        control={
          <span className="text-xs text-muted-foreground">
            {repos.length} {repos.length === 1 ? "repository" : "repositories"}
          </span>
        }
      >
        <div className="mt-2 pb-3.5">
          {repos.length > 0 ? (
            <ul aria-label="Repositories" className="mb-3 flex flex-col gap-1.5">
              {repos.map((repo) => (
                <li
                  key={repo.name}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 py-1 pl-2.5 pr-1 text-xs"
                >
                  <span className="font-medium">{repo.name}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    {repo.path}
                    {repo.base ? ` · ${repo.base}` : ""}
                  </span>
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost-muted"
                    disabled={!canWriteSettings}
                    aria-label={`Remove ${repo.name}`}
                    onClick={() => void save(repos.filter((entry) => entry.name !== repo.name))}
                  >
                    <XIcon />
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-start gap-1.5">
            <Input
              value={name}
              placeholder="Folder name"
              aria-label="Repository folder name"
              className="w-36"
              disabled={!canWriteSettings}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              value={path}
              placeholder="~/dev/my-repo"
              aria-label="Repository path"
              className="min-w-48 flex-1"
              disabled={!canWriteSettings}
              onChange={(event) => setPath(event.target.value)}
            />
            <Input
              value={base}
              placeholder="default branch"
              aria-label="Repository base branch"
              className="w-36"
              disabled={!canWriteSettings}
              onChange={(event) => setBase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                add();
              }}
            />
            <Button type="button" disabled={!canWriteSettings} onClick={add}>
              Add
            </Button>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}
