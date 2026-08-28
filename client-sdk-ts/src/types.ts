import type { Tool } from "./tools.js";
import type { FilePermissionFunc } from "./file-permission.js";
import type { ShellPermissionFunc } from "./shell-permission.js";

export type ChatRole = "system" | "developer" | "user" | "assistant" | "tool";

/** The only model value accepted by JoyToken requests. */
export type JoyTokenModel = "auto";

export interface ChatMessage {
  role: ChatRole;
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  [key: string]: unknown;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  /** Opaque provider extension data that must be replayed unchanged on tool continuations. */
  extra_content?: Record<string, unknown>;
}

/** Serialized outcome of one SDK-managed tool invocation. */
export interface ToolCallResult {
  tool_call_id: string;
  tool_name: string;
  content: string;
  is_error: boolean;
}

export interface ToolRunStreamOptions {
  /** Receives only model text deltas, never tool argument fragments. */
  onTextDelta?: (delta: string) => void;
  /** Receives each local tool result after its handler finishes. */
  onToolResult?: (result: ToolCallResult) => void;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: JoyTokenModel;
  messages: ChatMessage[];
  stream?: false;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: ChatTool[];
  tool_choice?: "none" | "auto" | "required" | Record<string, unknown>;
  tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ChatCompletionStreamRequest extends Omit<ChatCompletionRequest, "stream"> {
  stream: true;
}

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  total_cost?: number;
  [key: string]: unknown;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string | null;
  logprobs?: unknown;
}

export interface ChatCompletionResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: Usage;
  [key: string]: unknown;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason?: string | null;
  logprobs?: unknown;
}

export interface ChatCompletionChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: ChatCompletionChunkChoice[];
  usage?: Usage;
  [key: string]: unknown;
}

export interface ResponseInputContentPart {
  type: "input_text" | "output_text" | "text" | string;
  text?: string;
  [key: string]: unknown;
}

export interface ResponseInputItem {
  type?: "message" | "function_call" | "function_call_output" | string;
  role?: ChatRole;
  content?: string | ResponseInputContentPart[];
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  status?: string;
  summary?: unknown[];
  encrypted_content?: string;
  /** Opaque provider extension data associated with this input item. */
  extra_content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
  [key: string]: unknown;
}

export interface ResponseHostedTool {
  type: string;
  [key: string]: unknown;
}

export interface ResponseHostedFileSearchTool extends ResponseHostedTool {
  type: "file_search";
  vector_store_ids: string[];
}

export interface ResponseHostedWebSearchTool extends ResponseHostedTool {
  type: "web_search_preview";
}

export type ResponseTool = ResponseFunctionTool | ResponseHostedTool;

export type ResponseToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; name: string }
  | { type: string; [key: string]: unknown };

