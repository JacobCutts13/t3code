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
} from "./keepAwake.ts";

const PMSET_ON = " AutoPowerOff\t\t1\n SleepDisabled\t\t1\n sleep                1\n";
const PMSET_OFF = " AutoPowerOff\t\t1\n SleepDisabled        0\n";

// A fake Mac: `pmset -g` reports `sleepDisabled` (or `read` when given); osascript answers with `write`.
const setup = (
  write: (on: boolean) => Effect.Effect<string, KeepAwakeError>,
  read?: Effect.Effect<string, KeepAwakeError>,
) => {
  const machine = { sleepDisabled: false };
  const calls: Array<{ command: string; args: ReadonlyArray<string> }> = [];
  const published: Array<DesktopKeepAwakeState> = [];
  const keepAwake = makeKeepAwake(
    (command, args) => {
      calls.push({ command, args });
      if (command === "/usr/bin/pmset") {
        return read ?? Effect.sync(() => (machine.sleepDisabled ? PMSET_ON : PMSET_OFF));
      }
      return write(args[1]!.includes("disablesleep 1"));
    },
    (state) => Effect.sync(() => published.push(state)),
  );
  const osascriptCalls = () => calls.filter((call) => call.command === "/usr/bin/osascript");
  return { machine, calls, published, keepAwake, osascriptCalls };
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
          return "\n";
        }),
      );
      yield* fake.keepAwake.set(true);
      expect(fake.calls).toEqual([
        {
          command: "/usr/bin/osascript",
          args: [
            "-e",
            'try\ndo shell script "/usr/bin/pmset -a disablesleep 1" with administrator privileges\non error number -128\nreturn "cancelled"\nend try',
          ],
        },
        { command: "/usr/bin/pmset", args: ["-g"] },
      ]);
      expect(setSleepDisabledArgs(false)[1]).toContain('"/usr/bin/pmset -a disablesleep 0"');
      expect(fake.published).toEqual([
        { on: false, pending: true },
        { on: true, pending: false },
      ]);
    }),
  );

  it.effect("treats a cancelled password dialog as a silent no-op", () =>
    Effect.gen(function* () {
      const fake = setup(() => Effect.succeed("cancelled\n"));
      yield* fake.keepAwake.set(true);
      expect(fake.published.at(-1)).toEqual({ on: false, pending: false });
    }),
  );

  it.effect("fails with the error and still shows the re-read state, not the requested one", () =>
    Effect.gen(function* () {
      const fake = setup(() =>
        Effect.suspend(() => {
          // pmset changed the setting but osascript still reported an error.
          fake.machine.sleepDisabled = true;
          return Effect.fail(new KeepAwakeError({ message: "execution error: boom (1)" }));
        }),
      );
      const error = yield* Effect.flip(fake.keepAwake.set(true));
      expect(error.message).toBe("execution error: boom (1)");
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
    }),
  );

  it.effect("ignores a second write while one is waiting on the dialog", () =>
    Effect.gen(function* () {
      const answer = yield* Deferred.make<string>();
      const fake = setup(() => Deferred.await(answer));
      const first = yield* Effect.forkChild(fake.keepAwake.set(true));
      yield* Effect.yieldNow;
      yield* fake.keepAwake.set(false);
      expect(fake.osascriptCalls()).toHaveLength(1);
      fake.machine.sleepDisabled = true;
      yield* Deferred.succeed(answer, "");
      yield* Fiber.join(first);
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
      yield* fake.keepAwake.set(false);
      expect(fake.osascriptCalls()).toHaveLength(2);
    }),
  );

  it.effect("drops a refresh that read pmset before a write verified its result", () =>
    Effect.gen(function* () {
      const staleRead = yield* Deferred.make<string>();
      const fake = setup(
        (on) =>
          Effect.sync(() => {
            fake.machine.sleepDisabled = on;
            return "";
          }),
        Effect.suspend(() =>
          fake.calls.length === 1
            ? Deferred.await(staleRead)
            : Effect.succeed(fake.machine.sleepDisabled ? PMSET_ON : PMSET_OFF),
        ),
      );
      const refresh = yield* Effect.forkChild(fake.keepAwake.refresh);
      yield* Effect.yieldNow;
      yield* fake.keepAwake.set(true);
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
      yield* Deferred.succeed(staleRead, PMSET_OFF);
      yield* Fiber.join(refresh);
      expect(fake.published.at(-1)).toEqual({ on: true, pending: false });
    }),
  );

  it.effect("refresh publishes only when the system value changed", () =>
    Effect.gen(function* () {
      const fake = setup(() => Effect.succeed(""));
      expect(yield* fake.keepAwake.refresh).toEqual({ on: false, pending: false });
      expect(fake.published).toEqual([]);
      fake.machine.sleepDisabled = true;
      expect(yield* fake.keepAwake.refresh).toEqual({ on: true, pending: false });
      expect(fake.published).toEqual([{ on: true, pending: false }]);
    }),
  );
});
