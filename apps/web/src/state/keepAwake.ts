import { useAtomValue } from "@effect/atom-react";
import type { DesktopKeepAwakeState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { Atom } from "effect/reactivity";

const keepAwakeStates = Stream.callback<DesktopKeepAwakeState | null>((queue) =>
  Effect.gen(function* () {
    const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
    const getState = bridge?.getKeepAwakeState;
    const subscribe = bridge?.onKeepAwakeState;
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
    const initial = yield* Effect.promise(() => getState().catch(() => null));
    if (!received) Queue.offerUnsafe(queue, initial);
    return yield* Effect.never;
  }),
);

const keepAwakeStateAtom = Atom.make(keepAwakeStates, { initialValue: null }).pipe(
  Atom.keepAlive,
  Atom.withLabel("desktop:keep-awake-state"),
);

/** This Mac's keep-awake state; null off macOS desktop. */
export function useKeepAwakeState(): DesktopKeepAwakeState | null {
  return AsyncResult.getOrElse(useAtomValue(keepAwakeStateAtom), () => null);
}
