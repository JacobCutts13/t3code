import type { EnvironmentId } from "@t3tools/contracts";
import { useSyncExternalStore } from "react";

export interface CreateProjectFromReposTarget {
  readonly environmentId: EnvironmentId;
}

let target: CreateProjectFromReposTarget | null = null;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function openCreateProjectFromRepos(next: CreateProjectFromReposTarget): void {
  target = next;
  emit();
}

export function closeCreateProjectFromRepos(): void {
  if (target === null) return;
  target = null;
  emit();
}

export function useCreateProjectFromReposTarget(): CreateProjectFromReposTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => target,
    () => null,
  );
}
