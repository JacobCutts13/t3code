import { threadForkBlockedReason } from "@t3tools/client-runtime/state/threads";
import { describe, expect, it } from "vite-plus/test";

import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  canOperate: true,
  branch: null,
  projectFilter: null,
  isPinned: false,
  isSettled: false,
  autoSettleEnabled: true,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  isRunning: false,
  hasCompletedRun: true,
  supports: {
    settlement: true,
    autoSettleOptOut: true,
    snooze: true,
    pinning: true,
    titleRegeneration: true,
  },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

describe("buildThreadActionMenuItems", () => {
  it.each([false, true])(
    "disables both lifecycle directions without permission (reversed: %s)",
    (reversed) => {
      const items = buildThreadActionMenuItems({
        ...baseState,
        canOperate: false,
        forkBlockedReason: null,
        isPinned: reversed,
        isSettled: reversed,
        isSnoozed: reversed,
      });
      const expected = reversed
        ? [
            "fork",
            "unpin",
            "unsettle",
            "unsnooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ]
        : [
            "fork",
            "pin",
            "settle",
            "snooze",
            "rename",
            "regenerate-title",
            "auto-settle",
            "archive",
            "delete",
          ];
      expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(expected);
      expect(
        items.find((item) => item.id === "snooze")?.children?.every((child) => child.disabled) ??
          true,
      ).toBe(true);
    },
  );

  it("disables archive and turning into a project while the thread is running", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      isRunning: true,
      canTurnIntoProject: true,
    });
    expect(items.find((item) => item.id === "archive")?.disabled).toBe(true);
    expect(items.find((item) => item.id === "turn-into-project")?.disabled).toBe(true);
  });

  it.each([
    ["a completed run", { lineage: {}, latestRun: { completedAt: "2026-08-07T15:00:00Z" } }, null],
    ["no run yet", { lineage: {}, latestRun: null }, "Available after a completed turn"],
    [
      "a run in progress",
      { lineage: {}, latestRun: { completedAt: null } },
      "Available after a completed turn",
    ],
    [
      "a side chat",
      { lineage: { sideChat: true }, latestRun: { completedAt: "2026-08-07T15:00:00Z" } },
      "Side chats can't be forked",
    ],
  ] as const)("offers Fork thread after New thread on branch for %s", (_case, thread, reason) => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      branch: "main",
      forkBlockedReason: threadForkBlockedReason(
        { branch: "main", worktreePath: null, ...thread },
        true,
      ),
    });
    const ids = items.map((item) => item.id);
    expect(ids.indexOf("fork")).toBe(ids.indexOf("new-thread-on-branch") + 1);
    const fork = items.find((item) => item.id === "fork");
    expect(fork?.disabled ?? false).toBe(reason !== null);
    expect(fork?.detail).toBe(reason ?? undefined);
  });

  it("hides Fork thread for a worktree with no branch to start the fork from", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      forkBlockedReason: threadForkBlockedReason(
        {
          lineage: {},
          latestRun: { completedAt: "2026-08-07T15:00:00Z" },
          branch: null,
          worktreePath: "/repo/.t3/worktrees/detached",
        },
        true,
      ),
    });
    expect(items.some((item) => item.id === "fork")).toBe(false);
  });

  it("hides Fork thread on a server that would start a plain thread instead", () => {
    const items = buildThreadActionMenuItems({
      ...baseState,
      forkBlockedReason: threadForkBlockedReason(
        {
          lineage: {},
          latestRun: { completedAt: "2026-08-07T15:00:00Z" },
          branch: "main",
          worktreePath: null,
        },
        false,
      ),
    });
    expect(items.some((item) => item.id === "fork")).toBe(false);
  });

  it.each([
    ["while the thread is running", { isRunning: true }],
    ["before any run has completed", { hasCompletedRun: false }],
  ])("omits mark unread %s", (_, overrides) => {
    const items = buildThreadActionMenuItems({ ...baseState, ...overrides });
    expect(items.map((item) => item.id)).not.toContain("mark-unread");
  });

  it("disables only rename where no inline title editor exists", () => {
    const items = buildThreadActionMenuItems({ ...baseState, canRename: false });
    expect(items.filter((item) => item.disabled).map((item) => item.id)).toEqual(["rename"]);
  });
});
