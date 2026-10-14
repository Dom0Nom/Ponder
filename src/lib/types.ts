export type TutorStyle = "direct" | "socratic" | "mixed";

export interface ModelRef {
  providerId: string;
  model: string;
}

export interface Space {
  id: string;
  name: string;
  icon: string;
  color: string;
  tutorStyle: TutorStyle;
  strictGrounding: boolean;
  modelOverride: ModelRef | null;
  /** BCP-47 code the tutor and generated material use; null follows the app language */
  language: string | null;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number | null;
  recap: string | null;
  sourceCount: number;
}

export interface SpacePatch {
  name?: string;
  icon?: string;
  color?: string;
  tutorStyle?: TutorStyle;
  strictGrounding?: boolean;
  modelOverride?: ModelRef | null;
  language?: string | null;
  recap?: string;
}

export type SourceKind = "pdf" | "epub" | "docx" | "markdown" | "text" | "url" | "youtube";
export type SourceStatus = "processing" | "ready" | "error";

export interface Source {
  id: string;
  spaceId: string;
  title: string;
  kind: SourceKind;
  origin: string | null;
  status: SourceStatus;
  error: string | null;
  summary: string | null;
  useInChat: boolean;
  progress: number;
  charCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
  contextMode?: ContextMode;
}

export interface SourceText {
  text: string;
  /** [page, startOffset] pairs; offsets are UTF-16 code units (JS string indices) */
  pages: [number, number][] | null;
}

export interface SearchHit {
  chunkId: number;
  sourceId: string;
  sourceTitle: string;
  text: string;
  start: number;
  end: number;
  page: number | null;
  score: number;
  ord?: number;
  heading?: string | null;
}

/** How a source goes into the model's context; "off" is `useInChat: false`. */
export type ContextMode = "auto" | "summary" | "full";

export interface RangeRequest {
  sourceId: string;
  unit: "chunk" | "page" | "all";
  from?: number;
  to?: number;
  maxChars?: number;
}

export interface SourceRange {
  sourceId: string;
  sourceTitle: string;
  chunkId: number | null;
  ordFrom: number;
  ordTo: number;
  start: number;
  end: number;
  pageFrom: number | null;
  pageTo: number | null;
  heading: string | null;
  text: string;
  truncated: boolean;
  totalChunks: number;
  totalPages: number | null;
  /** [page, UTF-16 offset] of each page that starts inside the range */
  pageStarts: [number, number][];
  /** [chunk id, UTF-16 start] of each chunk inside the range */
  chunkStarts?: [number, number][];
}

export interface RangeResult {
  range: SourceRange | null;
  error: string | null;
}

export interface OutlineEntry {
  title: string;
  level: number;
  ordFrom: number;
  ordTo: number;
  pageFrom: number | null;
  pageTo: number | null;
}

export interface SourceOutline {
  sourceId: string;
  method: string;
  entries: OutlineEntry[];
}

export interface Thread {
  id: string;
  spaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  /** compaction summary of the messages up to `summaryUntil` (createdAt, inclusive) */
  summary?: string | null;
  summaryUntil?: number | null;
  /** false = "Don't compact" */
  autoCompact?: boolean;
}

export type MessageRole = "user" | "assistant" | "buddy" | "system" | "practice";
export type MessageStatus = "complete" | "streaming" | "error";

export interface Citation {
  n: number;
  chunkId: number;
  sourceId: string;
  sourceTitle: string;
  start: number;
  end: number;
  page: number | null;
  snippet: string;
  /** full passage text, used to match uncited paragraphs */
  text?: string;
}

export interface MessageMeta {
  tutorStyle?: TutorStyle;
  /** what went into the model's context for this answer */
  context?: {
    used: number;
    window: number;
    cap: number;
    conversation: number;
    conversationBudget: number;
    summarized: boolean;
    passages: number;
    full: string[];
    summaryOnly: string[];
    truncated: string[];
    whole: string[];
    cost: number | null;
  };
  model?: ModelRef;
  buddyKind?: BuddyEventKind;
  focus?: FocusState | null;
  thinking?: boolean;
  /** how long the model reasoned before answering */
  thinkingMs?: number;
  /** model-written follow-up questions */
  followUps?: string[];
  stopped?: boolean;
  retrievalError?: string;
  /** facts the tutor saved to learner memory during this reply */
  remembered?: string[];
  /** MCP tools the tutor called while answering */
  toolCalls?: ToolCallMeta[];
  /** MCP servers whose tools couldn't be loaded for this reply */
  toolErrors?: string[];
  /** this message is a second opinion on another assistant message */
  secondOpinionOf?: string;
  check?: SelfCheck;
  /** state of an inline practice card (role "practice") */
  practice?: InlinePracticeMeta;
}

