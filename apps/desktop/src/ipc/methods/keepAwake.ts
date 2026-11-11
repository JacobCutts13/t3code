import { DesktopKeepAwakeStateSchema, type DesktopKeepAwakeState } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export class KeepAwakeError extends Schema.TaggedError<KeepAwakeError>()("KeepAwakeError", {
  message: Schema.String,
}) {}

/** Resolves with stdout; fails with stderr on a non-zero exit. */
type KeepAwakeRun = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<string, KeepAwakeError>;

const PMSET = "/usr/bin/pmset";
const OSASCRIPT = "/usr/bin/osascript";

/** `pmset -g` prints `SleepDisabled` with tabs or spaces; a missing line means sleep is allowed. */
export const parseSleepDisabled = (pmsetOutput: string): boolean =>
  /\bSleepDisabled\s+1\b/.test(pmsetOutput);

// Cancelling the password dialog raises -128; catching it in-script tells it apart from other exit-1 failures.
export const setSleepDisabledArgs = (on: boolean): ReadonlyArray<string> => [
  "-e",
  [
    "try",
    `do shell script "${PMSET} -a disablesleep ${on ? 1 : 0}" with administrator privileges`,
    "on error number -128",
    'return "cancelled"',
    "end try",
  ].join("\n"),
];

/**
 * Owns the verified `pmset` state and the single in-flight privileged write. Electron's
 * powerSaveBlocker cannot stop lid-close sleep; only `pmset disablesleep` can, and it needs root.
 */
export const makeKeepAwake = (
  run: KeepAwakeRun,
  publish: (state: DesktopKeepAwakeState) => Effect.Effect<void>,
) => {
  let state: DesktopKeepAwakeState = { on: false, pending: false };

  const readOn = Effect.suspend(() => run(PMSET, ["-g"])).pipe(
    Effect.timeout("10 seconds"),
    Effect.map(parseSleepDisabled),
    Effect.tapError((cause) => Effect.logWarning("Could not read pmset state", { cause })),
    Effect.orElseSucceed(() => state.on),
  );

  const commit = (next: DesktopKeepAwakeState) => {
    const changed = next.on !== state.on || next.pending !== state.pending;
    state = next;
    return changed ? publish(state) : Effect.void;
  };

  let writes = 0;
  // A write verifies its own result; a read that overlapped one may be stale, so it is dropped.
  const refresh = Effect.suspend(() => {
    if (state.pending) return Effect.succeed(state);
    const startedAfter = writes;
    return readOn.pipe(
      Effect.flatMap((on) => (writes === startedAfter ? commit({ ...state, on }) : Effect.void)),
      Effect.map(() => state),
    );
  });

  // A cancelled dialog and a busy rejection both resolve; the pushed state tells the UI what happened.
  const set = (on: boolean): Effect.Effect<void, KeepAwakeError> =>
    Effect.suspend(() => {
      if (state.pending) return Effect.void;
      writes += 1;
      // commit assigns synchronously, so a second request cannot slip past the check above.
      return commit({ ...state, pending: true }).pipe(
        Effect.andThen(run(OSASCRIPT, setSleepDisabledArgs(on))),
        Effect.asVoid,
        Effect.ensuring(readOn.pipe(Effect.flatMap((on) => commit({ on, pending: false })))),
      );
    });

  return { refresh, set };
};

export const installKeepAwake = Effect.fn("desktop.ipc.installKeepAwake")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const runFork = Effect.runForkWith(yield* Effect.context());

  const run: KeepAwakeRun = (command, args) =>
    Effect.scoped(
      Effect.gen(function* () {
        const handle = yield* spawner.spawn(ChildProcess.make(command, args, { stdin: "ignore" }));
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
            handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
            handle.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        if (exitCode === 0) return stdout;
        return yield* new KeepAwakeError({
          message: stderr.trim() || `${command} exited with ${exitCode}`,
        });
      }),
    ).pipe(
      Effect.catchTags({
        PlatformError: (cause) => new KeepAwakeError({ message: cause.message }),
      }),
    );
  const keepAwake =
    (yield* HostProcess.Platform) === "darwin"
      ? makeKeepAwake(run, (state) =>
          electronWindow.sendAll(IpcChannels.KEEP_AWAKE_STATE_CHANNEL, state),
        )
      : null;

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_GET_STATE_CHANNEL,
      payload: Schema.Void,
      result: Schema.NullOr(DesktopKeepAwakeStateSchema),
      handler: () => keepAwake?.refresh ?? Effect.succeed(null),
    }),
  );
  if (keepAwake === null) return;
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_SET_CHANNEL,
      payload: Schema.Boolean,
      result: Schema.Void,
      handler: keepAwake.set,
    }),
  );
  // Another process may have changed it while T3 was in the background.
  yield* app.on("browser-window-focus", () => runFork(keepAwake.refresh));
});
