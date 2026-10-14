import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ProviderIcon } from "../../components/ProviderIcon";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { SuccessCircleCheck } from "../../components/motion/SuccessCheck";
import { ThinkingLine } from "../../components/motion/ThinkingLine";
import { useShake } from "../../components/motion/useShake";
import { Button } from "../../components/ui/button";
import { Input, Label } from "../../components/ui/input";
import { toastError } from "../../components/ui/toast";
import { api } from "../../lib/ipc";
import { catalog, pickDefaultModel } from "../../lib/providers/catalog";
import { qk, useProviders } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { DeviceCodeStart, LanServer, Provider, ProviderType } from "../../lib/types";
import { openExternal } from "../settings/openExternal";
import { NativeSelect } from "../settings/NativeSelect";
import { pk, useOAuthStatus } from "../settings/providerQueries";
import { ensureProvider, recommendedModel, setChosenModel, useVerify } from "./connect";
import { Heading } from "./parts";

const KEY_TYPES: ProviderType[] = ["openrouter", "openai", "anthropic", "google"];

function Card({ title, index, facts, children, testId }: { title: string; index: number; facts?: [string, string][]; children: ReactNode; testId: string }) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className="t-panel-slide flex flex-col gap-3 rounded-card border border-border p-4"
      data-open="true"
      style={{ "--panel-translate-y": "20px", transitionDelay: `${index * 60}ms` } as React.CSSProperties}
    >
      <h2 className="text-input font-semibold">{title}</h2>
      {facts && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
          {facts.map(([k, v]) => (
            <div key={k} className="col-span-2 grid grid-cols-subgrid">
              <dt className="font-medium text-fg-secondary">{k}</dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </section>
  );
}

function TestLine({ state, error }: { state: "idle" | "testing" | "ok" | "error"; error?: string }) {
  if (state === "testing")
    return (
      <p className="flex items-center gap-2 text-body text-muted">
        <ActivityOrb activity="research" size={20} />
        <ThinkingLine label={s.onboarding.ai.testing} />
      </p>
    );
  if (state === "ok")
    return (
      <p role="status" className="flex items-center gap-2 text-body text-success-text">
        <SuccessCircleCheck size={16} />
        {s.onboarding.ai.connected}
      </p>
    );
  if (state === "error")
    return (
      <p role="alert" className="text-body text-danger">
        {s.onboarding.ai.testFailed}: {error}
      </p>
    );
  return null;
}

function SubscriptionCard({ index, providers }: { index: number; providers: Provider[] | undefined }) {
  const qc = useQueryClient();
  const { status, verify, reset } = useVerify();
  const [pid, setPid] = useState<string | null>(null);
  const [type, setType] = useState<ProviderType | null>(null);
  const [device, setDevice] = useState<DeviceCodeStart | null>(null);
  const [copied, setCopied] = useState(false);
  const oauth = useOAuthStatus(pid ?? "", !!pid);
  const verified = useRef(false);

  useEffect(() => {
    const p = providers?.find((x) => x.id === pid);
    if (oauth.data?.state === "signedIn" && p && !verified.current) {
      verified.current = true;
      verify(p).catch(() => {});
    }
  }, [oauth.data?.state, pid, providers]);

  const start = async (t: ProviderType) => {
    verified.current = false;
    reset();
    setDevice(null);
    setType(t);
    try {
      const { provider } = await ensureProvider(providers, t);
      await qc.invalidateQueries({ queryKey: qk.providers });
      setPid(provider.id);
      if (t === "chatgpt-oauth") await api.oauthChatgptStart(provider.id);
      else setDevice(await api.oauthXaiDeviceStart(provider.id));
      qc.setQueryData(pk.oauth(provider.id), { providerId: provider.id, state: "pending" });
    } catch (e) {
      toastError(s.providers.signInFailed, e, () => void start(t));
      setType(null);
    }
  };

  const pending = !!type && oauth.data?.state !== "signedIn" && status.state === "idle";
  const link = device?.verificationUriComplete || device?.verificationUri;
  const ai = s.onboarding.ai;
  return (
    <Card
      title={ai.subscription.title}
      index={index}
      testId="ai-subscription"
      facts={[
        [ai.cost, ai.subscription.cost],
        [ai.leaves, ai.subscription.leaves],
        [ai.needs, ai.subscription.needs],
      ]}
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={pending} onClick={() => void start("chatgpt-oauth")}>
          <ProviderIcon type="chatgpt-oauth" size={15} />
          {ai.subscription.chatgpt}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={() => void start("xai-oauth")}>
          <ProviderIcon type="xai-oauth" size={15} />
          {ai.subscription.grok}
        </Button>
      </div>
      {device && pending && (
        <div className="flex flex-wrap items-center gap-3 rounded-pane bg-fill-subtle p-3">
          <span className="text-label font-semibold text-muted">{ai.deviceCode}</span>
          <span data-testid="device-code" className="text-code font-semibold tabular-nums">
            {device.userCode}
          </span>
          <Button
            variant="ghost-muted"
            size="icon-sm"
            aria-label={s.providers.copyCode}
            onClick={() =>
              navigator.clipboard
                .writeText(device.userCode)
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                })
                .catch(() => {})
            }
          >
            {copied ? <Check size={15} /> : <Copy size={15} />}
          </Button>
          {link && (
            <Button variant="secondary" size="sm" onClick={() => openExternal(link)}>
              <ExternalLink size={14} aria-hidden />
              {ai.openLink}
            </Button>
          )}
        </div>
      )}
      {pending && (
        <p className="flex items-center gap-2 text-body text-muted">
          <ActivityOrb activity="research" size={20} />
          <ThinkingLine label={ai.waitingBrowser} />
        </p>
      )}
      <TestLine {...status} />
    </Card>
  );
}

