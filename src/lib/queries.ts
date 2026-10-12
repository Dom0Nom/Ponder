import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./ipc";
import { loadOpenRouterModels } from "./providers/openrouter";
import { toast } from "sonner";
import { s } from "./strings";
import type { SpacePatch } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

export const qk = {
  openrouterModels: ["openrouterModels"] as const,
  embeddingModels: ["embeddingModels"] as const,
  spaces: ["spaces"] as const,
  space: (id: string) => ["space", id] as const,
  sources: (spaceId: string) => ["sources", spaceId] as const,
  sourceText: (id: string) => ["sourceText", id] as const,
  threads: (spaceId: string) => ["threads", spaceId] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  journal: (spaceId: string) => ["journal", spaceId] as const,
  providers: ["providers"] as const,
  settings: ["settings"] as const,
  memory: ["memory"] as const,
  cards: (spaceId: string) => ["cards", spaceId] as const,
  due: (spaceId: string | null) => ["due", spaceId] as const,
  dueCounts: ["dueCounts"] as const,
  mistakes: (spaceId: string | null) => ["mistakes", spaceId] as const,
  curriculum: (spaceId: string) => ["curriculum", spaceId] as const,
  levels: (spaceId: string) => ["levels", spaceId] as const,
  coverage: (spaceId: string) => ["coverage", spaceId] as const,
  assessments: (spaceId: string) => ["assessments", spaceId] as const,
  courses: (spaceId: string) => ["courses", spaceId] as const,
  studyPlan: (spaceId: string) => ["studyPlan", spaceId] as const,
  planTasks: ["planTasks"] as const,
  focusHistory: (spaceId: string | null) => ["focusHistory", spaceId] as const,
  microSteps: (spaceId: string | null) => ["microSteps", spaceId] as const,
  parking: (sessionId: string | null) => ["parking", sessionId] as const,
  watched: (spaceId: string) => ["watched", spaceId] as const,
  capture: ["capture"] as const,
  music: ["music"] as const,
};

export const useSpaces = () => useQuery({ queryKey: qk.spaces, queryFn: api.listSpaces });
export const useSpace = (id: string) => useQuery({ queryKey: qk.space(id), queryFn: () => api.getSpace(id), enabled: !!id });
export const useSources = (spaceId: string) =>
  useQuery({ queryKey: qk.sources(spaceId), queryFn: () => api.listSources(spaceId) });
export const useThreads = (spaceId: string) =>
  useQuery({ queryKey: qk.threads(spaceId), queryFn: () => api.listThreads(spaceId) });
export const useMessages = (threadId: string | undefined) =>
  useQuery({
    queryKey: qk.messages(threadId ?? ""),
    queryFn: () => api.listMessages(threadId!),
    enabled: !!threadId,
  });
export const useJournal = (spaceId: string) =>
  useQuery({ queryKey: qk.journal(spaceId), queryFn: () => api.listJournal(spaceId) });
export const useProviders = () => useQuery({ queryKey: qk.providers, queryFn: api.listProviders });

/** OpenRouter's model list (disk-cached by the backend); only fetched while `enabled`. */
export const useOpenRouterModels = (enabled: boolean) =>
  useQuery({ queryKey: qk.openrouterModels, queryFn: () => loadOpenRouterModels(), enabled, staleTime: 60 * 60_000, retry: false });
export const useSettings = () => useQuery({ queryKey: qk.settings, queryFn: api.getSettings });

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SpacePatch }) => api.updateSpace(id, patch),
    onSuccess: (space) => {
      qc.setQueryData(qk.space(space.id), space);
      qc.invalidateQueries({ queryKey: qk.spaces });
    },
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return async (id: string) => {
    await api.deleteSpace(id);
    qc.invalidateQueries({ queryKey: qk.spaces });
    toast.success(s.space.deleted);
  };
}

export function usePinThread(spaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => api.pinThread(id, pinned),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads(spaceId) }),
  });
}

export function useSetSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) => api.setSetting(key, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.settings }),
  });
}

export const useMemory = () => useQuery({ queryKey: qk.memory, queryFn: api.listMemory });
export const useCurriculum = (spaceId: string) =>
  useQuery({ queryKey: qk.curriculum(spaceId), queryFn: () => api.curriculumGet(spaceId) });
export const useLevels = (spaceId: string) => useQuery({ queryKey: qk.levels(spaceId), queryFn: () => api.topicLevels(spaceId) });
export const useCourses = (spaceId: string) => useQuery({ queryKey: qk.courses(spaceId), queryFn: () => api.coursesList(spaceId) });
export const useStudyPlan = (spaceId: string) => useQuery({ queryKey: qk.studyPlan(spaceId), queryFn: () => api.getStudyPlan(spaceId) });
/** Every scheduled task across spaces; the Today view and palette derive from it. */
export const useAllPlanTasks = () =>
  useQuery({ queryKey: [...qk.planTasks, "all"], queryFn: () => api.listPlanTasks("0000-01-01", "9999-12-31") });
export const useWatchedFolders = (spaceId: string) =>
  useQuery({ queryKey: qk.watched(spaceId), queryFn: () => api.watchList(spaceId) });
export const useMusicStatus = () => useQuery({ queryKey: qk.music, queryFn: api.musicStatus });
export const useCaptureStatus = () => useQuery({ queryKey: qk.capture, queryFn: api.captureStatus });
export const useCards = (spaceId: string) => useQuery({ queryKey: qk.cards(spaceId), queryFn: () => api.cardsList(spaceId) });
export const useDueCounts = () => useQuery({ queryKey: qk.dueCounts, queryFn: api.cardsDueCounts, refetchInterval: 60_000 });
export const useMistakes = (spaceId: string | null) =>
  useQuery({ queryKey: qk.mistakes(spaceId), queryFn: () => api.mistakesList(spaceId) });

export function invalidateCards(spaceId?: string) {
  for (const k of [qk.dueCounts, ["due"], ["mistakes"]]) queryClient.invalidateQueries({ queryKey: k });
  if (spaceId) queryClient.invalidateQueries({ queryKey: qk.cards(spaceId) });
}

/** First site in `hosts` that yields an icon (data URL). The backend caches on disk, so this runs once per host ever. */
export function useSiteIcon(hosts: string[]): string | null {
  const key = hosts.join(",");
  const q = useQuery({
    queryKey: ["siteIcon", key],
    enabled: hosts.length > 0,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async () => {
      for (const h of hosts) {
        const url = await api.siteIcon(h).catch(() => null);
        if (url) return url;
      }
      return null;
    },
  });
  return q.data ?? null;
}
