import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { Tooltip } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";

/** Container for every Studio sub-view: back header, scrolling body, optional footer. */
export function StudioSubpanel({
  title,
  onBack,
  onClose,
  footer,
  children,
  testId,
  bodyClassName,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
  bodyClassName?: string;
}) {
  const closing = !!onClose;
  const label = closing ? s.common.close : s.studio.back;
  return (
    <div
      data-testid={testId}
      className="flex h-full min-h-0 flex-col"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented && (onClose ?? onBack)) {
          const t = e.target as HTMLElement;
          if (t.closest("[role=dialog],[role=menu],[role=listbox]")) return;
          (onClose ?? onBack)?.();
        }
      }}
    >
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-divider px-2.5">
        <Tooltip content={label}>
          <Button variant="ghost-muted" size="icon-sm" aria-label={label} onClick={onClose ?? onBack}>
            {closing ? <X size={15} /> : <ArrowLeft size={15} />}
          </Button>
        </Tooltip>
        <h2 className="text-input font-semibold">{title}</h2>
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4", bodyClassName)}>{children}</div>
      {footer && <div className="flex shrink-0 gap-2 border-t border-divider px-4 py-3">{footer}</div>}
    </div>
  );
}