function KeyCard({ index, providers }: { index: number; providers: Provider[] | undefined }) {
  const { status, verify, reset } = useVerify();
  const [type, setType] = useState<ProviderType>("openrouter");
  const [key, setKey] = useState("");
  const shake = useShake();
  const entry = catalog[type];
  const ai = s.onboarding.ai;

  const submit = async () => {
    if (!key.trim() || status.state === "testing") return;
    let created: Provider | null = null;
    try {
      const r = await ensureProvider(providers, type);
      created = r.created ? r.provider : null;
      await api.setSecret(r.provider.id, key.trim());
      await verify(r.provider);
      setKey("");
    } catch {
      shake.shake();
      if (created) await api.deleteProvider(created.id).catch(() => {});
    }
  };

  return (
    <Card
      title={ai.key.title}
      index={index}
      testId="ai-key"
      facts={[
        [ai.cost, ai.key.cost],
        [ai.leaves, ai.key.leaves],
        [ai.needs, ai.key.needs],
      ]}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <Label htmlFor="ob-provider">{ai.key.provider}</Label>
          <NativeSelect
            id="ob-provider"
            value={type}
            onChange={(e) => {
              setType(e.target.value as ProviderType);
              reset();
            }}
          >
            {KEY_TYPES.map((t) => (
              <option key={t} value={t}>
                {catalog[t].label}
                {t === "openrouter" ? ` (${ai.key.recommended})` : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <Label htmlFor="ob-key">{s.providers.apiKey}</Label>
            <button type="button" onClick={() => openExternal(entry.docsUrl)} className="inline-flex items-center gap-1 text-label font-semibold hover:underline">
              {ai.key.getKey}
              <ExternalLink size={12} aria-hidden />
            </button>
          </div>
          <Input
            id="ob-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            className={shake.cls(status.state === "error")}
            {...shake.props}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button variant="secondary" type="submit" disabled={!key.trim() || status.state === "testing"}>
            {ai.key.connect}
          </Button>
          <TestLine {...status} />
        </div>
        <p className="text-caption text-muted">{ai.key.moreInSettings}</p>
      </form>
    </Card>
  );
}

function LocalCard({ index, providers }: { index: number; providers: Provider[] | undefined }) {
  const qc = useQueryClient();
  const { status, verify } = useVerify();
  const [servers, setServers] = useState<LanServer[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [address, setAddress] = useState("");
  const ai = s.onboarding.ai;

  const scan = async () => {
    setScanning(true);
    try {
      setServers(await api.lanScan());
    } catch (e) {
      toastError(s.providers.scanError, e, () => void scan());
    } finally {
      setScanning(false);
    }
  };

  const connectServer = async (srv: LanServer) => {
    try {
      const host = new URL(srv.baseUrl).hostname;
      const { provider } = await ensureProvider(providers, srv.kind, {
        name: `${s.providers.kinds[srv.kind]} (${host})`,
        baseUrl: srv.baseUrl,
        config: { models: srv.models, defaultModel: pickDefaultModel(srv.models) },
      });
      await qc.invalidateQueries({ queryKey: qk.providers });
      await verify(provider);
    } catch {
      /* shown by the test line */
    }
  };

  const connectAddress = async () => {
    const baseUrl = address.trim().replace(/\/+$/, "");
    if (!baseUrl) return;
    let created: Provider | null = null;
    try {
      const r = await ensureProvider(providers, "openai-compatible", { baseUrl });
      created = r.created ? r.provider : null;
      await verify(r.provider);
    } catch {
      if (created) await api.deleteProvider(created.id).catch(() => {});
    }
  };

  return (
    <Card
      title={ai.local.title}
      index={index}
      testId="ai-local"
      facts={[
        [ai.cost, ai.local.cost],
        [ai.leaves, ai.local.leaves],
        [ai.needs, ai.local.needs],
      ]}
    >
      <div>
        <Button variant="secondary" disabled={scanning} onClick={() => void scan()}>
          {ai.local.scan}
        </Button>
      </div>
      {scanning && (
        <p className="flex items-center gap-2 text-body text-muted">
          <ActivityOrb activity="search" size={20} />
          <ThinkingLine label={ai.local.scanning} />
        </p>
      )}
      {servers && !scanning && servers.length === 0 && <p className="text-body text-muted">{ai.local.none}</p>}
      {servers && servers.length > 0 && (
        <ul className="rounded-pane border border-border px-3 [&>*+*]:border-t [&>*+*]:border-divider">
          {servers.map((srv) => (
            <li key={srv.baseUrl} className="flex items-center gap-3 py-2">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{s.providers.kinds[srv.kind]}</span>
                <span className="truncate text-label text-muted">
                  {new URL(srv.baseUrl).host} · {s.providers.modelCount(srv.models.length)}
                </span>
              </span>
              <Button variant="secondary" size="sm" disabled={status.state === "testing"} onClick={() => void connectServer(srv)}>
                {ai.local.connect}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void connectAddress();
        }}
      >
        <div className="flex-1">
          <Label htmlFor="ob-address">{ai.local.address}</Label>
          <Input id="ob-address" value={address} placeholder="http://localhost:1234/v1" spellCheck={false} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <Button variant="secondary" type="submit" disabled={!address.trim() || status.state === "testing"}>
          {ai.local.connect}
        </Button>
      </form>
      <TestLine {...status} />
    </Card>
  );
}

function ConnectedList({ providers }: { providers: Provider[] }) {
  const qc = useQueryClient();
  const ai = s.onboarding.ai;
  const ready = providers.filter((p) => (p.config.models ?? []).length > 0);
  if (!ready.length) return null;
  return (
    <section aria-label={ai.connected} data-testid="ai-connected" className="flex flex-col gap-2">
      <h2 className="text-label font-semibold text-muted">{ai.connected}</h2>
      <ul className="rounded-card border border-border px-4 [&>*+*]:border-t [&>*+*]:border-divider">
        {ready.map((p) => {
          const models = p.config.models ?? [];
          const rec = recommendedModel(p.type, models);
          return (
            <li key={p.id} aria-label={p.name} className="flex items-center gap-3 py-3">
              <ProviderIcon type={p.type} baseUrl={p.baseUrl} size={20} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="text-label text-muted">{s.onboarding.ai.modelCount(models.length)}</span>
              </span>
              <NativeSelect
                aria-label={`${p.name}: ${ai.model}`}
                className="w-64"
                value={p.config.defaultModel ?? rec ?? ""}
                onChange={(e) =>
                  setChosenModel(p, e.target.value)
                    .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.providers }), qc.invalidateQueries({ queryKey: qk.settings })]))
                    .catch((err) => toastError(s.errors.generic, err))
                }
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m === rec ? ai.recommendedModel(m) : m}
                  </option>
                ))}
              </NativeSelect>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AiStep({ goNext }: { goNext: () => void }) {
  const { data: providers } = useProviders();
  const ai = s.onboarding.ai;
  return (
    <>
      <Heading title={ai.title} body={ai.body} />
      <div className="flex flex-col gap-3">
        <SubscriptionCard index={0} providers={providers} />
        <KeyCard index={1} providers={providers} />
        <LocalCard index={2} providers={providers} />
        <Card title={ai.skipCard.title} index={3} testId="ai-skip">
          <p className="-mt-1 text-body text-muted">{ai.skipCard.body}</p>
          <div>
            <Button variant="secondary" onClick={goNext}>
              {ai.skipCard.action}
            </Button>
          </div>
        </Card>
      </div>
      {providers && <ConnectedList providers={providers} />}
    </>
  );
}
