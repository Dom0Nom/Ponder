import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./ipc";
import type { SpacePatch } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 5_000 },
  },
});

export const qk = {
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
  curriculum: (spaceId: string) => ["curriculum", spaceId] as const,
  levels: (spaceId: string) => ["levels", spaceId] as const,
  coverage: (spaceId: string) => ["coverage", spaceId] as const,
  assessments: (spaceId: string) => ["assessments", spaceId] as const,
  courses: (spaceId: string) => ["courses", spaceId] as const,
  focusHistory: (spaceId: string | null) => ["focusHistory", spaceId] as const,
  parking: (sessionId: string | null) => ["parking", sessionId] as const,
};

export const useSpaces = () => useQuery({ queryKey: qk.spaces, queryFn: api.listSpaces });
export const useSpace = (id: string) => useQuery({ queryKey: qk.space(id), queryFn: () => api.getSpace(id) });
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
