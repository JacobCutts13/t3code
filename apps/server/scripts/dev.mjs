// `dev` for the server package. Desktop dev (T3CODE_SERVER_BUNDLE_WATCH=1) rebuilds dist/bin.mjs on every
// source change, because Electron runs the built server; every other dev mode runs the source directly.
import * as NodeChildProcess from "node:child_process";

const bundleWatch = process.env.T3CODE_SERVER_BUNDLE_WATCH === "1";
const [command, args] = bundleWatch
  ? ["vp", ["pack", "--watch", "--no-clean"]]
  : [
      process.execPath,
      [
        "--watch",
        "--watch-path=src",
        "--watch-path=../../packages",
        "--watch-path=package.json",
        "src/bin.ts",
      ],
    ];

const child = NodeChildProcess.spawn(command, args, {
  stdio: "inherit",
  // On Windows `vp` is a .cmd shim, which spawn only runs through a shell.
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone dev script has no Effect runtime.
  shell: process.platform === "win32",
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => process.exit(signal === null ? (code ?? 0) : 1));
