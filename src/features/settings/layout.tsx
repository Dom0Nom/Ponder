import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function SettingsSection({ id, title, body, children }: { id?: string; title: string; body?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-1.5 pt-3">
      <h2 className="text-section font-semibold">{title}</h2>
      {body && <p className="text-pretty text-body leading-[1.5] text-muted">{body}</p>}
      <div className="mt-1.5">{children}</div>
    </section>
  );
}

export function SettingsGroup({ children, className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cn("rounded-card border border-border px-4 [&>*+*]:border-t [&>*+*]:border-divider", className)}>
      {children}
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-input font-medium">{title}</span>
        {description && <span className="text-caption text-muted">{description}</span>}
      </div>
      {children}
    </div>
  );
}

export function Callout({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-pane border border-danger-border bg-danger-soft px-3 py-2 text-body">
      <div>
        <p className="font-semibold text-danger-text">{title}</p>
        {children && <p className="mt-0.5 break-words text-danger-text-2">{children}</p>}
      </div>
    </div>
  );
}
