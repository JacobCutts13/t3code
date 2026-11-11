import { assert, describe, it } from "vite-plus/test";

import { makeLiveRestartTracker } from "./live-restart-state.mjs";

const files = ["main.cjs", "bin.mjs"];

function setup(initial) {
  const disk = new Map(Object.entries(initial));
  const tracker = makeLiveRestartTracker({
    files,
    hashFile: async (file) => disk.get(file) ?? null,
  });
  return { disk, tracker };
}

describe("live restart tracker", () => {
  it("reports a rebuilt file until a restart takes a new baseline", async () => {
    const { disk, tracker } = setup({ "main.cjs": "a", "bin.mjs": "b" });
    assert.deepEqual(await tracker.resetBaseline(), []);

    disk.set("bin.mjs", "b2");
    assert.deepEqual(await tracker.refresh("bin.mjs"), ["bin.mjs"]);

    assert.deepEqual(await tracker.resetBaseline(), []);
  });

  it("clears when a rebuild returns to what the app is running", async () => {
    const { disk, tracker } = setup({ "main.cjs": "a", "bin.mjs": "b" });
    await tracker.resetBaseline();

    disk.set("main.cjs", "a2");
    assert.deepEqual(await tracker.refresh("main.cjs"), ["main.cjs"]);
    disk.set("main.cjs", "a");
    assert.deepEqual(await tracker.refresh("main.cjs"), []);
  });

  it("treats a deleted file as changed", async () => {
    const { disk, tracker } = setup({ "main.cjs": "a", "bin.mjs": "b" });
    await tracker.resetBaseline();

    disk.delete("bin.mjs");
    assert.deepEqual(await tracker.refresh("bin.mjs"), ["bin.mjs"]);
  });

  it("applies hashes in the order the changes arrived", async () => {
    let releaseSlowHash;
    const slowHash = new Promise((resolve) => {
      releaseSlowHash = resolve;
    });
    const hashes = { "main.cjs": ["a"], "bin.mjs": ["b", slowHash, "b"] };
    const tracker = makeLiveRestartTracker({
      files,
      hashFile: async (file) => hashes[file].shift(),
    });
    await tracker.resetBaseline();

    const older = tracker.refresh("bin.mjs");
    const newer = tracker.refresh("bin.mjs");
    releaseSlowHash("partial-write");

    assert.deepEqual(await older, ["bin.mjs"]);
    assert.deepEqual(await newer, []);
  });
});
