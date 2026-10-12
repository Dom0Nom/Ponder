import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useIntegrationsInfo } from "../../lib/queries";
import { s } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { ErrorState, Skeleton, Switch } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { SettingsGroup, SettingsRow } from "./layout";
import { McpClientSection } from "./McpClientSection";

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
  const [write, setWrite] = useState(true);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error || !data) return <ErrorState title={s.integrations.loadError} error={error} onRetry={() => refetch()} />;
  const mcpArgs = ["mcp", "--db", data.dbPath, ...(write ? ["--write"] : [])];
  const claudeCodeCommand = `claude mcp add ponder -- ${[data.exePath, ...mcpArgs].map((a) => (/^[\w./:@%+=-]+$/.test(a) ? a : shellQuote(a))).join(" ")}`;
  const desktopConfig = JSON.stringify({ mcpServers: { ponder: { command: data.exePath, args: mcpArgs } } }, null, 2);
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
      <div className="flex flex-col gap-2">
        <h3 className="text-input font-semibold">{s.integrations.mcpTitle}</h3>
        <p className="text-body text-muted">{s.integrations.mcpBody}</p>
        <p className="text-caption text-muted">{s.integrations.mcpTools}</p>
        <SettingsGroup>
          <SettingsRow title={s.integrations.mcpWrite} description={s.integrations.mcpWriteBody}>
            <Switch checked={write} onCheckedChange={setWrite} label={s.integrations.mcpWrite} />
          </SettingsRow>
        </SettingsGroup>
        <p className="text-caption font-medium">{s.integrations.mcpClaudeCode}</p>
        <CodeBlock testId="mcp-claude-code" label={`${s.integrations.copy}: ${s.integrations.mcpClaudeCode}`} text={claudeCodeCommand} />
        <p className="text-caption font-medium">{s.integrations.mcpClaudeDesktop}</p>
        <CodeBlock testId="mcp-claude-desktop" label={`${s.integrations.copy}: ${s.integrations.mcpClaudeDesktop}`} text={desktopConfig} />
      </div>
      <McpClientSection />
    </div>
  );
}
