import { CoffeeIcon } from "lucide-react";

import { useKeepAwakeState } from "../../state/keepAwake";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export async function setKeepAwake(on: boolean): Promise<void> {
  try {
    await window.desktopBridge?.setKeepAwake?.(on);
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not change keep awake",
        description: error instanceof Error ? error.message : "pmset failed.",
      }),
    );
  }
}

export function SidebarKeepAwakeToggle() {
  const state = useKeepAwakeState();
  if (state === null) return null;

  const label = state.pending
    ? "Keep this Mac awake: waiting for your password…"
    : state.on
      ? "Keep this Mac awake: on. Stays on after T3 quits. Click to let it sleep."
      : "Keep this Mac awake: off";
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              aria-label="Keep this Mac awake"
              aria-pressed={state.on}
              isActive={state.on}
              disabled={state.pending}
              onClick={() => void setKeepAwake(!state.on)}
              size="icon"
            >
              <CoffeeIcon />
            </SidebarMenuButton>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
