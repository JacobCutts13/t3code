// @effect-diagnostics nodeBuiltinImport:off -- Runs two fixed macOS binaries and reads their stdout.
import * as NodeChildProcess from "node:child_process";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

class KeepAwakeError extends Schema.TaggedError<KeepAwakeError>()("KeepAwakeError", {
  message: Schema.String,
}) {}

/** A missing `SleepDisabled` line means sleep is allowed. */
export const parseSleepDisabled = (pmsetOutput: string): boolean =>
  /\bSleepDisabled\s+1\b/.test(pmsetOutput);

// Only `pmset disablesleep` stops lid-close sleep, and it needs root. A cancelled dialog (-128) is not an error.
export const setSleepDisabledArgs = (on: boolean): Array<string> => [
  "-e",
  `try\ndo shell script "/usr/bin/pmset -a disablesleep ${on ? 1 : 0}" with administrator privileges\non error number -128\nend try`,
];

const run = (command: string, args: Array<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) =>
        NodeChildProcess.execFile(command, args, (error, stdout, stderr) =>
          error ? reject(new Error(stderr.trim() || error.message)) : resolve(stdout),
        ),
      ),
    catch: (cause) => new KeepAwakeError({ message: (cause as Error).message }),
  });

const read = run("/usr/bin/pmset", ["-g"]).pipe(Effect.map(parseSleepDisabled));

export const installKeepAwake = Effect.fn("desktop.ipc.installKeepAwake")(function* () {
  if ((yield* HostProcess.Platform) !== "darwin") return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_GET_CHANNEL,
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: () => read,
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.KEEP_AWAKE_SET_CHANNEL,
      payload: Schema.Boolean,
      result: Schema.Boolean,
      handler: (on) =>
        run("/usr/bin/osascript", setSleepDisabledArgs(on)).pipe(Effect.andThen(read)),
    }),
  );
});