export interface InlinePracticeMeta {
  answerId: string;
  topicKey: string;
  topicTitle: string;
  /** problems written so far; the next one is added while the learner answers */
  items: PracticeItem[];
  index: number;
  results: ("right" | "wrong" | "skipped")[];
  total: number;
}

export type ClaimVerdict = "supported" | "partly" | "unsupported" | "contradicted";

export interface SelfCheck {
  at: number;
  model: ModelRef;
  items: { claim: string; verdict: ClaimVerdict; passages: number[]; note?: string }[];
  error?: string;
}

export interface MemoryItem {
  id: string;
  text: string;
  origin: "user" | "tutor";
  spaceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  threadId: string;
  role: MessageRole;
  content: string;
  reasoning: string | null;
  citations: Citation[] | null;
  meta: MessageMeta | null;
  status: MessageStatus;
  error: string | null;
  createdAt: number;
}

export interface NewMessage {
  threadId: string;
  role: MessageRole;
  content?: string;
  reasoning?: string | null;
  citations?: Citation[] | null;
  meta?: MessageMeta | null;
  status?: MessageStatus;
}

export interface MessagePatch {
  content?: string;
  reasoning?: string;
  citations?: Citation[];
  meta?: MessageMeta;
  status?: MessageStatus;
  error?: string;
}

export interface JournalEntry {
  id: string;
  spaceId: string;
  kind: string;
  title: string;
  content: string;
  createdAt: number;
}

// ---------- providers ----------

export type ProviderType =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "xai"
  | "groq"
  | "mistral"
  | "deepseek"
  | "openai-compatible"
  | "lmstudio"
  | "ollama"
  | "llamacpp"
  | "chatgpt-oauth"
  | "xai-oauth";

export type ProviderKind = "apiKey" | "oauth" | "local";

export interface ProviderConfig {
  /** models the user picked or discovered */
  models?: string[];
  defaultModel?: string;
  /** set when the OAuth flow produced an account */
  account?: string;
  [k: string]: unknown;
}

export interface Provider {
  id: string;
  type: ProviderType;
  kind: ProviderKind;
  name: string;
  baseUrl: string | null;
  config: ProviderConfig;
  createdAt: number;
}

export interface LanServer {
  kind: "lmstudio" | "ollama";
  baseUrl: string;
  models: string[];
}

export interface OAuthStatus {
  providerId: string;
  state: "signedOut" | "pending" | "signedIn" | "error";
  account?: string | null;
  error?: string | null;
  expiresAt?: number | null;
}

export interface DeviceCodeStart {
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string | null;
  expiresIn: number;
}

// ---------- cloud imports ----------

export type CloudService = "google" | "dropbox";

export interface CloudStatus {
  service: CloudService;
  configured: boolean;
  clientId: string | null;
  hasSecret: boolean;
  state: "signedOut" | "pending" | "signedIn" | "error";
  account: string | null;
  error: string | null;
  /** exact redirect URI to register (Dropbox) */
  redirectUri: string | null;
}

/** `id` is the Drive file id or the Dropbox path. */
export interface CloudItem {
  id: string;
  name: string;
  folder: boolean;
  mimeType: string | null;
  size: number | null;
  /** RFC 3339 */
  modified: string | null;
  supported: boolean;
}

export interface CloudPage {
  items: CloudItem[];
  nextPageToken: string | null;
}

export interface CloudImportResult {
  sources: Source[];
  failures: { name: string; error: string }[];
}

// ---------- focus ----------

export type FocusTechnique = "pomodoro" | "52-17" | "flowtime" | "timebox" | "custom";
export type FocusPhase = "work" | "break" | "longBreak" | "done";

export interface FocusConfig {
  spaceId?: string | null;
  technique: FocusTechnique;
  goal?: string | null;
  workMins?: number;
  breakMins?: number;
  longBreakMins?: number;
  /** work blocks before a long break (pomodoro) */
  cyclesBeforeLong?: number;
  /** body-doubling check-in interval; 0 = off */
  checkInMins?: number;
  /** picked at the session check-in; "low" = review-only session */
  energy?: Energy;
}

export type Energy = "normal" | "low";

export interface FocusState {
  sessionId: string;
  spaceId: string | null;
  technique: FocusTechnique;
  goal: string | null;
  phase: FocusPhase;
  /** 1-based work block number */
  block: number;
  phaseStartedAt: number;
  /** null for open-ended phases (flowtime work) */
  phaseDurationMs: number | null;
  elapsedMs: number;
  remainingMs: number | null;
  paused: boolean;
  pauseReason: "user" | "needApp" | null;
  pauseCount: number;
  needAppCount: number;
  totalFocusMs: number;
  totalBreakMs: number;
  checkInMins: number;
  energy?: Energy;
  now: number;
}

