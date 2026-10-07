import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";

export function SubPage({
  crumb,
  section,
  title,
  description,
  children,
  footer,
}: {
  crumb: string;
  section: string;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const navigate = useUi((st) => st.navigate);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[800px] flex-col gap-4 p-10">
        <nav aria-label={s.settings.title} className="flex h-5 items-center gap-1.5 text-body text-muted">
          <button className="flex items-center gap-1 hover:text-fg" onClick={() => navigate({ name: "settings", section })}>
            <ChevronLeft size={14} />
            {s.settings.title}
          </button>
          <span aria-hidden>/</span>
          <span className="font-medium text-fg">{crumb}</span>
        </nav>
        <div className="-mx-5 flex flex-col">
          <div className="flex flex-col gap-[5px] pb-[5px] pl-5 pr-4 pt-[15px]">
            <h1 className="text-title font-semibold">{title}</h1>
            {description && <p className="text-pretty text-body leading-[1.5] text-muted">{description}</p>}
          </div>
          <div className="flex min-h-0 flex-col gap-3.5 px-5 pb-5 pt-3">{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3.5">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
