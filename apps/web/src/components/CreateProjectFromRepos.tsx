import type { EnvironmentId } from "@t3tools/contracts";
import { FolderGit2Icon, FolderIcon, SearchIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useCreateProjectFromRepos } from "../hooks/useCreateProjectFromRepos";
import { useStableCallback } from "../hooks/useStableCallback";
import { filesystemEnvironment } from "../state/filesystem";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";
import {
  closeCreateProjectFromRepos,
  useCreateProjectFromReposTarget,
} from "./createProjectFromReposStore";
import {
  type RepoCandidate,
  defaultProjectName,
  filterRepos,
  repoDisabledReason,
  scanRepos,
  toggleRepo,
} from "./createProjectFromRepos.logic";
import { Button } from "./ui/button";
import { CheckboxMark } from "./ui/checkbox";
import { Dialog, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { ScrollArea } from "./ui/scroll-area";

type ScanState = "scanning" | "done" | "failed";

function RepoRow(props: {
  readonly repo: RepoCandidate;
  readonly checked: boolean;
  readonly disabledReason: string | null;
  readonly onToggle: () => void;
}) {
  const { repo, checked, disabledReason } = props;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabledReason !== null}
      aria-label={disabledReason === null ? repo.name : `${repo.name}. ${disabledReason}`}
      className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start outline-none hover:bg-accent focus-visible:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
      onClick={() => {
        if (disabledReason === null) props.onToggle();
      }}
    >
      <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm">{repo.name}</span>
        <span className="truncate text-muted-foreground text-xs">
          {disabledReason ?? repo.path}
        </span>
      </span>
      <CheckboxMark checked={checked} />
    </button>
  );
}

function CreateProjectFromReposBody(props: { readonly environmentId: EnvironmentId }) {
  const { environmentId } = props;
  const browse = useAtomQueryRunner(filesystemEnvironment.browse, {
    reportFailure: false,
    reportDefect: false,
  });
  const getMetadata = useAtomQueryRunner(filesystemEnvironment.getMetadata, {
    reportFailure: false,
    reportDefect: false,
  });
  const createFromRepos = useCreateProjectFromRepos();
  const [repos, setRepos] = useState<ReadonlyArray<RepoCandidate>>([]);
  const [scan, setScan] = useState<ScanState>("scanning");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlyArray<RepoCandidate>>([]);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const browseStable = useStableCallback(browse);
  const metadataStable = useStableCallback(getMetadata);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scans the machine's file system once per opening
  useEffect(() => {
    let cancelled = false;
    void scanRepos({
      listFolders: async (path) => {
        const result = await browseStable({
          environmentId,
          input: { partialPath: `${path.replace(/\/+$/, "")}/` },
        });
        return result._tag === "Success"
          ? result.value.entries.map((entry) => ({ name: entry.name, path: entry.fullPath }))
          : null;
      },
      stat: async (paths) => {
        const result = await metadataStable({ environmentId, input: { paths: [...paths] } });
        if (result._tag !== "Success") throw new Error("Could not read the file system.");
        return result.value.entries;
      },
    }).then(
      (found) => {
        if (cancelled) return;
        setRepos(found);
        setScan("done");
      },
      () => {
        if (!cancelled) setScan("failed");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [environmentId, browseStable, metadataStable]);

  const visible = filterRepos(repos, query).filter(
    (repo) => !selected.some((entry) => entry.path === repo.path),
  );
  const projectName = nameDraft ?? defaultProjectName(selected);
  const canSave =
    selected.length > 0 && !saving && (selected.length === 1 || projectName.trim() !== "");

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = await createFromRepos({
        environmentId,
        repos: selected,
        name: projectName.trim(),
      });
      if (created) closeCreateProjectFromRepos();
    } finally {
      setSaving(false);
    }
  };

  const saveStable = useStableCallback(save);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ⌘↵ must work from any focused row, which a container handler misses
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void saveStable();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saveStable]);

  return (
    <div className="flex max-h-[min(34rem,80vh)] flex-col">
      <DialogTitle className="sr-only">Create project from repositories</DialogTitle>
      <div className="flex items-center gap-2 border-b px-3.5 py-2.5">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          unstyled
          value={query}
          aria-label="Search repositories"
          placeholder="Search repositories…"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <ScrollArea className="min-h-40 flex-1">
        <div className="p-1.5" role="group" aria-label="Repositories">
          {selected.length > 0 ? (
            <>
              <div className="px-2.5 py-1.5 font-medium text-muted-foreground text-xs">
                Selected
              </div>
              {selected.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  checked
                  disabledReason={null}
                  onToggle={() => setSelected(toggleRepo(selected, repo))}
                />
              ))}
              <div className="mx-2.5 my-1.5 border-t" />
            </>
          ) : null}
          {visible.length > 0 || selected.length === 0 ? (
            <div className="px-2.5 py-1.5 font-medium text-muted-foreground text-xs">Repos</div>
          ) : null}
          {visible.map((repo) => (
            <RepoRow
              key={repo.path}
              repo={repo}
              checked={false}
              disabledReason={repoDisabledReason(repo, selected)}
              onToggle={() => setSelected(toggleRepo(selected, repo))}
            />
          ))}
          {scan === "scanning" ? (
            <p role="status" className="px-2.5 py-3 text-muted-foreground text-sm">
              Looking for repositories…
            </p>
          ) : scan === "failed" ? (
            <p role="alert" className="px-2.5 py-3 text-muted-foreground text-sm">
              Could not read your repositories folder.
            </p>
          ) : visible.length === 0 ? (
            <p className="px-2.5 py-3 text-muted-foreground text-sm">
              {repos.length === 0
                ? "No git repositories found in ~/dev."
                : selected.length > 0
                  ? "No other repositories match."
                  : "No repositories match."}
            </p>
          ) : null}
        </div>
      </ScrollArea>
      <div className="flex items-center gap-2 border-t px-3 py-2.5">
        {selected.length > 1 ? (
          <Input
            value={projectName}
            aria-label="Project name"
            placeholder="Project name"
            className="min-w-0 flex-1"
            onChange={(event) => setNameDraft(event.target.value)}
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground text-xs">
            <FolderGit2Icon className="size-3.5 shrink-0" />
            <span className="truncate">
              {selected.length === 0
                ? "Pick one repository, or several to work across them."
                : `Opens ${selected[0]!.name}`}
            </span>
          </span>
        )}
        <Button type="button" disabled={!canSave} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function CreateProjectFromRepos() {
  const target = useCreateProjectFromReposTarget();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeCreateProjectFromRepos();
      }}
    >
      {target === null ? null : (
        <DialogPopup showCloseButton={false} className="max-w-md">
          <CreateProjectFromReposBody environmentId={target.environmentId} />
        </DialogPopup>
      )}
    </Dialog>
  );
}
