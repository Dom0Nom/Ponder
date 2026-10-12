import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useIntegrationsInfo } from "../../lib/queries";
import { s } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { SettingsGroup, SettingsRow } from "./layout";

export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="icon-sm"
      variant="ghost-muted"
      aria-label={label}
      onClick={() =>
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          (e) => toastError(s.errors.generic, e),
        )
      }
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </Button>
  );
}

export function CodeBlock({ text, label, testId }: { text: string; label: string; testId?: string }) {
  return (
    <div className="flex items-start gap-2 rounded-card border border-border bg-fill-subtle py-2 pl-3 pr-1.5">
      <pre data-testid={testId} className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-0.5 text-caption leading-[1.5] text-fg">
        {text}
      </pre>
      <CopyButton text={text} label={label} />
    </div>
  );
}

export const shellQuote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

export function IntegrationsSection() {
  const { data, isLoading, error, refetch } = useIntegrationsInfo();
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !data) return <ErrorState title={s.integrations.loadError} error={error} onRetry={() => refetch()} />;
  return (
    <div className="flex flex-col gap-5" data-testid="integrations">
      <div className="flex flex-col gap-2">
        <h3 className="text-input font-semibold">{s.integrations.linksTitle}</h3>
        <p className="text-body text-muted">{s.integrations.linksBody}</p>
        <SettingsGroup>
          {s.integrations.linkRows.map((r) => (
            <SettingsRow key={r.label} title={r.label} description={r.example}>
              <CopyButton text={r.example} label={`${s.integrations.copy}: ${r.label}`} />
            </SettingsRow>
          ))}
        </SettingsGroup>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-input font-semibold">{s.integrations.cliTitle}</h3>
        <p className="text-body text-muted">{s.integrations.cliBody}</p>
        <CodeBlock testId="cli-alias" label={`${s.integrations.copy}: ${s.integrations.cliAlias}`} text={`alias ponder=${shellQuote(data.exePath)}`} />
        <SettingsGroup>
          {s.integrations.cliRows.map((r) => (
            <SettingsRow key={r.label} title={r.label} description={r.example}>
              <CopyButton text={r.example} label={`${s.integrations.copy}: ${r.label}`} />
            </SettingsRow>
          ))}
        </SettingsGroup>
      </div>
    </div>
  );
}
