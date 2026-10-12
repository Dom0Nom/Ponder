import type { BuddyEventKind, FocusState, ParkingItem } from "../types";

const mins = (ms: number | null | undefined) => Math.max(0, Math.round((ms ?? 0) / 60000));

/** Static hyperfocus nudge: no model call. Uses a break-menu idea when the learner has one. */
export function hyperfocusNote(s: FocusState | null, breakMenu: string[], pick = Math.random): string {
  const idea = breakMenu.length ? breakMenu[Math.floor(pick() * breakMenu.length)].trim() : "";
  const head = `${mins(s?.elapsedMs)} min of focus.`;
  return idea ? `${head} Time for a break? ${idea.replace(/[.!?]+$/, "")}.` : `${head} Time for water and a stretch?`;
}

/** Short visible note shown in the chat for each buddy event. */
export function buddyNote(kind: BuddyEventKind, s: FocusState | null, prev: FocusState | null): string {
  switch (kind) {
    case "session-start":
      return s?.goal ? `Focus session started. Goal: ${s.goal}` : "Focus session started";
    case "check-in":
      return `Check-in · ${mins(s?.elapsedMs)} min into block ${s?.block ?? 1}`;
    case "recall":
      return `${mins(s?.remainingMs)} min until your break · quick recall`;
    case "block-quiz":
      return `Block ${prev?.block ?? s?.block ?? 1} done · mini quiz before your break`;
    case "break-start":
      return "Break started";
    case "post-break":
      return `Back from your break · block ${s?.block ?? ""}`.trim();
    case "hyperfocus":
      return hyperfocusNote(s, []);
    case "session-summary":
      return "Session ended · summary saved to the journal";
  }
}

/** Instruction for the AI turn that follows a buddy note. */
export function buddyInstruction(kind: BuddyEventKind, ctx: Parameters<typeof eventInstruction>[1]): string {
  const text = eventInstruction(kind, ctx);
  return text && `${text} Plain, warm tone: no opening praise, no emoji, no {{followup}} suggestions.`;
}

function eventInstruction(
  kind: BuddyEventKind,
  ctx: {
    state: FocusState | null;
    previous: FocusState | null;
    parking: ParkingItem[];
    needAppPauses: number;
    /** first unchecked "Where do I start" micro-step */
    currentStep?: string | null;
  },
): string {
  const s = ctx.state;
  const low = (ctx.state ?? ctx.previous)?.energy === "low";
  switch (kind) {
    case "session-start":
      if (low) {
        return [
          "A low-energy focus session just started: the learner picked review-only because they have little energy today.",
          s?.goal ? `Their goal: "${s.goal}".` : "",
          "Do NOT ask the 3-question check-in. Say one warm sentence acknowledging the low-energy choice, then propose a short review-only plan in 2–3 bullets (review due flashcards, re-test a few past mistakes, re-read something light). No new material. Under 70 words.",
        ]
          .filter(Boolean)
          .join(" ");
      }
      return [
        "A focus session just started.",
        s?.goal ? `The learner's goal: "${s.goal}".` : "The learner didn't set a goal.",
        s?.remainingMs != null ? `This block is ${mins(s.phaseDurationMs)} min.` : "This is an open-ended block.",
        "Do a 3-question check-in in one short message: energy level (1–5), how much time they have today, and what exactly they want to finish in this block. Then propose a concrete plan for this block in 2–4 short bullet points sized to the time. Keep it under 110 words: the three questions as a numbered list, then the plan.",
      ].join(" ");
    case "check-in":
      if (low) {
        return "Low-energy session: a gentle check-in in one short sentence. Ask how they're doing, and say it's fine to stop or take a break whenever. No new material, no pressure.";
      }
      return [
        "Body-doubling check-in. In one or two sentences, ask how it's going and whether they're stuck, referring to what they were working on in this chat. No lecture, no new material.",
        ctx.currentStep ? `Their current micro-step is "${ctx.currentStep}"; ask whether it's done or what's blocking it.` : "",
      ]
        .filter(Boolean)
        .join(" ");
    case "recall":
      return `About ${mins(s?.remainingMs)} minutes are left before the break. Ask 1–2 quick recall questions about what was covered in this block (answerable in under a minute). Don't start anything long.`;
    case "block-quiz":
      if (low) {
        return [
          "The low-energy review block just ended and the break starts now.",
          "Write a 2-question mini quiz with two EASY recall questions on what was reviewed, answers hidden below a line '---'. Encouraging tone, no application or new-material questions.",
          ctx.parking.length ? `List briefly under "Parked for later": ${ctx.parking.map((p) => `"${p.text}"`).join(", ")}.` : "",
          "Keep it very short.",
        ]
          .filter(Boolean)
          .join(" ");
      }
      return [
        "The focus block just ended and the break starts now.",
        "Write a 3-question mini quiz on what this block covered (mix of recall and one application question), answers hidden below a line '---' so the learner can check after the break.",
        ctx.parking.length
          ? `They parked these thoughts during the block; list them briefly under "Parked for later": ${ctx.parking.map((p) => `"${p.text}"`).join(", ")}.`
          : "",
        "Keep it short.",
      ].join(" ");
    case "post-break":
      return [
        "The learner is back from the break.",
        ctx.needAppPauses > 0
          ? `They interrupted the break ${ctx.needAppPauses} time(s) with "I need the app"; mention gently that real breaks help memory, without guilt.`
          : "",
        "Give a 3-bullet recap of where they left off and the next concrete step for this block. Under 90 words.",
      ].join(" ");
    case "session-summary":
      return [
        "The focus session ended.",
        low ? "It was a low-energy review-only session; say so in the summary and praise showing up." : "",
        ctx.previous
          ? `Totals: ${mins(ctx.previous.totalFocusMs)} min focus over ${ctx.previous.block} block(s), ${ctx.previous.pauseCount} pause(s), ${ctx.needAppPauses} break interruption(s).`
          : "",
        ctx.previous?.goal ? `Goal was: "${ctx.previous.goal}".` : "",
        "Write a session summary for the learner's journal in Markdown: what was covered, what seemed solid, what to review next time (2–4 bullets each), and one sentence on the goal. Under 180 words. No preamble.",
      ].join(" ");
    default:
      return "";
  }
}
