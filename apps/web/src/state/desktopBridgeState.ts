import type { DesktopBridge } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

/** A state the desktop main process owns: read once, then follow its pushes. Null without it. */
export function desktopBridgeStateAtom<T>(
  label: string,
  methods: (bridge: DesktopBridge) => {
    readonly getState: (() => Promise<T | null>) | undefined;
    readonly subscribe: ((listener: (state: T) => void) => () => void) | undefined;
  },
) {
  const states = Stream.callback<T | null>((queue) =>
    Effect.gen(function* () {
      const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
      const { getState, subscribe } = bridge
        ? methods(bridge)
        : { getState: undefined, subscribe: undefined };
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
  return Atom.make(states, { initialValue: null }).pipe(Atom.keepAlive, Atom.withLabel(label));
}
