// @effect-diagnostics nodeBuiltinImport:off -- FileSystem has no stat-based watch, and the watched file is replaced by rename.
import * as NodeFS from "node:fs";

import { DesktopLiveRestartStateSchema, type DesktopLiveRestartState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { trimmedString } from "../../app/DesktopConfig.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const decodeStateFile = Schema.decodeUnknownOption(
  Schema.fromJsonString(DesktopLiveRestartStateSchema),
);

const NOTHING_PENDING: DesktopLiveRestartState = { changed: [] };

// scripts/dev-electron.mjs writes this file in `vp run live`; it is the only one who knows what Electron loaded.
function readStateFile(stateFile: string): DesktopLiveRestartState | null {
  if (!NodeFS.existsSync(stateFile)) return NOTHING_PENDING;
  try {
    return Option.getOrNull(decodeStateFile(NodeFS.readFileSync(stateFile, "utf8")));
  } catch {
    return null;
  }
}

export const installLiveRestart = Effect.fn("desktop.ipc.installLiveRestart")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  const electronWindow = yield* ElectronWindow.ElectronWindow;
  const runFork = Effect.runForkWith(yield* Effect.context());
  const stateFile = Option.getOrUndefined(yield* trimmedString("T3CODE_DESKTOP_LIVE_STATE_FILE"));
  const read = (file: string) => {
    const decoded = readStateFile(file);
    if (decoded !== null) return decoded;
    runFork(Effect.logWarning("live restart state file is unreadable", { stateFile: file }));
    return NOTHING_PENDING;
  };
  let state = stateFile === undefined ? null : read(stateFile);

  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.LIVE_RESTART_GET_STATE_CHANNEL,
      payload: Schema.Void,
      result: Schema.NullOr(DesktopLiveRestartStateSchema),
      handler: () => Effect.sync(() => state),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: IpcChannels.LIVE_RESTART_CHANNEL,
      payload: Schema.Void,
      result: Schema.Void,
      handler: Effect.fn("desktop.ipc.liveRestart.restart")(function* () {
        if (state === null) return;
        const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
        yield* lifecycle.relaunch("live code changed");
      }),
    }),
  );

  if (stateFile === undefined) return;
  NodeFS.watchFile(stateFile, { interval: 500 }, () => {
    state = read(stateFile);
    runFork(electronWindow.sendAll(IpcChannels.LIVE_RESTART_STATE_CHANNEL, state));
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => NodeFS.unwatchFile(stateFile)));
});
