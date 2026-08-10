export type ChatRole = "system" | "user" | "assistant" | "tool";

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
  type: "input_text" | "output_text" | "text";
  text: string;
  [key: string]: unknown;
}

export interface ResponseInputItem {
  type?: "message" | string;
  role?: ChatRole;
  content?: string | ResponseInputContentPart[];
  [key: string]: unknown;
}

export interface ResponseTool {
  type: "function" | string;
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ResponseRequest {
  model: JoyTokenModel;
  input: string | ResponseInputItem[];
  instructions?: string;
  stream?: false;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponseTool[];
  [key: string]: unknown;
}

export interface ResponseStreamRequest extends Omit<ResponseRequest, "stream"> {
  stream: true;
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
  status: string;
  model: string;
  output?: ResponseOutputItem[];
  usage?: ResponseUsage;
  metadata?: Record<string, unknown>;
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

export interface MessageContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
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
}

export interface MessageRequest {
  model: JoyTokenModel;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | MessageContentBlock[];
  stream?: false;
  temperature?: number;
  tools?: MessageTool[];
  tier?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MessageStreamRequest extends Omit<MessageRequest, "stream"> {
  stream: true;
}

export interface MessageUsage {
  input_tokens?: number;
  output_tokens?: number;
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

export interface JoyTokenClientOptions {
  apiKey?: string;
  apiBaseUrl?: string;
  openAIBaseUrl?: string;
  anthropicBaseUrl?: string;
  anthropicVersion?: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
}
