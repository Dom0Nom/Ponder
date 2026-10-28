import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "../../lib/ipc";
import { useSetSetting, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { McpServer } from "../../lib/types";
import { MCP_KEY, hostOf, isUrl, joinCommand, mcpServers, splitCommand } from "../../lib/mcp/client";
import { Button } from "../../components/ui/button";
import { Input, Label, Textarea, fieldLabel } from "../../components/ui/input";
import { Spinner, Switch } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { SettingsGroup, SettingsRow } from "./layout";

const t = s.integrations.client;
const envAccount = (id: string) => `mcp-env:${id}`;
const clientSecretAccount = (id: string) => `mcp-oauth-client:${id}`;

function ServerForm({ server, onDone }: { server: McpServer | null; onDone: (saved: McpServer | null, env: string, clientSecret: string) => void }) {
  const [name, setName] = useState(server?.name ?? "");
  const [command, setCommand] = useState(server ? (server.url ?? joinCommand([server.command, ...server.args])) : "");
  const [env, setEnv] = useState("");
  const [clientId, setClientId] = useState(server?.oauthClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const remote = isUrl(command);
  const submit = () => {
    const id = server?.id ?? crypto.randomUUID();
    const enabled = server?.enabled ?? true;
    if (remote) {
      const url = command.trim();
      const oauthClientId = clientId.trim() || undefined;
      onDone({ id, name: name.trim() || hostOf(url), command: "", args: [], url, ...(oauthClientId ? { oauthClientId } : {}), enabled }, env, oauthClientId ? clientSecret : "");
      return;
    }
    const parts = splitCommand(command.trim());
    if (!parts.length || !parts[0]) {
      setError(t.commandRequired);
      return;
    }
    const [cmd, ...args] = parts;
    onDone({ id, name: name.trim() || cmd, command: cmd, args, enabled }, env, "");
  };
  return (
    <form
      className="flex flex-col gap-3 py-3"
      data-testid="mcp-server-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-name" className={fieldLabel}>
          {t.name}
        </Label>
        <Input id="mcp-name" value={name} placeholder={t.namePlaceholder} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-command" className={fieldLabel}>
          {t.command}
        </Label>
        <Input
          id="mcp-command"
          value={command}
          placeholder={t.commandPlaceholder}
          spellCheck={false}
          aria-invalid={!!error}
          onChange={(e) => {
            setCommand(e.target.value);
            setError(null);
          }}
        />
        <p className={error ? "text-caption text-danger" : "text-caption text-muted"}>{error ?? t.commandHint}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mcp-env" className={fieldLabel}>
          {remote ? t.headers : t.env}
        </Label>
        <Textarea
          id="mcp-env"
          rows={2}
          value={env}
          placeholder={remote ? t.headersPlaceholder : t.envPlaceholder}
          spellCheck={false}
          onChange={(e) => setEnv(e.target.value)}
        />
        <p className="text-caption text-muted">{remote ? (server ? t.headersKept : t.headersHint) : server ? t.envKept : t.envHint}</p>
      </div>
      {remote && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mcp-client-id" className={fieldLabel}>
              {t.oauthClientId}
            </Label>
            <Input id="mcp-client-id" value={clientId} spellCheck={false} autoComplete="off" onChange={(e) => setClientId(e.target.value)} />
            <p className="text-caption text-muted">{t.oauthClientIdHint}</p>
          </div>
          {clientId.trim() && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mcp-client-secret" className={fieldLabel}>
                {t.oauthClientSecret}
              </Label>
              <Input id="mcp-client-secret" type="password" value={clientSecret} spellCheck={false} autoComplete="off" onChange={(e) => setClientSecret(e.target.value)} />
              <p className="text-caption text-muted">{server?.oauthClientId ? t.oauthClientSecretKept : t.oauthClientSecretHint}</p>
            </div>
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(null, "", "")}>
          {t.cancel}
        </Button>
        <Button type="submit" variant="primary">
          {t.save}
        </Button>
      </div>
    </form>
  );
}

function ServerRow({ server, onToggle, onEdit, onRemove }: { server: McpServer; onToggle: (on: boolean) => void; onEdit: () => void; onRemove: () => void }) {
  const [testing, setTesting] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const remote = !!server.url;

  useEffect(() => {
    if (!remote) return;
    let live = true;
    api
      .mcpAuthStatus(server.id)
      .then((r) => live && setSignedIn(r.signedIn))
      .catch(() => live && setSignedIn(false));
    return () => {
      live = false;
    };
  }, [remote, server.id]);

  const test = async () => {
    setTesting(true);
    try {
      await api.mcpStop(server.id);
      setCount((await api.mcpTools(server)).length);
    } catch (e) {
      setCount(null);
      if ((e as { code?: string }).code === "auth") toastError(t.needsSignIn(server.name), e, () => void signIn());
      else toastError(t.testFailed(server.name), e);
    } finally {
      setTesting(false);
    }
  };

  const signIn = async () => {
    setSigningIn(true);
    try {
      await api.mcpSignIn(server);
      setSignedIn(true);
      setCount((await api.mcpTools(server)).length);
    } catch (e) {
      toastError(t.signInFailed(server.name), e, () => void signIn());
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    try {
      await api.mcpSignOut(server.id);
      setSignedIn(false);
      setCount(null);
    } catch (e) {
      toastError(t.signInFailed(server.name), e);
    }
  };
  return (
    <SettingsRow
      title={server.name}
      description={
        <span className="flex flex-col gap-0.5">
          <span className="truncate font-mono">{server.url ?? joinCommand([server.command, ...server.args])}</span>
          {(count != null || signedIn) && (
            <span data-testid="mcp-tool-count">{[signedIn ? t.signedIn : null, count != null ? t.tools(count) : null].filter(Boolean).join(" · ")}</span>
          )}
        </span>
      }
    >
      <div className="flex shrink-0 items-center gap-1" data-testid="mcp-server" data-name={server.name}>
        {remote && signedIn === false && (
          <Button size="sm" variant="ghost" onClick={signIn} disabled={signingIn}>
            {signingIn ? <Spinner size={14} /> : null}
            {signingIn ? t.signingIn : t.signIn}
          </Button>
        )}
        {remote && signedIn && (
          <Button size="sm" variant="ghost" onClick={signOut}>
            {t.signOut}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={test} disabled={testing}>
          {testing ? <Spinner size={14} /> : null}
          {testing ? t.testing : t.test}
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t.edit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onRemove}>
          {t.remove}
        </Button>
        <Switch label={t.enabled(server.name)} checked={server.enabled} onCheckedChange={onToggle} />
      </div>
    </SettingsRow>
  );
}

export function McpClientSection() {
  const { data: settings } = useSettings();
  const setSetting = useSetSetting();
  const servers = mcpServers(settings);
  const [editing, setEditing] = useState<McpServer | "new" | null>(null);

  const save = async (next: McpServer[]) => {
    try {
      await setSetting.mutateAsync({ key: MCP_KEY, value: next });
    } catch (e) {
      toastError(t.saveFailed, e);
      throw e;
    }
  };

  const done = async (saved: McpServer | null, env: string, clientSecret: string) => {
    if (!saved) {
      setEditing(null);
      return;
    }
    try {
      if (env.trim()) await api.setSecret(envAccount(saved.id), env);
      if (!saved.oauthClientId) await api.deleteSecret(clientSecretAccount(saved.id)).catch(() => {});
      else if (clientSecret.trim()) await api.setSecret(clientSecretAccount(saved.id), clientSecret.trim());
      const exists = servers.some((x) => x.id === saved.id);
      await save(exists ? servers.map((x) => (x.id === saved.id ? saved : x)) : [...servers, saved]);
      await api.mcpStop(saved.id).catch(() => {});
      setEditing(null);
    } catch (e) {
      if (env.trim() || clientSecret.trim()) toastError(t.saveFailed, e);
    }
  };

  const remove = async (server: McpServer) => {
    try {
      await save(servers.filter((x) => x.id !== server.id));
      await api.mcpStop(server.id).catch(() => {});
      await api.deleteSecret(envAccount(server.id)).catch(() => {});
      await api.deleteSecret(clientSecretAccount(server.id)).catch(() => {});
      if (server.url) await api.mcpSignOut(server.id).catch(() => {});
      toast.success(`${t.remove}: ${server.name}`);
    } catch {
      // save already reported it
    }
  };

  return (
    <div className="flex flex-col gap-2" data-testid="mcp-client">
      <h3 className="text-input font-semibold">{t.title}</h3>
      <p className="text-body text-muted">{t.body}</p>
      <SettingsGroup>
        {servers.length === 0 && editing !== "new" && <p className="py-3 text-caption text-muted">{t.empty}</p>}
        {servers.map((srv) =>
          editing !== "new" && editing?.id === srv.id ? (
            <ServerForm key={srv.id} server={srv} onDone={done} />
          ) : (
            <ServerRow
              key={srv.id}
              server={srv}
              onToggle={(on) => void save(servers.map((x) => (x.id === srv.id ? { ...x, enabled: on } : x))).catch(() => {})}
              onEdit={() => setEditing(srv)}
              onRemove={() => void remove(srv)}
            />
          ),
        )}
        {editing === "new" && <ServerForm server={null} onDone={done} />}
      </SettingsGroup>
      {editing === null && (
        <Button variant="secondary" size="sm" className="self-start" onClick={() => setEditing("new")}>
          <Plus size={14} />
          {t.add}
        </Button>
      )}
    </div>
  );
}
