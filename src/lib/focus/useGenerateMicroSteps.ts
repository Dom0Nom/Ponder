import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../chat/llm";
import { api } from "../ipc";
import { qk } from "../queries";
import { s } from "../strings";
import { generateMicroSteps } from "./microSteps";

/** Breaks a goal into micro-steps for a space and stores them. Resolves to the step count, or null on failure. */
export function useGenerateMicroSteps(spaceId: string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const generate = async (goal: string, sessionId: string | null = null): Promise<number | null> => {
    setBusy(true);
    try {
      const [space, sources] = await Promise.all([api.getSpace(spaceId), api.listSources(spaceId)]);
      const llm = await resolveChatModel(space);
      const steps = await generateMicroSteps(llm, {
        goal,
        spaceName: space.name,
        sourceTitles: sources.filter((x) => x.status === "ready").map((x) => x.title),
      });
      await api.microStepsReplace(spaceId, sessionId, goal, steps);
      await qc.invalidateQueries({ queryKey: qk.microSteps(spaceId) });
      return steps.length;
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.focus.micro.failed, e, () => void generate(goal, sessionId));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { generate, busy };
}
