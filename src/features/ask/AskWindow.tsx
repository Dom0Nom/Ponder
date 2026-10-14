import { useCallback, useEffect, useRef, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Tip from "@radix-ui/react-tooltip";
import { AlertCircle, ArrowUp, Check, Copy, CornerDownRight, Crop, FilePlus2, Square, X } from "lucide-react";
import { useApplyAppearance } from "../../app/useTheme";
import { api, events } from "../../lib/ipc";
import { qk, queryClient, useSpaces } from "../../lib/queries";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { describeError, runTurn } from "../../lib/chat/runner";
import { plainAnswer } from "../../lib/chat/plainAnswer";
import { threadTitleFrom } from "../../lib/chat/context";
import { describeSnip, imageFromSnip, snipPreviewUrl } from "../../lib/ask/snip";
import { looksVisionCapable, resolveVisionModel } from "../../lib/steps/vision";
import { s } from "../../lib/strings";
import { LocaleKey } from "../../lib/i18n/LocaleKey";
import type { Citation, Message, SnipImage } from "../../lib/types";
import { useChatStream } from "../../stores/chatStream";
import { Button } from "../../components/ui/button";
import { Spinner } from "../../components/ui/misc";
import { GeneratingStatus } from "../../components/brand/GeneratingStatus";
import { ActivityOrb } from "../../components/motion/ActivityOrb";
import { AnswerBody } from "../chat/MessageView";
import { defaultCaptureSpace } from "../capture/QuickCaptureDialog";
import { NativeSelect } from "../settings/NativeSelect";

const THREAD = "ask-overlay";

interface Exchange {
  question: string;
  hadImage: boolean;
  assistant: Message | null;
  final: Message | null;
  error: string | null;
}

/** Entry for the overlay window (`?window=ask`): one question box that answers from a space's sources. */
export function AskWindow() {
  useApplyAppearance();
  return (
    <QueryClientProvider client={queryClient}>
      <LocaleKey>
        <Tip.Provider>
          <AskCard />
        </Tip.Provider>
      </LocaleKey>
    </QueryClientProvider>
  );
}

function AskCard() {
  const spaces = useSpaces();
  const refetchSpaces = spaces.refetch;
  const [text, setText] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [snip, setSnip] = useState<SnipImage | null>(null);
  const [snipping, setSnipping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exchange, setExchange] = useState<Exchange | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savingSource, setSavingSource] = useState(false);
  const [savedSource, setSavedSource] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const askId = useRef(0);
  const snippingRef = useRef(false);
  const savingRef = useRef(false);
  const hadFocus = useRef(false);

  const list = spaces.data;
  const space = list?.find((x) => x.id === spaceId) ?? null;
  const live = useChatStream((st) => (exchange?.assistant ? st.live[exchange.assistant.id] : undefined));
  const searching = useChatStream((st) => st.phase[THREAD] === "search");
  const answer = exchange?.final ?? exchange?.assistant ?? null;
  const content = live?.content ?? answer?.content ?? "";
  const streaming = busy && !!exchange?.assistant;

  const close = useCallback(() => {
    void api.askClose().catch(() => {});
  }, []);

  const reset = useCallback(() => {
    askId.current++;
    useChatStream.getState().stop(THREAD);
    setText("");
    setSnip(null);
    setExchange(null);
    setNotice(null);
    setSavedSource(null);
    setBusy(false);
    setCopied(false);
    setSpaceId(null);
    void refetchSpaces().then((r) => {
      if (r.data) setSpaceId((cur) => cur ?? defaultCaptureSpace(r.data, null));
    });
    requestAnimationFrame(() => input.current?.focus());
  }, [refetchSpaces]);

  const takeSnip = useCallback(async () => {
    if (snippingRef.current) return;
    snippingRef.current = true;
    setSnipping(true);
    setNotice(null);
    try {
      const shot = await api.snipScreen();
      if (shot) {
        setSnip(shot);
        setSavedSource(null);
      }
    } catch (e) {
      setNotice(`${s.ask.snipFailed}: ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}`);
    } finally {
      snippingRef.current = false;
      setSnipping(false);
      input.current?.focus();
    }
  }, []);

  const startPending = useCallback(() => {
    void api
      .askTakePending()
      .then((snipFirst) => {
        if (snipFirst) void takeSnip();
      })
      .catch(() => {});
  }, [takeSnip]);

  useEffect(() => {
    reset();
    startPending();
    const off = events.askOpen(() => {
      reset();
      startPending();
    });
    return () => {
      void off.then((f) => f()).catch(() => {});
    };
  }, [reset, startPending]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const onFocus = () => (hadFocus.current = true);
    const onBlur = () => {
      if (hadFocus.current && !snippingRef.current && !savingRef.current) close();
    };
    if (document.hasFocus()) hadFocus.current = true;
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, [close]);

  useEffect(() => {
    const el = card.current;
    if (!el) return;
    const send = () => void api.askSetHeight(Math.ceil(el.getBoundingClientRect().height)).catch(() => {});
    const ro = new ResizeObserver(send);
    ro.observe(el);
    send();
    return () => ro.disconnect();
  }, []);

  const ask = async () => {
    if (!space || busy) return;
    const question = text.trim() || (snip ? s.ask.defaultImageQuestion : "");
    if (!question) return;
    const image = snip ? imageFromSnip(snip) : undefined;
    const my = ++askId.current;
    const stale = () => my !== askId.current;
    setBusy(true);
    setNotice(null);
    setSavedSource(null);
    setCopied(false);
    setExchange({ question, hadImage: !!image, assistant: null, final: null, error: null });
    try {
      const llm = image ? await resolveVisionModel(space) : await resolveChatModel(space);
      if (stale()) return;
      if (image && !looksVisionCapable(llm.provider, llm.modelId)) setNotice(s.ask.noVision);
      const final = await runTurn({
        space,
        threadId: THREAD,
        tutorStyle: space.tutorStyle,
        focus: null,
        userText: question,
        image,
        llm,
        ephemeral: true,
        onStart: (assistant) => {
          if (stale()) useChatStream.getState().stop(THREAD);
          else setExchange((x) => (x ? { ...x, assistant } : x));
        },
      });
      if (stale()) return;
      setExchange((x) => (x ? { ...x, final, error: final.status === "error" ? (final.error ?? s.ask.failed) : null } : x));
    } catch (e) {
      if (!stale()) setExchange((x) => (x ? { ...x, error: e instanceof NoModelError ? s.chat.noModel : describeError(e) } : x));
    } finally {
      if (!stale()) setBusy(false);
    }
  };

  const stopAsk = () => {
    if (exchange?.assistant) return useChatStream.getState().stop(THREAD);
    askId.current++;
    setBusy(false);
    setExchange(null);
  };

  const saveAsSource = async () => {
    if (!space || !snip || savingRef.current) return;
    savingRef.current = true;
    setSavingSource(true);
    setNotice(null);
    try {
      const llm = await resolveVisionModel(space);
      const { title, body } = await describeSnip(llm, imageFromSnip(snip));
      await api.importText(space.id, title, body, "text", "screen-snip");
      queryClient.invalidateQueries({ queryKey: qk.sources(space.id) });
      queryClient.invalidateQueries({ queryKey: qk.spaces });
      setSavedSource(s.ask.sourceSaved(space.name));
      setSnip(null);
    } catch (e) {
      setNotice(`${s.ask.sourceFailed}: ${e instanceof NoModelError ? s.chat.noModel : describeError(e)}`);
    } finally {
      savingRef.current = false;
      setSavingSource(false);
    }
  };

  const openInPonder = async (cite?: Citation) => {
    const done = exchange?.final;
    if (!space || !exchange || !done || opening) return;
    setOpening(true);
    try {
      const thread = await api.createThread(space.id, threadTitleFrom(exchange.question));
      await api.addMessage({ threadId: thread.id, role: "user", content: exchange.question });
      await api.addMessage({
        threadId: thread.id,
        role: "assistant",
        content: done.content,
        reasoning: done.reasoning,
        citations: done.citations,
        meta: done.meta,
        status: "complete",
      });
      await api.askOpenInMain({
        spaceId: space.id,
        threadId: thread.id,
        sourceId: cite?.sourceId ?? null,
        start: cite?.start ?? null,
        end: cite?.end ?? null,
      });
    } catch (e) {
      setNotice(`${s.ask.openFailed}: ${e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)}`);
      setOpening(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainAnswer(content));
    } catch (e) {
      setNotice(`${s.ask.copyFailed}: ${describeError(e)}`);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const noSpaces = !!list && list.length === 0;
  const canAsk = !!space && !busy && (text.trim().length > 0 || !!snip);
  const finished = !!exchange?.final && !busy && !exchange.error;

  return (
    <div className="h-screen overflow-hidden bg-surface text-fg">
      <div ref={card} className="flex flex-col">
        <form
          className="flex items-center gap-2 px-4 pb-2 pt-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <input
            ref={input}
            autoFocus
            aria-label={s.ask.inputLabel}
            placeholder={s.ask.placeholder}
            value={text}
            disabled={noSpaces}
            onChange={(e) => setText(e.target.value)}
            className="h-10 min-w-0 flex-1 bg-transparent text-section outline-none placeholder:text-faint focus-visible:outline-none"
          />
          {busy ? (
            <Button size="icon" variant="secondary" aria-label={s.ask.stop} onClick={stopAsk}>
              <Square size={13} />
            </Button>
          ) : (
            <Button type="submit" size="icon" variant="primary" aria-label={s.ask.ask} disabled={!canAsk}>
              <ArrowUp size={16} />
            </Button>
          )}
        </form>

        <div className="flex items-center gap-2 px-4 pb-3">
          {spaces.isLoading && <Spinner />}
          {spaces.error && (
            <span role="alert" className="text-label text-danger-text">
              {s.ask.loadError}
            </span>
          )}
          {noSpaces && <p className="text-label text-muted">{s.ask.noSpaces}</p>}
          {list && list.length > 0 && (
            <NativeSelect
              aria-label={s.ask.space}
              className="w-48"
              value={spaceId ?? ""}
              onChange={(e) => {
                setSpaceId(e.target.value);
                setSavedSource(null);
              }}
            >
              {list.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <Button size="lg" variant="ghost" className="ms-auto" disabled={snipping || busy} onClick={takeSnip}>
            {snipping ? <Spinner /> : <Crop size={15} />} {snipping ? s.ask.snipping : s.ask.snip}
          </Button>
        </div>

        {snip && (
          <div className="flex items-center gap-3 border-t border-divider px-4 py-3" data-testid="ask-snip">
            <img src={snipPreviewUrl(snip)} alt={s.ask.snipAlt} className="h-14 max-w-40 rounded-item border border-border bg-fill-subtle object-contain" />
            <Button size="sm" variant="secondary" disabled={savingSource || !space} onClick={saveAsSource}>
              {savingSource ? <Spinner /> : <FilePlus2 size={14} />} {savingSource ? s.ask.savingSource : s.ask.saveAsSource}
            </Button>
            <Button size="icon-sm" variant="ghost-muted" className="ms-auto" aria-label={s.ask.removeSnip} onClick={() => setSnip(null)}>
              <X size={14} />
            </Button>
          </div>
        )}

        {savedSource && (
          <p role="status" className="flex items-center gap-2 border-t border-divider px-4 py-3 text-label font-medium text-fg-secondary" data-testid="ask-source-saved">
            <Check size={14} /> {savedSource}
          </p>
        )}

        {notice && (
          <p role="alert" className="flex items-start gap-2 border-t border-divider px-4 py-3 text-label text-danger-text" data-testid="ask-notice">
            <AlertCircle size={14} className="mt-0.5 shrink-0" /> <span className="min-w-0 break-words">{notice}</span>
          </p>
        )}

        {exchange && (
          <div className="max-h-[420px] overflow-y-auto border-t border-divider px-4 py-3.5 text-input leading-[1.6]" data-testid="ask-answer">
            {searching && (
              <span className="inline-flex items-center gap-2 text-label font-medium text-fg-secondary">
                <ActivityOrb activity="search" size={16} /> {s.ask.searching}
              </span>
            )}
            {!searching && streaming && !content && <GeneratingStatus label={s.ask.thinking} />}
            {answer && content && (
              <AnswerBody
                content={content}
                citations={answer.citations ?? []}
                streaming={streaming}
                spaceId={space?.id}
                onOpenCitation={(c) => void openInPonder(c)}
              />
            )}
            {exchange.error && (
              <p role="alert" className="flex items-start gap-2 text-danger-text" data-testid="ask-error">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{s.ask.failed}</span>
                  <span className="block text-muted">{exchange.error}</span>
                </span>
              </p>
            )}
          </div>
        )}

        {finished && (
          <div className="flex items-center gap-1.5 border-t border-divider px-3 py-2">
            <Button size="sm" variant="primary" disabled={opening} onClick={() => void openInPonder()}>
              <CornerDownRight size={14} /> {s.ask.openInPonder}
            </Button>
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? s.ask.copied : s.ask.copy}
            </Button>
          </div>
        )}

        {!exchange && !snip && !noSpaces && !notice && !savedSource && (
          <p className="px-4 pb-3.5 text-label text-muted">{space && space.sourceCount === 0 ? s.ask.noSources : s.ask.hint}</p>
        )}
      </div>
    </div>
  );
}
