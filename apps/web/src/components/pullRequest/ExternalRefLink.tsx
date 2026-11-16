import { ExternalLinkIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { readLocalApi } from "~/localApi";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { showPullRequestLinkContextMenu } from "./pullRequestLinkContextMenu";

const open = (url: string) => void readLocalApi()?.shell.openExternal(url);

/**
 * A pull request's or issue's `#123 ↗` reference that opens it on its host, with a copy/open
 * context menu. `inRow` renders a span for use inside a row's button, which cannot nest a button.
 */
export function ExternalRefLink({
  url,
  label,
  openLabel,
  ariaLabel,
  className,
  focusable = true,
  inRow = false,
}: {
  url: string;
  label: ReactNode;
  /** The tooltip and context-menu entry, such as "Open on GitHub". */
  openLabel: string;
  ariaLabel: string;
  className?: string;
  focusable?: boolean;
  inRow?: boolean;
}) {
  const onClick = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    open(url);
  };
  const handlers = {
    onClick,
    onAuxClick: (event: ReactMouseEvent) => {
      if (event.button === 1) onClick(event);
    },
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void showPullRequestLinkContextMenu({
        url,
        openLabel,
        position: { x: event.clientX, y: event.clientY },
      });
    },
  };
  const linkClassName = cn(
    "inline-flex shrink-0 cursor-pointer items-center gap-0.5 underline-offset-2 hover:underline",
    className,
  );
  const content = (
    <>
      {label}
      <ExternalLinkIcon aria-hidden className="size-2.5" />
    </>
  );
  // Rows render in long lists, so they skip the tooltip; the icon and label carry the meaning.
  if (inRow) {
    return (
      <span role="link" aria-label={ariaLabel} className={linkClassName} {...handlers}>
        {content}
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            tabIndex={focusable ? undefined : -1}
            className={linkClassName}
            {...handlers}
          />
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipPopup side="top">{openLabel}</TooltipPopup>
    </Tooltip>
  );
}

/** The repository or tracker scope beside an {@link ExternalRefLink}, opening its page when known. */
export function ExternalRefScope({ scope, url }: { scope: string; url: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          url ? (
            <button
              type="button"
              onClick={() => open(url)}
              className="min-w-0 cursor-pointer truncate text-left font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {scope}
            </button>
          ) : (
            <span className="min-w-0 truncate font-medium text-muted-foreground">{scope}</span>
          )
        }
      />
      <TooltipPopup side="top">{url ? `Open ${scope} repository` : scope}</TooltipPopup>
    </Tooltip>
  );
}
