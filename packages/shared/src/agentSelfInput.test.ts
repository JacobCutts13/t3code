// @effect-diagnostics nodeBuiltinImport:off -- The test runs the generated command in a real shell.
import { describe, expect, it } from "@effect/vitest";
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { AGENT_SELF_INPUT_ENV, agentSelfInputCommand } from "./agentSelfInput.ts";

describe("agentSelfInputCommand", () => {
  it("sends to the agent's own thread, reading the message from stdin", () => {
    expect(AGENT_SELF_INPUT_ENV).toBe("AGENT_SELF_INPUT");
    expect(agentSelfInputCommand({ command: "/usr/bin/t3", entrypoint: undefined })).toBe(
      `'/usr/bin/t3' 'thread' 'send' "$T3CODE_THREAD_ID" -`,
    );
  });

  it("runs a script entrypoint through the runtime", () => {
    expect(agentSelfInputCommand({ command: "/usr/bin/node", entrypoint: "/app/bin.mjs" })).toBe(
      `'/usr/bin/node' '/app/bin.mjs' 'thread' 'send' "$T3CODE_THREAD_ID" -`,
    );
  });

  it("survives the agent's shell: a path with a space and a quote, the thread id expanded, stdin passed on", () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "self-input-"));
    try {
      const dir = NodePath.join(root, "T3 Code's");
      NodeFS.mkdirSync(dir);
      const script = NodePath.join(dir, "t3");
      NodeFS.writeFileSync(script, '#!/bin/sh\nprintf "%s\\n" "$@"\ncat\n', { mode: 0o755 });

      const output = NodeChildProcess.execFileSync(
        "sh",
        ["-c", agentSelfInputCommand({ command: script, entrypoint: undefined })],
        {
          input: "/goal Ship it",
          encoding: "utf8",
          env: { PATH: "/usr/bin:/bin", T3CODE_THREAD_ID: "thread-42" },
        },
      );

      expect(output.split("\n")).toEqual(["thread", "send", "thread-42", "-", "/goal Ship it"]);
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  });
});
