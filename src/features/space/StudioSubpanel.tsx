import { ArrowLeft, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui/button";
import { s } from "../../lib/strings";

export function StudioSubpanel({
  title,
  onBack,
  onClose,
  footer,
  children,
  testId,
}: {
  title: string;
  onBack?: () => void;
  onClose?: () => void;
  footer?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  const label = onClose ? s.common.close : s.studio.back;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-testid={testId}>
      <div className="flex h-12 flex-none items-center gap-1.5 border-b border-divider px-2.5">
        <Button variant="ghost-muted" size="icon-sm" title={label} aria-label={label} onClick={onClose ?? onBack}>
          {onClose ? <X size={15} /> : <ArrowLeft size={15} />}
        </Button>
        <span className="min-w-0 truncate text-input font-semibold">{title}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-4">{children}</div>
      {footer && <div className="flex flex-none gap-2 border-t border-divider px-4 py-3">{footer}</div>}
    </div>
  );
}
