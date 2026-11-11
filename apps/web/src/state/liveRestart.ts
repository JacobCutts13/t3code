import { useAtomValue } from "@effect/atom-react";
import type { DesktopLiveRestartState } from "@t3tools/contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";

import { desktopBridgeStateAtom } from "./desktopBridgeState";

const liveRestartStateAtom = desktopBridgeStateAtom<DesktopLiveRestartState>(
  "desktop:live-restart-state",
  (bridge) => ({ getState: bridge.getLiveRestartState, subscribe: bridge.onLiveRestartState }),
);

/** Built files waiting for a restart in `vp run live`; null everywhere else. */
export function useLiveRestartState(): DesktopLiveRestartState | null {
  return AsyncResult.getOrElse(useAtomValue(liveRestartStateAtom), () => null);
}
