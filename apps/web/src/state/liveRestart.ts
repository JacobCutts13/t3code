import { useAtomValue } from "@effect/atom-react";
import type { DesktopLiveRestartState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Atom } from "effect/reactivity";

const liveRestartStates = Stream.callback<DesktopLiveRestartState | null>((queue) =>
  Effect.gen(function* () {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const getState = bridge?.getLiveRestartState;
    const subscribe = bridge?.onLiveRestartState;
    // Vite can serve this code to an app whose preload predates it; that preload has no such methods.
    if (!getState || !subscribe) return yield* Effect.never;

    let received = false;
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        subscribe((state) => {
          received = true;
          Queue.offerUnsafe(queue, state);
        }),
      ),
      (unsubscribe) => Effect.sync(unsubscribe),
    );
    // The subscription still delivers every later change if this first read fails.
    const initial = yield* Effect.promise(() => getState().catch(() => null));
    if (!received) Queue.offerUnsafe(queue, initial);
    return yield* Effect.never;
  }),
);

const liveRestartStateAtom = Atom.make(liveRestartStates, { initialValue: null }).pipe(
  Atom.keepAlive,
  Atom.withLabel("desktop:live-restart-state"),
);

/** Built files waiting for a restart in `vp run live`; null everywhere else. */
export function useLiveRestartState(): DesktopLiveRestartState | null {
  return AsyncResult.getOrElse(useAtomValue(liveRestartStateAtom), () => null);
}
