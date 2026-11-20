import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import { useNavigate } from "@tanstack/react-router";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { newThreadId } from "../lib/utils";
import { waitForThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { buildThreadRouteParams } from "../threadRoutes";
import { useAtomCommand } from "../state/use-atom-command";
import { m } from "../i18n/messages";

/** Opens a thread a fork just created, once its shell reaches this client; returns an error otherwise. */
export function useOpenForkedThread() {
  const navigate = useNavigate();
  return async (targetThreadRef: ScopedThreadRef): Promise<string | null> => {
    if (!(await waitForThreadShell(targetThreadRef))) {
      return m(
        msg(
          "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
        ),
      );
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
    return null;
  };
}

/** Forks a whole thread at its latest completed run, then opens the fork. */
export function useForkThread() {
  const forkThread = useAtomCommand(threadEnvironment.forkThread, { reportFailure: false });
  const openForkedThread = useOpenForkedThread();
  const failureToast = (description: string) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: m(msg("Failed to fork thread")), description }),
    );
  return async (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) => {
    const targetThreadId = newThreadId();
    const result = await forkThread({
      environmentId: thread.environmentId,
      input: { sourceThreadId: thread.id, targetThreadId },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        failureToast(thrownErrorMessage(error, m) ?? m(msg("An error occurred.")));
      }
      return;
    }
    const error = await openForkedThread(scopeThreadRef(thread.environmentId, targetThreadId));
    if (error !== null) failureToast(error);
  };
}
