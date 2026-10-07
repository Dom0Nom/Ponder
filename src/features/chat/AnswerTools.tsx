import { useState } from "react";
import { Brain, CheckCircle2, CircleAlert, CircleHelp, CircleX, Columns2, Scale, ShieldCheck } from "lucide-react";
import { api } from "../../lib/ipc";
import { queryClient, qk, useProviders, useSettings } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { ClaimVerdict, Message, ModelRef, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { selfCheck } from "../../lib/chat/selfCheck";
import { secondOpinion } from "../../lib/chat/secondOpinion";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Spinner, Tooltip } from "../../components/ui/misc";
import { PonderMark } from "../../components/brand/PonderMark";
import { toast, toastError } from "../../components/ui/toast";
import { actionIconBtn } from "./actionButton";
import { ModelPicker } from "../settings/ModelPicker";
import { Markdown } from "./Markdown";

const VERDICT: Record<ClaimVerdict, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  supported: { label: s.check.supported, icon: CheckCircle2, tone: "text-success" },
  partly: { label: s.check.partly, icon: CircleHelp, tone: "text-warn" },
  unsupported: { label: s.check.unsupported, icon: CircleAlert, tone: "text-warn" },
  contradicted: { label: s.check.contradicted, icon: CircleX, tone: "text-danger" },
};

export function CheckButton({ message, space }: { message: Message; space: Space }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const llm = await resolveChatModel(space);
      const check = await selfCheck(message.content, message.citations ?? [], llm);
      await api.updateMessage(message.id, { meta: { ...message.meta, check } });
      queryClient.invalidateQueries({ queryKey: qk.messages(message.threadId) });
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.check.failed, e, run);
    } finally {
      setBusy(false);
    }
  };
  if (!message.citations?.length) return null;
  return (
    <Tooltip content={s.check.run} description={s.check.desc} side="top">
      <button aria-label={s.check.run} disabled={busy} onClick={run} className={actionIconBtn}>
        {busy ? <Spinner size={14} /> : <ShieldCheck size={14} />}
      </button>
    </Tooltip>
  );
}

