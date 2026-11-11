import { useAtomValue } from "@effect/atom-react";
import type { DesktopKeepAwakeState } from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { desktopBridgeStateAtom } from "./desktopBridgeState";

const keepAwakeStateAtom = desktopBridgeStateAtom<DesktopKeepAwakeState>(
  "desktop:keep-awake-state",
  (bridge) => ({ getState: bridge.getKeepAwakeState, subscribe: bridge.onKeepAwakeState }),
);

/** This Mac's keep-awake state; null off macOS desktop. */
export function useKeepAwakeState(): DesktopKeepAwakeState | null {
  return AsyncResult.getOrElse(useAtomValue(keepAwakeStateAtom), () => null);
}

export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    await window.desktopBridge?.setKeepAwake?.(on);
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not change keep awake",
        description: error instanceof Error ? error.message : "pmset failed.",
      }),
    );
  }
}
