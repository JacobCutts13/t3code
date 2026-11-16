import { describe, expect, it } from "vite-plus/test";

import { parseSleepDisabled, setSleepDisabledArgs } from "./keepAwake.ts";

describe("keepAwake", () => {
  it("reads tab- and space-separated pmset output and treats a missing line as off", () => {
    expect(parseSleepDisabled(" AutoPowerOff\t\t1\n SleepDisabled\t\t1\n")).toBe(true);
    expect(parseSleepDisabled(" SleepDisabled        0\n")).toBe(false);
    expect(parseSleepDisabled(" sleep 1\n displaysleep 10\n")).toBe(false);
  });

  it("builds the privileged command only from the boolean", () => {
    expect(setSleepDisabledArgs(true)[1]).toContain('"/usr/bin/pmset -a disablesleep 1"');
    expect(setSleepDisabledArgs(false)[1]).toContain('"/usr/bin/pmset -a disablesleep 0"');
  });
});