export interface ResponseRequest {
  model: JoyTokenModel;
  input: string | ResponseInputItem[];
  instructions?: string;
  stream?: false;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponseTool[];
  tool_choice?: ResponseToolChoice;
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  include?: string[];
  store?: boolean;
  tier?: string;
  service_tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseStreamRequest {
  model: JoyTokenModel;
  input: string | ResponseInputItem[];
  instructions?: string;
  stream: true;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponseTool[];
  tool_choice?: ResponseToolChoice;
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  include?: string[];
  store?: boolean;
  tier?: string;
  service_tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseOutputContent {
  type: string;
  text?: string;
  annotations?: unknown[];
  [key: string]: unknown;
}

export interface ResponseOutputItem {
  id?: string;
  type: string;
  role?: string;
  status?: string;
  content?: ResponseOutputContent[];
  name?: string;
  arguments?: string;
  call_id?: string;
  summary?: unknown[];
  encrypted_content?: string;
  action?: Record<string, unknown>;
  results?: unknown[];
  /** Opaque provider extension data associated with this output item. */
  extra_content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface Response {
  id: string;
  object: "response" | string;
  created_at?: number;
  status: string;
  model: string;
  output?: ResponseOutputItem[];
  output_text?: string;
  usage?: ResponseUsage;
  metadata?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  incomplete_details?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface ResponseStreamEvent {
  type: string;
  sequence_number?: number;
  response?: Response;
  output_index?: number;
  content_index?: number;
  item_id?: string;
  item?: ResponseOutputItem;
  part?: ResponseOutputContent;
  delta?: string;
  text?: string;
  arguments?: string;
  error?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | MessageContentBlock[];
  is_error?: boolean;
  /** Opaque provider extension data associated with this content block. */
  extra_content?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageParam {
  role: "user" | "assistant";
  content: string | MessageContentBlock[];
}

export interface MessageTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  [key: string]: unknown;
}

export type MessageToolChoice =
  | { type: "auto"; disable_parallel_tool_use?: boolean }
  | { type: "any"; disable_parallel_tool_use?: boolean }
  | { type: "tool"; name: string; disable_parallel_tool_use?: boolean }
  | { type: "none" };

export interface MessageRequest {
  model: JoyTokenModel;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | MessageContentBlock[];
  stream?: false;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: MessageTool[];
  tool_choice?: MessageToolChoice;
  tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageStreamRequest {
  model: JoyTokenModel;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | MessageContentBlock[];
  stream: true;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: MessageTool[];
  tool_choice?: MessageToolChoice;
  tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageUsage {
  /** Zero when the Gateway omits usage; inspect metadata.joytoken.usage_status. */
  input_tokens: number;
  /** Zero when the Gateway omits usage; inspect metadata.joytoken.usage_status. */
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  [key: string]: unknown;
}

export interface MessageResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: MessageContentBlock[];
  model: string;
  stop_reason?: string | null;
  stop_sequence?: string | null;
  usage: MessageUsage;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageStreamEvent {
  type: string;
  index?: number;
  message?: MessageResponse;
  content_block?: MessageContentBlock;
  delta?: Record<string, unknown>;
  usage?: MessageUsage;
  error?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ImageGenerationRequest {
  model: JoyTokenModel;
  prompt: string;
  n?: number;
  quality?: string;
  response_format?: "url" | "b64_json";
  size?: string;
  style?: string;
  user?: string;
  background?: string;
  moderation?: string;
  output_compression?: number;
  output_format?: string;
  [key: string]: unknown;
}

export interface GeneratedImage {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
  [key: string]: unknown;
}

export interface ImageGenerationResponse {
  created?: number;
  data: GeneratedImage[];
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ModelInfo {
  modelId?: string;
  modelKey?: string;
  displayName?: string;
  alias?: string;
  tier?: string;
  tags?: string[];
  description?: string;
  customerInputMtok?: number;
  customerOutputMtok?: number;
  customerCachereadMtok?: number;
  customerCachewriteMtok?: number;
  customerImageInputMtok?: string;
  customerImageOutputMtok?: string;
  customerImageCachedInputMtok?: string;
  provider?: string;
  featureTags?: string[];
  scenarioTags?: string[];
  mciScore?: number;
  [key: string]: unknown;
}

/** Supported languages for localized model descriptions. */
export type ModelLocale = "zh" | "en";

/** Options for the public model catalog request. */
export interface ListModelsOptions {
  /**
   * Response language for model descriptions. When omitted, the API defaults
   * to English.
   */
  locale?: ModelLocale;
}

export interface ModelListResponse {
  code?: number;
  message?: string;
  object?: string;
  data: {
    models: ModelInfo[];
  };
  [key: string]: unknown;
}

export interface CatalogOption {
  value: string;
  label: string;
}

export interface ModelMetadata {
  tiers: CatalogOption[];
  skus: CatalogOption[];
  featureTags: CatalogOption[];
  industryPacks: CatalogOption[];
  providers: CatalogOption[];
  updatedAt: string;
}

export interface ModelMetadataResponse {
  code: number;
  data: ModelMetadata;
  message: string;
}

export interface PricingTier {
  code: string;
  name: string;
  description: string;
  usdPerCredit: string;
  creditsPerUsd: string;
  unit: string;
  rateVersion: string;
  sortOrder: number;
  updatedAt: string;
}

export interface PricingSku {
  code: string;
  name: string;
  description: string;
}

export interface Pricing {
  tiers: PricingTier[];
  skus: PricingSku[];
  currentVersion: string;
  updatedAt: string;
}

export interface PricingResponse {
  code: number;
  data: Pricing;
  message: string;
}

export interface JoyTokenClientOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  openAIBaseUrl?: string;
  /** @deprecated Kept for source compatibility. Messages always use the Chat Completions endpoint. */
  anthropicBaseUrl?: string;
  /** @deprecated Kept for source compatibility. Messages are adapted locally and use Bearer auth. */
  anthropicVersion?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Maximum number of automatic retries for transient failures (HTTP 429 and
   * 5xx, plus network/transport errors). Defaults to 0 because model requests
   * are not inherently idempotent. Set a positive value to opt in. Retries use
   * exponential backoff with full jitter and honor the `Retry-After` response
   * header.
   */
  maxRetries?: number;
  /**
   * Tools registered on the client. They are used only when request.tools is
   * undefined, and are executed only through an explicit run/executeTools API.
   */
  tools?: Tool[];
  /**
   * When true (default), the built-in local tools are used only when neither
   * request tools nor Client-registered tools exist: calculator, datetime, and the read-only file tools
   * (file_search, list_dir, file_read) scoped to fileWorkspace. The
   * side-effecting file_write and shell tools are always declared too, but each
   * invocation is gated: without a matching permission callback (filePermission
   * / shellPermission) the declaration is still sent yet execution is refused,
   * so the model sees the capability but nothing runs without host approval.
   */
  defaultLocalTools?: boolean;
  /**
   * Opts Responses into hosted default tools. Disabled by default. Currently
   * this only adds web_search_preview; hosted file_search is never synthesized
   * because vector_store_ids must come from the caller.
   */
  defaultBuiltinTools?: boolean;
  /**
   * Maximum number of tool-calling iterations for the non-streaming loop.
   * Defaults to 8.
   */
  toolMaxSteps?: number;
  /**
   * Root directory the default file tools are sandboxed to. Empty/undefined
   * falls back to the current working directory. Applies to file_read,
   * list_dir, file_search, and file_write.
   */
  fileWorkspace?: string;
  /**
   * Host approval callback for file writes. The side-effecting file_write tool
   * is always declared to the model; configuring this callback is what lets its
   * writes actually run. Every write is gated through it and fails safe: with
   * no callback, file_write is declared but refused at execution time. Read-only
   * file tools (file_read/list_dir/file_search) run without approval.
   */
  filePermission?: FilePermissionFunc;
  /**
   * Root directory the default shell tool runs commands in. Empty/undefined
   * falls back to the current working directory, matching fileWorkspace.
   */
  shellWorkspace?: string;
  /**
   * Host approval callback for shell commands. The side-effecting shell tool is
   * always declared to the model; configuring this callback is what lets its
   * commands actually run. Every invocation is gated through it and fails safe:
   * with no callback, shell is declared but refused at execution time, so the
   * model sees the capability yet nothing runs without host approval.
   */
  shellPermission?: ShellPermissionFunc;
  /**
   * Names of default tools to exclude from the injected set, e.g.
   * ["shell", "file_write"]. Matched by tool name. It does not affect tools the
   * caller registers explicitly via `tools`.
   */
  excludedDefaultTools?: string[];
}