export function CheckResults({ message }: { message: Message }) {
  const check = message.meta?.check;
  const openViewer = useUi((st) => st.openViewer);
  if (!check) return null;
  const byN = new Map((message.citations ?? []).map((c) => [c.n, c]));
  const counts = check.items.reduce<Record<string, number>>((acc, i) => ({ ...acc, [i.verdict]: (acc[i.verdict] ?? 0) + 1 }), {});
  return (
    <div className="rounded-pane border border-border px-4 py-3" data-testid="self-check">
      <p className="flex flex-wrap items-center gap-x-2 text-label font-semibold text-muted">
        <ShieldCheck size={13} /> {s.check.title}
        <span className="font-normal text-faint">
          {(["supported", "partly", "unsupported", "contradicted"] as const)
            .filter((v) => counts[v])
            .map((v) => `${counts[v]} ${VERDICT[v].label.toLowerCase()}`)
            .join(" · ")}
        </span>
      </p>
      {check.items.length === 0 && <p className="mt-2 text-xs text-muted">{s.check.noClaims}</p>}
      <ul className="mt-2 space-y-1.5">
        {check.items.map((item, i) => {
          const v = VERDICT[item.verdict];
          return (
            <li key={i} className="flex gap-2 text-[0.8125rem]">
              <v.icon size={15} className={cn("mt-0.5 shrink-0", v.tone)} aria-label={v.label} />
              <div className="min-w-0">
                <span>{item.claim}</span>
                {item.passages.map((n) => {
                  const c = byN.get(n);
                  return c ? (
                    <button
                      key={n}
                      onClick={() => openViewer({ sourceId: c.sourceId, start: c.start, end: c.end })}
                      className="mx-0.5 inline-flex h-[1.05rem] min-w-[1.05rem] items-center justify-center rounded-full bg-chip px-1 text-[0.625rem] font-semibold text-fg"
                    >
                      {n}
                    </button>
                  ) : null;
                })}
                {item.note && <span className="block text-xs text-muted">{item.note}</span>}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[0.6875rem] text-faint">{s.check.byModel(check.model.model)}</p>
    </div>
  );
}

export function SecondOpinionButton({ message, space }: { message: Message; space: Space }) {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState<ModelRef | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: providers } = useProviders();
  const { data: settings } = useSettings();

  const openDialog = () => {
    const current = message.meta?.model;
    // preselect a model that differs from the one that answered
    const candidates = (providers ?? []).flatMap((p) =>
      (p.config.models ?? (p.config.defaultModel ? [p.config.defaultModel] : [])).map((m) => ({ providerId: p.id, model: m })),
    );
    const other = candidates.find(
      (c) => (c.providerId !== current?.providerId || c.model !== current?.model) && !/embed/i.test(c.model),
    );
    setModel(other ?? (settings?.defaultModel as ModelRef | undefined) ?? null);
    setOpen(true);
  };

  const run = async () => {
    if (!model) return;
    setBusy(true);
    setOpen(false);
    try {
      await secondOpinion(space, message, model);
    } catch (e) {
      toastError(s.secondOpinion.failed, e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip content={s.secondOpinion.run} description={s.secondOpinion.desc} side="top">
        <button aria-label={s.secondOpinion.run} disabled={busy} onClick={openDialog} className={actionIconBtn}>
          {busy ? <Spinner size={14} /> : <Scale size={14} />}
        </button>
      </Tooltip>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={s.secondOpinion.title}
        description={s.secondOpinion.body}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {s.common.cancel}
            </Button>
            <Button variant="primary" disabled={!model} onClick={run}>
              {s.secondOpinion.ask}
            </Button>
          </>
        }
      >
        <div className="pb-3">
          <ModelPicker value={model} onChange={setModel} />
        </div>
      </Dialog>
    </>
  );
}

export function SecondOpinions({
  original,
  seconds,
  live,
  renderAnswer,
}: {
  original: Message;
  seconds: Message[];
  live: Record<string, { content: string; reasoning: string }>;
  renderAnswer: (m: Message, content: string) => React.ReactNode;
}) {
  const [compare, setCompare] = useState<Message | null>(null);
  if (!seconds.length) return null;
  return (
    <div className="space-y-3">
      {seconds.map((m) => {
        const content = live[m.id]?.content ?? m.content;
        const streaming = m.status === "streaming" && !!live[m.id];
        return (
          <div key={m.id} className="rounded-pane bg-fill px-4 py-3" data-testid="second-opinion">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted">
              <Scale size={13} /> {s.secondOpinion.label(m.meta?.model?.model ?? "")}
              {streaming && <PonderMark size={20} state="generating" />}
              {!streaming && m.status === "complete" && (
                <button
                  onClick={() => setCompare(m)}
                  className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-fill-active hover:text-fg"
                >
                  <Columns2 size={13} /> {s.secondOpinion.compare}
                </button>
              )}
            </div>
            {m.status === "error" ? (
              <p className="text-sm text-danger">{m.error}</p>
            ) : content ? (
              renderAnswer(m, content)
            ) : (
              <p className="text-sm text-muted">{s.chat.thinking}…</p>
            )}
          </div>
        );
      })}
      <Dialog
        open={!!compare}
        onOpenChange={(o) => !o && setCompare(null)}
        title={s.secondOpinion.compareTitle}
        className="w-[min(1200px,calc(100vw-48px))]"
      >
        {compare && (
          <div className="grid grid-cols-2 gap-4 pb-4">
            {[original, compare].map((m) => (
              <div key={m.id} className="min-w-0 rounded-card border border-border p-4">
                <p className="mb-2 text-xs font-medium text-muted">{m.meta?.model?.model ?? ""}</p>
                {renderAnswer(m, m.content)}
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function RememberedChips({ message }: { message: Message }) {
  const navigate = useUi((st) => st.navigate);
  const facts = message.meta?.remembered;
  if (!facts?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {facts.map((f) => (
        <span key={f} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-fill px-2.5 py-1 text-xs text-muted">
          <Brain size={12} className="shrink-0" />
          <span className="truncate">
            {s.memory.remembered}: {f}
          </span>
          <button
            className="shrink-0 font-medium text-fg underline-offset-2 hover:underline"
            onClick={() => navigate({ name: "settings", section: "memory" })}
          >
            {s.common.edit}
          </button>
          <button
            className="shrink-0 font-medium text-fg underline-offset-2 hover:underline"
            onClick={async () => {
              try {
                const items = await api.listMemory();
                const hit = items.find((i) => i.text === f);
                if (hit) await api.deleteMemory(hit.id);
                await api.updateMessage(message.id, {
                  meta: { ...message.meta, remembered: facts.filter((x) => x !== f) },
                });
                queryClient.invalidateQueries({ queryKey: qk.memory });
                queryClient.invalidateQueries({ queryKey: qk.messages(message.threadId) });
                toast.success(s.memory.forgot);
              } catch (e) {
                toastError(s.errors.generic, e);
              }
            }}
          >
            {s.memory.forget}
          </button>
        </span>
      ))}
    </div>
  );
}

export { Markdown };
