import { describe, expect, it } from "vite-plus/test";

import {
  forkNewTaskDraftKey,
  newTaskDraftForkOf,
  newTaskDraftKey,
  restoredNewTaskDraftKey,
} from "./new-task-draft-key";

describe("fork drafts", () => {
  it("keys a fork's draft by its source, so Fork reopens it and its send forks that thread", () => {
    const key = forkNewTaskDraftKey("env:a/b", "thread:1");
    expect(key).toBe(forkNewTaskDraftKey("env:a/b", "thread:1"));
    expect(newTaskDraftForkOf(key)).toEqual({ environmentId: "env:a/b", threadId: "thread:1" });
    // The same thread id on another machine is another source.
    expect(forkNewTaskDraftKey("env-2", "thread:1")).not.toBe(key);
  });

  it("never reads an ordinary or restored draft as a fork", () => {
    expect(newTaskDraftForkOf(newTaskDraftKey("draft-1"))).toBeNull();
    expect(newTaskDraftForkOf(restoredNewTaskDraftKey("message-1"))).toBeNull();
    expect(newTaskDraftForkOf("fork:thread-1")).toBeNull();
  });
});
