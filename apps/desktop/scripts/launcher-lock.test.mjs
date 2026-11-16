import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "vite-plus/test";

import { acquireLauncherLock } from "./launcher-lock.mjs";

function tempLockFile() {
  return NodePath.join(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "launcher-lock-")),
    "lock",
  );
}

describe("launcher lock", () => {
  it("claims the lock when nobody holds it, and release removes it", () => {
    const file = tempLockFile();
    const lock = acquireLauncherLock({ file, pid: 10, claim: true, isLauncher: () => false });
    assert.isTrue(lock.acquired);
    assert.deepEqual(JSON.parse(NodeFS.readFileSync(file, "utf8")), { pid: 10 });
    lock.release();
    assert.isFalse(NodeFS.existsSync(file));
  });

  it("refuses to start next to a running launcher, whether or not it would claim", () => {
    const file = tempLockFile();
    NodeFS.writeFileSync(file, JSON.stringify({ pid: 10 }));
    for (const claim of [true, false]) {
      const result = acquireLauncherLock({ file, pid: 20, claim, isLauncher: (pid) => pid === 10 });
      assert.deepEqual(result, { acquired: false, holder: 10 });
    }
    assert.deepEqual(JSON.parse(NodeFS.readFileSync(file, "utf8")), { pid: 10 });
  });

  it("takes over a lock whose holder is gone", () => {
    const file = tempLockFile();
    NodeFS.writeFileSync(file, JSON.stringify({ pid: 10 }));
    const lock = acquireLauncherLock({ file, pid: 20, claim: true, isLauncher: () => false });
    assert.isTrue(lock.acquired);
    assert.deepEqual(JSON.parse(NodeFS.readFileSync(file, "utf8")), { pid: 20 });
  });

  it("does not write a lock for a non-claiming launcher", () => {
    const file = tempLockFile();
    assert.isTrue(
      acquireLauncherLock({ file, pid: 30, claim: false, isLauncher: () => false }).acquired,
    );
    assert.isFalse(NodeFS.existsSync(file));
  });

  it("release leaves a lock another launcher took over", () => {
    const file = tempLockFile();
    const lock = acquireLauncherLock({ file, pid: 10, claim: true, isLauncher: () => false });
    NodeFS.writeFileSync(file, JSON.stringify({ pid: 20 }));
    lock.release();
    assert.deepEqual(JSON.parse(NodeFS.readFileSync(file, "utf8")), { pid: 20 });
  });
});
