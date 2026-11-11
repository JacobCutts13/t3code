import type { DesktopKeepAwakeState } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { describe, expect, vi } from "vite-plus/test";
import { it } from "@effect/vitest";

vi.mock("electron", () => ({}));

import {
  KeepAwakeError,
  makeKeepAwake,
  parseSleepDisabled,
  setSleepDisabledArgs,
  type KeepAwakeRunResult,
} from "./keepAwake.ts";

const PMSET_ON = " AutoPowerOff\t\t1\n SleepDisabled\t\t1\n sleep                1\n";
const PMSET_OFF = " AutoPowerOff\t\t1\n SleepDisabled        0\n";
const ok = (stdout: string): KeepAwakeRunResult => ({ stdout, stderr: "", exitCode: 0 });

// A fake Mac: pmset -g reports `sleepDisabled`; osascript answers with `write`.
const setup = (write: (on: boolean) => Effect.Effect<KeepAwakeRunResult, KeepAwakeError>) => {
  const machine = { sleepDisabled: false };
  const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const published: Array<DesktopKeepAwakeState> = [];
  const keepAwake = makeKeepAwake(
    (command, args) => {
      calls.push({ command, args });
      if (command === "/usr/bin/pmset") {
        return Effect.succeed(ok(machine.sleepDisabled ? PMSET_ON : PMSET_OFF));
      }
      return write(args[1]!.includes("disablesleep 1"));
    },
    (state) => Effect.sync(() => published.push(state)),
  );
  return { machine, calls, published, keepAwake };
};

describe("parseSleepDisabled", () => {
  it("reads tab- and space-separated values and treats a missing line as off", () => {
    expect(parseSleepDisabled(PMSET_ON)).toBe(true);
    expect(parseSleepDisabled(PMSET_OFF)).toBe(false);
    expect(parseSleepDisabled(" sleep 1\n displaysleep 10\n")).toBe(false);
  });
});

describe("makeKeepAwake", () => {
  it.effect("runs exactly osascript with a literal pmset command, then re-reads", () =>
    Effect.gen(function* () {
      const fake = setup((on) =>
        Effect.sync(() => {
          fake.machine.sleepDisabled = on;
          return ok("\n");
        }),
      );
      expect(yield* fake.keepAwake.set(true)).toBe("ok");
      expect(fake.calls[0]).toEqual({
        command: "/usr/bin/osascript",
        args: [
          "-e",
          'try\ndo shell script "/usr/bin/pmset -a disablesleep 1" with administrator privileges\non error number -128\nreturn "cancelled"\nend try',
        ],
      });
      expect(fake.calls[1]).toEqual({ command: "/usr/bin/pmset", args: ["-g"] });
      expect(setSleepDisabledArgs(false)[1]).toContain('"/usr/bin/pmset -a disablesleep 0"');
      expect(fake.published).toEqual([
        { on: false, pending: true },
        { on: true, pending: false },
      ]);
    }),
  );

  it.effect("treats a cancelled password dialog as a silent no-op", () =>
    Effect.gen(function* () {
      const fake = setup(() => Effect.succeed(ok("cancelled\n")));
      expect(yield* fake.keepAwake.set(true)).toBe("cancelled");
      expect(fake.published.at(-1)).toEqual({ on: false, pending: false });
    }),
  );

  it.effect("fails with stderr and still shows the re-read state, not the requested one", () =>
    Effect.gen(function* () {
      const fake = setup(() =>
        Effect.sync(() => {
          // pmset changed the setting but osascript still reported an error.
          fake.machine.sleepDisabled = true;
          return { stdout: "", stderr: "execution error: boom (1)\n", exitCode: 1 };
        }),
      );
      const error = yield* Effect.flip(fake.keepAwake.set(true));
      expect(error.message).toBe("execution error: boom (1)");
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
    }),
  );

  it.effect("clears pending when the subprocess cannot even start", () =>
    Effect.gen(function* () {
      const fake = setup(() => Effect.fail(new KeepAwakeError({ message: "spawn ENOENT" })));
      yield* Effect.flip(fake.keepAwake.set(false));
      expect(fake.published.at(-1)).toEqual({ on: false, pending: false });
    }),
  );

  it.effect("rejects a second write while one is waiting on the dialog", () =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<KeepAwakeRunResult>();
      const fake = setup(() => Deferred.await(answer));
      const first = yield* Effect.forkChild(fake.keepAwake.set(true));
      yield* Effect.yieldNow;
      expect(yield* fake.keepAwake.set(false)).toBe("busy");
      expect(fake.calls.filter((call) => call.command === "/usr/bin/osascript")).toHaveLength(1);
      fake.machine.sleepDisabled = true;
      yield* Deferred.succeed(answer, ok(""));
      expect(yield* Fiber.join(first)).toBe("ok");
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
      expect(yield* fake.keepAwake.set(false)).not.toBe("busy");
    }),
  );

  it.effect("refresh publishes only when the system value changed", () =>
    Effect.gen(function* () {
      const fake = setup(() => Effect.succeed(ok("")));
      expect(yield* fake.keepAwake.refresh).toEqual({ on: false, pending: false });
      expect(fake.published).toEqual([]);
      fake.machine.sleepDisabled = true;
      expect(yield* fake.keepAwake.refresh).toEqual({ on: true, pending: false });
      expect(fake.published).toEqual([{ on: true, pending: false }]);
    }),
  );
});
