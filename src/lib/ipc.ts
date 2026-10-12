import { Channel, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type * as T from "./types";

/** Normalizes anything thrown by invoke into an Error with a readable message. */
export function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (e && typeof e === "object" && "message" in e) {
    const err = new Error(String((e as T.AppError).message));
    (err as Error & { code?: string }).code = (e as T.AppError).code;
    return err;
  }
  return new Error(String(e));
}

async function call<R>(cmd: string, args?: Record<string, unknown>): Promise<R> {
  try {
    const mock = (window as unknown as { __MOCK_INVOKE__?: (c: string, a?: unknown) => Promise<unknown> }).__MOCK_INVOKE__;
    return mock ? ((await mock(cmd, args)) as R) : await invoke<R>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}

export const api = {
  // spaces
  listSpaces: () => call<T.Space[]>("list_spaces"),
  getSpace: (id: string) => call<T.Space>("get_space", { id }),
  createSpace: (input: T.SpacePatch) => call<T.Space>("create_space", { input }),
  updateSpace: (id: string, patch: T.SpacePatch) => call<T.Space>("update_space", { id, patch }),
  touchSpace: (id: string) => call<void>("touch_space", { id }),
  deleteSpace: (id: string) => call<void>("delete_space", { id }),

  // sources
  listSources: (spaceId: string) => call<T.Source[]>("list_sources", { spaceId }),
  getSource: (id: string) => call<T.Source>("get_source", { id }),
  updateSource: (id: string, patch: { title?: string; useInChat?: boolean; summary?: string }) =>
    call<T.Source>("update_source", { id, patch }),
  deleteSource: (id: string) => call<void>("delete_source", { id }),
  getSourceText: (id: string) => call<T.SourceText>("get_source_text", { id }),
  importFile: (spaceId: string, path: string) => call<T.Source>("import_file", { spaceId, path }),
  importText: (
    spaceId: string,
    title: string,
    text: string,
    kind: T.SourceKind,
    origin?: string | null,
  ) => call<T.Source>("import_text", { spaceId, title, text, kind, origin: origin ?? null }),
  reindexSource: (id: string) => call<T.Source>("reindex_source", { id }),
  searchChunks: (spaceId: string, query: string, limit?: number, sourceIds?: string[]) =>
    call<T.SearchHit[]>("search_chunks", { spaceId, query, limit: limit ?? null, sourceIds: sourceIds ?? null }),
  embedderStatus: () => call<T.EmbedderStatus>("embedder_status"),
  embeddingModels: () => call<T.EmbeddingModel[]>("embedding_models"),
  setEmbeddingModel: (model: string) => call<void>("set_embedding_model", { model }),

  // watched folders
  watchList: (spaceId: string) => call<T.WatchedFolder[]>("watch_list", { spaceId }),
  watchAdd: (spaceId: string, path: string, recursive: boolean) =>
    call<T.WatchedFolder>("watch_add", { spaceId, path, recursive }),
  watchRemove: (id: string) => call<void>("watch_remove", { id }),

  // calculator pop-out window
  openCalculatorWindow: (title: string) => call<void>("open_calculator_window", { title }),

  // quick capture hotkey
  captureStatus: () => call<T.CaptureStatus>("capture_status"),
  captureConfigure: (enabled: boolean, shortcut: string) =>
    call<T.CaptureStatus>("capture_configure", { enabled, shortcut }),

  // focus music
  musicStatus: () => call<T.MusicStatus>("music_status"),
  musicTest: (playlist: string) => call<void>("music_test", { playlist }),
  musicPause: () => call<void>("music_pause"),

  // threads + messages
  listThreads: (spaceId: string) => call<T.Thread[]>("list_threads", { spaceId }),
  createThread: (spaceId: string, title?: string) =>
    call<T.Thread>("create_thread", { spaceId, title: title ?? null }),
  renameThread: (id: string, title: string) => call<T.Thread>("rename_thread", { id, title }),
  pinThread: (id: string, pinned: boolean) => call<T.Thread>("pin_thread", { id, pinned }),
  deleteThread: (id: string) => call<void>("delete_thread", { id }),
  listMessages: (threadId: string) => call<T.Message[]>("list_messages", { threadId }),
  addMessage: (message: T.NewMessage) => call<T.Message>("add_message", { message }),
  updateMessage: (id: string, patch: T.MessagePatch) => call<T.Message>("update_message", { id, patch }),
  deleteMessage: (id: string) => call<void>("delete_message", { id }),

  // journal
  listJournal: (spaceId: string) => call<T.JournalEntry[]>("list_journal", { spaceId }),
  addJournal: (spaceId: string, kind: string, title: string, content: string) =>
    call<T.JournalEntry>("add_journal", { spaceId, kind, title, content }),

  // settings
  getSettings: () => call<Record<string, unknown>>("get_settings"),
  setSetting: (key: string, value: unknown) => call<void>("set_setting", { key, value }),

  // placement
  topicCoverage: (spaceId: string, topics: { id: string; text: string }[]) =>
    call<T.TopicCoverage[]>("topic_coverage", { spaceId, topics }),
  curriculumGet: (spaceId: string) => call<T.SpaceCurriculum | null>("curriculum_get", { spaceId }),
  curriculumSet: (spaceId: string, curriculumId: string, title: string, topics: T.TopicRef[]) =>
    call<T.SpaceCurriculum>("curriculum_set", { spaceId, curriculumId, title, topics }),
  curriculumClear: (spaceId: string) => call<void>("curriculum_clear", { spaceId }),
  topicLevels: (spaceId: string) => call<T.TopicLevel[]>("topic_levels", { spaceId }),
  topicLevelSet: (spaceId: string, topicId: string, level: T.TopicLevelValue, evidence?: string | null) =>
    call<void>("topic_level_set", { spaceId, topicId, level, evidence: evidence ?? null }),
  assessmentCreate: (spaceId: string, kind: T.AssessmentKind, topicId: string | null, title: string, questions: T.QuizQuestion[]) =>
    call<T.Assessment>("assessment_create", { spaceId, kind, topicId, title, questions }),
  assessmentComplete: (id: string, answers: number[], score: number) =>
    call<T.Assessment>("assessment_complete", { id, answers, score }),
  assessmentsList: (spaceId: string) => call<T.Assessment[]>("assessments_list", { spaceId }),
  coursesList: (spaceId: string) => call<T.Course[]>("courses_list", { spaceId }),
  courseCreate: (spaceId: string, sourceId: string, title: string, lessons: { title: string; startOffset: number; endOffset: number }[]) =>
    call<T.Course>("course_create", { spaceId, sourceId, title, lessons }),
  courseDelete: (id: string) => call<void>("course_delete", { id }),
  lessonSetStatus: (id: string, status: T.Lesson["status"], score?: number | null) =>
    call<void>("lesson_set_status", { id, status, score: score ?? null }),

  // flashcards
  cardsAdd: (spaceId: string, cards: T.NewCard[]) => call<T.Card[]>("cards_add", { spaceId, cards }),
  cardUpdate: (id: string, patch: { front?: string; back?: string; data?: T.CardData; suspended?: boolean }) =>
    call<T.Card>("card_update", { id, patch }),
  cardDelete: (id: string) => call<void>("card_delete", { id }),
  cardsList: (spaceId: string) => call<T.Card[]>("cards_list", { spaceId }),
  cardsDue: (spaceId?: string | null, limit?: number) =>
    call<T.Card[]>("cards_due", { spaceId: spaceId ?? null, limit: limit ?? null }),
  cardsDueCounts: () => call<T.DueCount[]>("cards_due_counts"),
  cardReview: (id: string, rating: number, fsrs: Record<string, unknown>, due: number, cardState: number, durationMs?: number, log?: unknown) =>
    call<T.Card>("card_review", { id, rating, fsrs, due, cardState, durationMs: durationMs ?? null, log: log ?? null }),
  mistakesAdd: (spaceId: string, items: T.NewMistake[]) => call<T.Mistake[]>("mistakes_add", { spaceId, items }),
  mistakesList: (spaceId?: string | null) => call<T.Mistake[]>("mistakes_list", { spaceId: spaceId ?? null }),
  mistakeSetResolved: (id: string, resolved: boolean) => call<void>("mistake_set_resolved", { id, resolved }),
  mistakeDelete: (id: string) => call<void>("mistake_delete", { id }),
  imageStore: (path: string) => call<string>("image_store", { path }),
  imageRead: (name: string) => call<string>("image_read", { name }),

  // adaptive practice
  abilitiesList: (spaceId: string) => call<T.Ability[]>("abilities_list", { spaceId }),
  insightsActivity: (spaceId: string | null, since: number) => call<T.InsightsActivity>("insights_activity", { spaceId, since }),
  examSave: (attempt: T.ExamAttempt) => call<T.ExamAttempt>("exam_save", { attempt }),
  examsList: (spaceId: string) => call<T.ExamAttempt[]>("exams_list", { spaceId }),
  examGet: (id: string) => call<T.ExamAttempt | null>("exam_get", { id }),
  outputSave: (output: T.StudioOutput) => call<T.StudioOutput>("output_save", { output }),
  outputsList: (spaceId: string) => call<T.StudioOutput[]>("outputs_list", { spaceId }),
  outputGet: (id: string) => call<T.StudioOutput | null>("output_get", { id }),
  outputDelete: (id: string) => call<void>("output_delete", { id }),
  /** Native save dialog; null when cancelled. Returns the saved path. */
  exportFile: (name: string, extension: string, bytes: Uint8Array) =>
    call<string | null>("export_file", { name, extension, bytes: Array.from(bytes) }),
  printWindow: () => call<void>("print_window"),
  examDelete: (id: string) => call<void>("exam_delete", { id }),
  abilityGet: (spaceId: string, topicKey: string) => call<T.Ability | null>("ability_get", { spaceId, topicKey }),
  practiceItemAdd: (spaceId: string, item: Omit<T.PracticeItem, "id" | "createdAt">) =>
    call<T.PracticeItem>("practice_item_add", { spaceId, item: { id: "", createdAt: 0, ...item } }),
  practiceRecent: (spaceId: string, topicKey: string, limit?: number) =>
    call<string[]>("practice_recent", { spaceId, topicKey, limit: limit ?? null }),
  practiceAttempt: (spaceId: string, attempt: T.NewAttempt) => call<T.Ability>("practice_attempt", { spaceId, attempt }),
  mistakeSetErrorType: (id: string, errorType: T.ErrorType) => call<void>("mistake_set_error_type", { id, errorType }),
  errorPatterns: (spaceId?: string | null) => call<T.ErrorPattern[]>("error_patterns_list", { spaceId: spaceId ?? null }),

  // learner memory
  listMemory: () => call<T.MemoryItem[]>("list_memory"),
  addMemory: (text: string, origin: "user" | "tutor", spaceId?: string | null) =>
    call<T.MemoryItem>("add_memory", { text, origin, spaceId: spaceId ?? null }),
  updateMemory: (id: string, text: string) => call<T.MemoryItem>("update_memory", { id, text }),
  deleteMemory: (id: string) => call<void>("delete_memory", { id }),

  // providers + secrets
  listProviders: () => call<T.Provider[]>("list_providers"),
  saveProvider: (provider: Partial<T.Provider> & Pick<T.Provider, "type" | "kind" | "name">) =>
    call<T.Provider>("save_provider", {
      provider: { id: "", baseUrl: null, config: {}, createdAt: 0, ...provider },
    }),
  deleteProvider: (id: string) => call<void>("delete_provider", { id }),
  setSecret: (providerId: string, value: string) => call<void>("secret_set", { providerId, value }),
  hasSecret: (providerId: string) => call<boolean>("secret_has", { providerId }),
  deleteSecret: (providerId: string) => call<void>("secret_delete", { providerId }),
  lanScan: () => call<T.LanServer[]>("lan_scan"),

  // oauth
  oauthChatgptStart: (providerId: string) => call<{ authUrl: string }>("oauth_chatgpt_start", { providerId }),
  oauthXaiDeviceStart: (providerId: string) => call<T.DeviceCodeStart>("oauth_xai_device_start", { providerId }),
  oauthStatus: (providerId: string) => call<T.OAuthStatus>("oauth_status", { providerId }),
  oauthSignOut: (providerId: string) => call<void>("oauth_sign_out", { providerId }),

  // cloud imports
  cloudStatus: (service: T.CloudService) => call<T.CloudStatus>("cloud_status", { service }),
  cloudSetClient: (service: T.CloudService, clientId: string, clientSecret?: string | null) =>
    call<T.CloudStatus>("cloud_set_client", { service, clientId, clientSecret: clientSecret ?? null }),
  cloudConnect: (service: T.CloudService) => call<{ authUrl: string }>("cloud_connect", { service }),
  cloudDisconnect: (service: T.CloudService) => call<T.CloudStatus>("cloud_disconnect", { service }),
  cloudList: (service: T.CloudService, folder: string | null, query?: string | null, pageToken?: string | null) =>
    call<T.CloudPage>("cloud_list", { service, folder, query: query ?? null, pageToken: pageToken ?? null }),
  cloudImport: (service: T.CloudService, spaceId: string, items: T.CloudItem[]) =>
    call<T.CloudImportResult>("cloud_import", { service, spaceId, items }),

  // http proxy
  httpStream: (request: T.ProxyRequest, onEvent: Channel<T.ProxyEvent>) =>
    call<void>("http_stream", { request, onEvent }),
  httpAbort: (id: string) => call<void>("http_abort", { id }),
  listOpenrouterModels: (force?: boolean) => call<T.OpenRouterCatalog>("list_openrouter_models", { force: force ?? false }),
  siteIcon: (host: string) => call<string | null>("site_icon", { host }),
  httpGetText: (url: string, headers?: Record<string, string>) =>
    call<T.FetchedPage>("http_get_text", { url, headers: headers ?? null }),

  // micro-steps
  microStepsList: (spaceId: string | null) => call<T.MicroStep[]>("micro_steps_list", { spaceId }),
  microStepsReplace: (spaceId: string | null, sessionId: string | null, goal: string | null, steps: T.NewMicroStep[]) =>
    call<T.MicroStep[]>("micro_steps_replace", { spaceId, sessionId, goal, steps }),
  microStepSetDone: (id: string, done: boolean) => call<T.MicroStep>("micro_step_set_done", { id, done }),
  microStepUpdate: (id: string, patch: { text?: string; minutes?: number }) =>
    call<T.MicroStep>("micro_step_update", { id, text: patch.text ?? null, minutes: patch.minutes ?? null }),
  microStepDelete: (id: string) => call<void>("micro_step_delete", { id }),
  microStepsClear: (spaceId: string | null) => call<void>("micro_steps_clear", { spaceId }),
  // focus
  focusStart: (config: T.FocusConfig) => call<T.FocusState>("focus_start", { config }),
  focusState: () => call<T.FocusState | null>("focus_state"),
  focusPause: () => call<T.FocusState>("focus_pause"),
  focusResume: () => call<T.FocusState>("focus_resume"),
  focusNeedApp: (reason?: string) => call<T.FocusState>("focus_need_app", { reason: reason ?? null }),
  focusEndWork: () => call<T.FocusState>("focus_end_work"),
  focusStop: () => call<T.FocusSessionSummary>("focus_stop"),
  focusSetSummary: (sessionId: string, summary: string) =>
    call<void>("focus_set_summary", { sessionId, summary }),
  focusHistory: (spaceId?: string | null) =>
    call<T.FocusSessionSummary[]>("focus_history", { spaceId: spaceId ?? null }),
  focusEvents: (sessionId: string) => call<T.FocusEvent[]>("focus_events", { sessionId }),
  parkingAdd: (text: string) => call<T.ParkingItem>("parking_add", { text }),
  parkingList: (sessionId?: string | null) =>
    call<T.ParkingItem[]>("parking_list", { sessionId: sessionId ?? null }),
  parkingResolve: (id: string) => call<void>("parking_resolve", { id }),
};

export const events = {
  sourceUpdated: (cb: (s: T.Source) => void) => listen<T.Source>("source://updated", (e) => cb(e.payload)),
  embedderStatus: (cb: (s: T.EmbedderStatus) => void) =>
    listen<T.EmbedderStatus>("embedder://status", (e) => cb(e.payload)),
  focusTick: (cb: (s: T.FocusState | null) => void) =>
    listen<T.FocusState | null>("focus://tick", (e) => cb(e.payload)),
  focusTransition: (cb: (t: T.FocusTransition) => void) =>
    listen<T.FocusTransition>("focus://transition", (e) => cb(e.payload)),
  oauthStatus: (cb: (s: T.OAuthStatus) => void) =>
    listen<T.OAuthStatus>("oauth://status", (e) => cb(e.payload)),
  cloudStatus: (cb: (s: T.CloudStatus) => void) =>
    listen<T.CloudStatus>("cloud://status", (e) => cb(e.payload)),
  /** tray menu "Start focus session" */
  focusRequest: (cb: () => void) => listen("focus://request-start", () => cb()),
  watchUpdated: (cb: (e: { id: string; spaceId: string }) => void) =>
    listen<{ id: string; spaceId: string }>("watch://updated", (e) => cb(e.payload)),
  musicError: (cb: (error: string | null) => void) => listen<string | null>("music://error", (e) => cb(e.payload)),
  /** global hotkey or tray "Quick capture" */
  captureOpen: (cb: () => void) => listen("capture://open", () => cb()),
  captureStatus: (cb: (s: T.CaptureStatus) => void) =>
    listen<T.CaptureStatus>("capture://status", (e) => cb(e.payload)),
};

export type { UnlistenFn };
export { Channel };
