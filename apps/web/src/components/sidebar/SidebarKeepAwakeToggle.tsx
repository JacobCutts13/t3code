import { CoffeeIcon } from "lucide-react";

import { setKeepAwake, useKeepAwakeState } from "../../state/keepAwake";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarKeepAwakeToggle() {
  const state = useKeepAwakeState();
  if (state === null) return null;

  let label = state.on
    ? "Keep this Mac awake: on. Stays on after T3 quits. Click to let it sleep."
    : "Keep this Mac awake, even with the lid closed. Stays on after T3 quits.";
  if (state.pending) label = "Keep this Mac awake: waiting for your password…";
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