export interface FocusTransition {
  from: FocusPhase;
  to: FocusPhase;
  state: FocusState;
}

export interface FocusEvent {
  id: number;
  sessionId: string;
  kind: string;
  at: number;
  data: Record<string, unknown> | null;
}

export interface FocusSessionSummary {
  id: string;
  spaceId: string | null;
  technique: FocusTechnique;
  goal: string | null;
  startedAt: number;
  endedAt: number | null;
  focusMs: number;
  breakMs: number;
  pauses: number;
  summary: string | null;
}

export interface ParkingItem {
  id: string;
  sessionId: string | null;
  spaceId: string | null;
  text: string;
  resolved: boolean;
  createdAt: number;
}

/** 2–5 minute step from "Where do I start?" */
export interface MicroStep {
  id: string;
  spaceId: string | null;
  sessionId: string | null;
  /** the goal or topic the steps were generated for */
  goal: string | null;
  text: string;
  minutes: number;
  done: boolean;
  position: number;
  createdAt: number;
}

export interface NewMicroStep {
  text: string;
  minutes: number;
}

export interface MusicStatus {
  /** a backend can control a player on this machine (e.g. Spotify desktop app installed) */
  available: boolean;
  backend: string | null;
  running: boolean;
  /** last failure when starting or pausing the player */
  lastError: string | null;
}

export type BuddyEventKind =
  | "session-start"
  | "check-in"
  | "recall"
  | "block-quiz"
  | "break-start"
  | "post-break"
  | "session-summary"
  | "hyperfocus";

// ---------- http proxy ----------

export interface ProxyRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  providerId?: string | null;
}

export type ProxyEvent =
  | { type: "head"; status: number; headers: Record<string, string> }
  | { type: "chunk"; data: string }
  | { type: "end" }
  | { type: "error"; message: string };

export interface FetchedPage {
  status: number;
  url: string;
  contentType: string | null;
  body: string;
}

export interface EmbedderStatus {
  state: "missing" | "downloading" | "loading" | "indexing" | "ready" | "error";
  model: string;
  progress: number;
  error: string | null;
}

export interface EmbeddingModel {
  id: string;
  sizeMb: number;
  multilingual: boolean;
}

/** An embedding model on OpenRouter; picked as `openrouter:<id>`. */
export interface RemoteEmbeddingModel {
  id: string;
  name: string;
  /** USD per million input tokens */
  price: number | null;
}

export interface AppError {
  code: string;
  message: string;
  /** Key into `s.errors` for a translated message; `params` fill its placeholders. */
  key?: string;
  params?: string[];
}

// ---------- placement ----------

export interface TopicRef {
  id: string;
  title: string;
  description: string;
  group: string;
  prereqs?: string[];
}

export interface SpaceCurriculum {
  spaceId: string;
  curriculumId: string;
  title: string;
  topics: TopicRef[];
  updatedAt: number;
}

export type TopicLevelValue = "unknown" | "weak" | "ok" | "strong";

export interface TopicLevel {
  topicId: string;
  level: TopicLevelValue;
  evidence: string | null;
  updatedAt: number;
}

export interface TopicCoverage {
  topicId: string;
  similarity: number | null;
  keywordHits: number;
  best: SearchHit | null;
}

