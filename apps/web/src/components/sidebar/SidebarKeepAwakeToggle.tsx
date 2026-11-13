import { CoffeeIcon } from "lucide-react";

import { setKeepAwake, useKeepAwake } from "../../state/keepAwake";
import { SidebarMenuItem } from "../ui/sidebar";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarKeepAwakeToggle() {
  const on = useKeepAwake();
  if (on === null) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label="Keep this Mac awake"
              pressed={on}
              onPressedChange={(next) => void setKeepAwake(next)}
              variant="ghost"
            >
              <CoffeeIcon className="size-4" />
            </Toggle>
          }
        />
        <TooltipPopup side="top">
          {on ? "Keeping this Mac awake. Click to let it sleep." : "Keep this Mac awake"}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
