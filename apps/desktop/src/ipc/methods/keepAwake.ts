import {
  DesktopKeepAwakeSetResultSchema,
  DesktopKeepAwakeStateSchema,
  type DesktopKeepAwakeSetResult,
  type DesktopKeepAwakeState,
} from "@t3tools/contracts";
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

export interface KeepAwakeRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export type KeepAwakeRun = (
  command: string,
  args: ReadonlyArray<string>,
) => Effect.Effect<KeepAwakeRunResult, KeepAwakeError>;

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

/** Owns the verified `pmset` state and the single in-flight privileged write. */
export const makeKeepAwake = (
  run: KeepAwakeRun,
  publish: (state: DesktopKeepAwakeState) => Effect.Effect<void>,
) => {
  let state: DesktopKeepAwakeState = { on: false, pending: false };

  const readOn = Effect.suspend(() => run(PMSET, ["-g"])).pipe(
    Effect.flatMap((result) =>
      result.exitCode === 0
        ? Effect.succeed(parseSleepDisabled(result.stdout))
        : Effect.fail(new KeepAwakeError({ message: result.stderr.trim() })),
    ),
    Effect.tapError((cause) => Effect.logWarning("Could not read pmset state", { cause })),
    Effect.orElseSucceed(() => state.on),
  );

  const commit = (next: DesktopKeepAwakeState) => {
    const changed = next.on !== state.on || next.pending !== state.pending;
    state = next;
    return changed ? publish(state) : Effect.void;
  };

  const refresh = Effect.gen(function* () {
    const on = yield* readOn;
    yield* commit({ ...state, on });
    return state;
  });

  const set = (on: boolean): Effect.Effect<DesktopKeepAwakeSetResult, KeepAwakeError> =>
    Effect.suspend(() => {
      if (state.pending) return Effect.succeed("busy" as const);
      // Set before the first yield so a second request cannot slip past the check.
      state = { ...state, pending: true };
      return publish(state).pipe(
        Effect.andThen(run(OSASCRIPT, setSleepDisabledArgs(on))),
        Effect.flatMap((result) =>
          result.exitCode === 0
            ? Effect.succeed<DesktopKeepAwakeSetResult>(
                result.stdout.trim() === "cancelled" ? "cancelled" : "ok",
              )
            : Effect.fail(
                new KeepAwakeError({
                  message: result.stderr.trim() || `osascript exited with ${result.exitCode}`,
                }),
              ),
        ),
        Effect.ensuring(
          Effect.gen(function* () {
            const verified = yield* readOn;
            yield* commit({ on: verified, pending: false });
          }),
        ),
      );
    });

  return { refresh, set };
};

export const installKeepAwake = Effect.fn("desktop.ipc.installKeepAwake")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  if ((yield* HostProcess.Platform) !== "darwin") {
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: IpcChannels.KEEP_AWAKE_GET_STATE_CHANNEL,
        payload: Schema.Void,
        result: Schema.Null,
        handler: () => Effect.succeed(null),
      }),
    );
    return;
  }
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
        return { stdout, stderr, exitCode: Number(exitCode) };
      }),
    ).pipe(Effect.mapError((cause) => new KeepAwakeError({ message: cause.message })));
  const keepAwake = makeKeepAwake(run, (state) =>
    electronWindow.sendAll(IpcChannels.KEEP_AWAKE_STATE_CHANNEL, state),
  );

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_GET_STATE_CHANNEL,
      payload: Schema.Void,
      result: Schema.NullOr(DesktopKeepAwakeStateSchema),
      handler: () => keepAwake.refresh,
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_SET_CHANNEL,
      payload: Schema.Boolean,
      result: DesktopKeepAwakeSetResultSchema,
      handler: keepAwake.set,
    }),
  );
  // Another tool (cockpit, a terminal) may have changed it while T3 was in the background.
  yield* app.on("browser-window-focus", () => runFork(keepAwake.refresh));
});