export interface QuizQuestion {
  topicId: string | null;
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

export type AssessmentKind = "placement" | "prereq" | "lesson";

export interface Assessment {
  id: string;
  spaceId: string;
  kind: AssessmentKind;
  topicId: string | null;
  title: string;
  questions: QuizQuestion[];
  answers: number[] | null;
  score: number | null;
  createdAt: number;
  completedAt: number | null;
}

export interface Lesson {
  id: string;
  courseId: string;
  ord: number;
  title: string;
  startOffset: number;
  endOffset: number;
  status: "todo" | "doing" | "done";
  score: number | null;
  completedAt: number | null;
}

export interface Course {
  id: string;
  spaceId: string;
  sourceId: string;
  title: string;
  createdAt: number;
  lessons: Lesson[];
}

export type WatchStatus = "watching" | "scanning" | "missing" | "error";

export interface WatchedFolder {
  id: string;
  spaceId: string;
  path: string;
  recursive: boolean;
  createdAt: number;
  /** files from this folder currently imported as sources */
  fileCount: number;
  status: WatchStatus;
  error: string | null;
}

export interface BackupConfig {
  enabled: boolean;
  folder: string | null;
  frequency: "daily" | "weekly";
  keep: number;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupStatus {
  config: BackupConfig;
  backups: BackupInfo[];
  running: boolean;
  lastError: string | null;
  /** a restore is validated and waiting for the next start */
  restoreStaged: boolean;
}

export interface PackCounts {
  sources: number;
  chunks: number;
  notes: number;
  cards: number;
  outputs: number;
  files: number;
}

export interface PackExport {
  path: string;
  counts: PackCounts;
}

export interface PackImport {
  spaceId: string;
  name: string;
  counts: PackCounts;
  sourceIds: string[];
}

export interface IntegrationsInfo {
  exePath: string;
  dbPath: string;
}

export interface CaptureStatus {
  enabled: boolean;
  /** Tauri accelerator, e.g. Alt+CommandOrControl+N */
  shortcut: string;
  registered: boolean;
  error: string | null;
}

export interface AskStatus {
  enabled: boolean;
  shortcut: string;
  registered: boolean;
  error: string | null;
  snipEnabled: boolean;
  snipShortcut: string;
  snipRegistered: boolean;
  snipError: string | null;
}

export interface SnipImage {
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
}

export interface AskOpenRequest {
  spaceId: string;
  threadId: string;
  sourceId?: string | null;
  start?: number | null;
  end?: number | null;
}

// ---------- flashcards ----------

export type CardKind = "basic" | "cloze" | "occlusion" | "mcq";

export interface OcclusionMask {
  id: string;
  /** fractions of the image size, 0..1 */
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export interface CardData {
  /** cloze: which gap number this card tests */
  cloze?: number;
  /** occlusion: stored image name and the masks; `mask` is the one this card tests */
  image?: string;
  masks?: OcclusionMask[];
  mask?: string;
  /** occlusion: every mask covered on the question side, not only the tested one */
  hideAll?: boolean;
  /** mcq */
  options?: string[];
  answer?: number;
}

export interface Card {
  id: string;
  spaceId: string;
  kind: CardKind;
  front: string;
  back: string;
  data: CardData | null;
  sourceId: string | null;
  chunkStart: number | null;
  chunkEnd: number | null;
  origin: string;
  suspended: boolean;
  createdAt: number;
  updatedAt: number;
  due: number;
  /** ts-fsrs State: 0 new, 1 learning, 2 review, 3 relearning */
  state: number;
  fsrs: Record<string, unknown> | null;
  spaceName: string;
}

export interface NewCard {
  kind: CardKind;
  front: string;
  back?: string;
  data?: CardData | null;
  sourceId?: string | null;
  chunkStart?: number | null;
  chunkEnd?: number | null;
  origin?: string;
}

export interface DueCount {
  spaceId: string;
  spaceName: string;
  due: number;
  new: number;
  total: number;
}

export interface Mistake {
  id: string;
  spaceId: string;
  origin: string;
  question: string;
  given: string | null;
  correct: string;
  explanation: string | null;
  topic: string | null;
  cardId: string | null;
  resolved: boolean;
  createdAt: number;
  errorType: ErrorType | null;
}

export interface NewMistake {
  origin: string;
  question: string;
  given?: string | null;
  correct: string;
  explanation?: string | null;
  topic?: string | null;
  options?: string[] | null;
}

// ---------- adaptive practice ----------

export type ErrorType = "concept" | "procedure" | "arithmetic" | "sign" | "misread" | "units" | "careless" | "vocabulary" | "other";
export type PracticeKind = "mcq" | "numeric" | "short";

export interface Ability {
  topicKey: string;
  topicTitle: string;
  theta: number;
  n: number;
  updatedAt: number;
}

export interface PracticeItem {
  id: string;
  topicKey: string;
  kind: PracticeKind;
  question: string;
  options: string[] | null;
  answer: string;
  solution: string;
  /** Rasch difficulty on the logit scale */
  difficulty: number;
  parentId: string | null;
  /** one-sentence nudge that doesn't give the answer away */
  hint: string | null;
  createdAt: number;
}

export interface NewAttempt {
  itemId: string;
  topicKey: string;
  topicTitle: string;
  response: string;
  correct: boolean;
  thetaBefore: number;
  thetaAfter: number;
  errorType?: ErrorType | null;
}

export interface ErrorPattern {
  errorType: ErrorType;
  count: number;
  lastAt: number;
  topics: string[];
}

export interface OpenRouterModel {
  id: string;
  name: string;
  contextLength: number | null;
  supportedParameters: string[];
  created: number | null;
  reasoning?: OpenRouterReasoning | null;
  /** USD per token */
  pricing?: { prompt: number; completion: number; cacheRead: number | null } | null;
  maxOutput?: number | null;
}

export interface OpenRouterReasoning {
  mandatory: boolean;
  supportedEfforts: string[] | null;
  defaultEffort: string | null;
  defaultEnabled: boolean | null;
  supportsMaxTokens: boolean;
}

export interface OpenRouterCatalog {
  fetchedAt: number;
  models: OpenRouterModel[];
}

export interface ReviewRow {
  cardId: string;
  spaceId: string;
  sourceId: string | null;
  rating: number;
  reviewedAt: number;
}

export interface FocusRow {
  spaceId: string | null;
  startedAt: number;
  focusMs: number;
}

export interface AttemptRow {
  spaceId: string;
  topicKey: string;
  correct: boolean;
  createdAt: number;
}

export interface InsightsActivity {
  reviews: ReviewRow[];
  focus: FocusRow[];
  attempts: AttemptRow[];
}

export interface StudioOutput {
  id: string;
  spaceId: string;
  kind: import("./studio/kinds").OutputKind;
  title: string;
  focus: string | null;
  data: import("./studio/kinds").OutputData;
  createdAt: number;
  updatedAt: number;
}

export type PlanTaskKind = "learn" | "practice" | "review" | "mock";

export interface PlanFields {
  goal: string;
  /** YYYY-MM-DD */
  examDate: string;
  weeklyMinutes: number;
  /** 0 = Sunday … 6 = Saturday */
  studyDays: number[];
}

export interface StudyPlan extends PlanFields {
  spaceId: string;
  replannedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface ExamAttempt {
  id: string;
  spaceId: string;
  examId: string;
  section: string;
  length: "short" | "full";
  data: import("./exam/attempt").ExamData;
  score: number | null;
  scaled: number | null;
  startedAt: number;
  completedAt: number | null;
  timeUsedMs: number;
}

export interface NewPlanTask {
  date: string;
  ord: number;
  kind: PlanTaskKind;
  topicId: string | null;
  title: string;
  minutes: number;
}

export interface PlanTask extends NewPlanTask {
  id: string;
  spaceId: string;
  doneAt: number | null;
}

export interface StudyPlanBundle {
  plan: StudyPlan;
  tasks: PlanTask[];
}

export interface DatedPlanTask extends PlanTask {
  spaceName: string;
  spaceIcon: string;
}

export interface InboxItem {
  id: string;
  spaceId: string;
  kind: "text" | "url" | "file" | "note";
  title: string;
  body: string;
  target: string | null;
  useAsSource: boolean;
  status: "pending" | "done" | "error";
  error: string | null;
  resultId: string | null;
  createdAt: number;
}

export interface Note {
  id: string;
  spaceId: string;
  title: string;
  body: string;
  useAsSource: boolean;
  sourceId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface GlossaryEntry {
  term: string;
  definition: string;
}

export interface Glossary {
  subjectId: string;
  textHash: string;
  entries: GlossaryEntry[];
  createdAt: number;
}

export interface Annotation {
  id: string;
  sourceId: string;
  /** UTF-16 offsets into the source text */
  start: number;
  end: number;
  quote: string;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface PassageRewrite {
  sourceId: string;
  kind: string;
  start: number;
  end: number;
  textHash: string;
  text: string;
}

export interface AppInfo {
  /** bundle id on macOS */
  id: string;
  name: string;
}

export interface DistractionNudge {
  app: AppInfo;
  sessionId: string;
  remainingMs: number | null;
  count: number;
  at: number;
}

export interface ToolCallMeta {
  server: string;
  tool: string;
  ok: boolean;
}

export interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  /** Streamable HTTP endpoint for a remote server; `command` is empty then */
  url?: string;
  enabled: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  text: string;
  isError: boolean;
}

export interface CDiagnostic {
  line: number;
  column: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export interface CRun {
  ok: boolean;
  stage: "compile" | "run" | "none";
  output: string;
  diagnostics: CDiagnostic[];
  compiler: string | null;
  exitCode: number | null;
  timedOut: boolean;
  truncated: boolean;
  compileMs: number;
  runMs: number;
}

export interface ProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  topicIds: string[];
  position: number;
  doneAt: number | null;
}

export interface ProjectLogEntry {
  id: string;
  projectId: string;
  body: string;
  photo: string | null;
  code: string | null;
  codeResult: string | null;
  createdAt: number;
}

export interface Project {
  id: string;
  spaceId: string;
  title: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  milestones: ProjectMilestone[];
  log: ProjectLogEntry[];
}
