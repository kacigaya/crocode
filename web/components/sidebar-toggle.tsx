"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Button that collapses the sidebar to an icon rail or expands it again. */
export function SidebarToggle({
  collapsed,
  controls,
  onToggle,
}: {
  collapsed: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const label = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-expanded={!collapsed}
            aria-controls={controls}
            aria-keyshortcuts="Control+B Meta+B"
            onClick={onToggle}
          />
        }
      >
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipPopup side="right">
        {label}
        <kbd className="ms-2 font-sans text-muted-foreground">Ctrl/⌘ B</kbd>
      </TooltipPopup>
    </Tooltip>
  );
}
