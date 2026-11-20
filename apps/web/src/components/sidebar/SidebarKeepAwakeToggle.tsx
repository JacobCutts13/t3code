import { T, useGT, Var } from "gt-react";
import { CoffeeIcon } from "lucide-react";

import { setKeepAwake, useKeepAwake } from "../../state/keepAwake";
import { SidebarMenuItem } from "../ui/sidebar";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export function SidebarKeepAwakeToggle() {
  const gt = useGT();
  const on = useKeepAwake();
  if (on === null) return null;
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <Toggle
              aria-label={gt("Keep this {product} awake", { product: "Mac" })}
              pressed={on}
              onPressedChange={(next) => void setKeepAwake(next)}
              variant="ghost"
            >
              <CoffeeIcon className="size-4" />
            </Toggle>
          }
        />
        <TooltipPopup side="top">
          {on ? (
            <T>
              Keeping this <Var>Mac</Var> awake. Click to let it sleep.
            </T>
          ) : (
            <T>
              Keep this <Var>Mac</Var> awake
            </T>
          )}
        </TooltipPopup>
      </Tooltip>
    </SidebarMenuItem>
  );
}
