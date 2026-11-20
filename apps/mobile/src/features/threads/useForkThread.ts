import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ThreadId } from "@t3tools/contracts";
import * as Haptics from "expo-haptics";
import { msg } from "gt-react-native";

import * as Dialog from "../../components/ui/Dialog";
import { uuidv4 } from "../../lib/uuid";
import { threadEnvironment } from "../../state/threads";
import { m } from "../../i18n/messages";
import { useAtomCommand } from "../../state/use-atom-command";
import { useSelectWorkspaceDetail } from "../layout/workspace/useSelectWorkspaceDetail";
import { waitForThreadShell } from "./threadForkNavigation";

/** Forks a whole thread at its latest completed run, then opens the fork. */
export function useForkThread() {
  const forkThread = useAtomCommand(threadEnvironment.forkThread, { reportFailure: false });
  const selectDetail = useSelectWorkspaceDetail();
  return async (thread: Pick<EnvironmentThreadShell, "environmentId" | "id">) => {
    const targetThreadId = ThreadId.make(uuidv4());
    void Haptics.selectionAsync();
    const result = await forkThread({
      environmentId: thread.environmentId,
      input: {
        sourceThreadId: thread.id,
        targetThreadId,
        creationSource: "mobile",
      },
    });
    if (isAtomCommandInterrupted(result)) return;
    if (result._tag !== "Success") {
      const error = squashAtomCommandFailure(result);
      Dialog.alert(
        m(msg("Could not fork thread")),
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : m(msg("The thread could not be forked.")),
      );
      return;
    }
    if (!(await waitForThreadShell(scopeThreadRef(thread.environmentId, targetThreadId)))) {
      Dialog.alert(
        m(msg("Fork created")),
        m(
          msg(
            "Its thread data did not reach this client. Reconnect and try opening it from the thread list.",
          ),
        ),
      );
      return;
    }
    selectDetail({
      name: "Thread",
      params: { environmentId: thread.environmentId, threadId: targetThreadId },
    });
  };
}
