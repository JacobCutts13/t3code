import { describe, expect, it } from "vite-plus/test";

import {
  forkNewTaskDraftKey,
  newTaskDraftForkOf,
  newTaskDraftKey,
  restoredNewTaskDraftKey,
} from "./new-task-draft-key";

describe("fork drafts", () => {
  it("keys a fork's draft by its source, so Fork reopens it and its send forks that thread", () => {
    expect(forkNewTaskDraftKey("thread-1")).toBe(forkNewTaskDraftKey("thread-1"));
    expect(newTaskDraftForkOf(forkNewTaskDraftKey("thread-1"))).toBe("thread-1");
  });

  it("never reads an ordinary or restored draft as a fork", () => {
    expect(newTaskDraftForkOf(newTaskDraftKey("draft-1"))).toBeNull();
    expect(newTaskDraftForkOf(restoredNewTaskDraftKey("message-1"))).toBeNull();
    expect(newTaskDraftForkOf("fork:thread-1")).toBeNull();
  });
});
