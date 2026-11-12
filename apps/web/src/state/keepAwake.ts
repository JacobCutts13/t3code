import { useSyncExternalStore } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";

// null until the desktop app answers, and forever off macOS desktop.
let on: boolean | null = null;
let busy = false;
const listeners = new Set<() => void>();

const update = (next: boolean | null) => {
  on = next;
  for (const listener of listeners) listener();
};

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    window.desktopBridge?.getKeepAwake?.().then(update, () => update(null));
  }
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether `pmset disablesleep` is on; null off macOS desktop. */
export function useKeepAwake(): boolean | null {
  return useSyncExternalStore(subscribe, () => on);
}

export async function setKeepAwake(next: boolean): Promise<void> {
  const set = window.desktopBridge?.setKeepAwake;
  if (!set || busy) return;
  busy = true;
  try {
    update(await set(next));
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not change keep awake",
        description: error instanceof Error ? error.message : "pmset failed.",
      }),
    );
  } finally {
    busy = false;
  }
}
