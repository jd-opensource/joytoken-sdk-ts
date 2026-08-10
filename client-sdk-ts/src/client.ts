import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamRequest,
  ImageGenerationRequest,
  ImageGenerationResponse,
  JoyTokenClientOptions,
  ListModelsOptions,
  MessageRequest,
  MessageResponse,
  MessageStreamEvent,
  MessageStreamRequest,
  ModelInfo,
  ModelListResponse,
  ModelMetadataResponse,
  PricingResponse,
  Response as JoyTokenResponse,
  ResponseRequest,
  ResponseStreamEvent,
  ResponseStreamRequest,
} from "./types.js";

const DEFAULT_API_BASE_URL = "https://api.joytokens.ai";
const SDK_VERSION = "0.2.0";
const DEFAULT_TIMEOUT_MS = 60_000;
const STREAM_DONE = Symbol("stream-done");

interface ActiveRequest {
  response: Response;
  cleanup(): void;
}

interface RawModelListResponse extends Omit<ModelListResponse, "data"> {
  data: ModelInfo[] | { models?: ModelInfo[] };
}

export class JoyTokenAPIError extends Error {
  readonly status: number;
  readonly requestId?: string;
  readonly responseHeaders: Headers;
  readonly body: unknown;

  constructor(message: string, options: { status: number; responseHeaders: Headers; body: unknown; requestId?: string }) {
    super(message);
    this.name = "JoyTokenAPIError";
    this.status = options.status;
    this.responseHeaders = options.responseHeaders;
    this.body = options.body;
    this.requestId = options.requestId;
  }
}

export class JoyTokenClient {
  readonly apiBaseUrl: string;
  readonly openAIBaseUrl: string;
  readonly anthropicBaseUrl: string;
  readonly anthropicVersion: string;
  readonly timeoutMs: number;

  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  readonly chat = {
    completions: {
      create: (request: ChatCompletionRequest): Promise<ChatCompletionResponse> => this.createChatCompletion(request),
      stream: (request: Omit<ChatCompletionStreamRequest, "stream">): AsyncIterable<ChatCompletionChunk> =>
        this.streamChatCompletion({ ...request, stream: true }),
    },
  };

  readonly models = {
    list: (options: ListModelsOptions = {}): Promise<ModelListResponse> => this.listModels(options),
    meta: (): Promise<ModelMetadataResponse> => this.getModelMetadata(),
  };

  readonly images = {
    generate: (request: ImageGenerationRequest): Promise<ImageGenerationResponse> => this.generateImage(request),
  };

  readonly pricing = {
    retrieve: (): Promise<PricingResponse> => this.getPricing(),
  };

  readonly messages = {
    create: (request: MessageRequest): Promise<MessageResponse> => this.createMessage(request),
    stream: (request: Omit<MessageStreamRequest, "stream">): AsyncIterable<MessageStreamEvent> =>
      this.streamMessage({ ...request, stream: true }),
  };

  readonly responses = {
    create: (request: ResponseRequest): Promise<JoyTokenResponse> => this.createResponse(request),
    stream: (request: Omit<ResponseStreamRequest, "stream">): AsyncIterable<ResponseStreamEvent> =>
      this.streamResponse({ ...request, stream: true }),
  };

  constructor(options: JoyTokenClientOptions = {}) {
    const env = globalThis.process?.env;
    this.apiKey = options.apiKey ?? env?.JOY_TOKEN_API_KEY;
    this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? env?.JOY_TOKEN_API_BASE_URL ?? DEFAULT_API_BASE_URL);
    this.openAIBaseUrl = trimTrailingSlash(
      options.openAIBaseUrl ?? env?.JOY_TOKEN_OPENAI_BASE_URL ?? `${this.apiBaseUrl}/openai/v1`,
    );
    this.anthropicBaseUrl = trimTrailingSlash(
      options.anthropicBaseUrl ?? env?.JOY_TOKEN_ANTHROPIC_BASE_URL ?? `${this.apiBaseUrl}/anthropic/v1`,
    );
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    if (!this.fetcher) {
      throw new Error("No fetch implementation available. Pass JoyTokenClient({ fetch }) in this runtime.");
    }
  }

  private async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    if (request.stream) {
      throw new Error("Use joytoken.chat.completions.stream() for streaming responses.");
    }

    return this.requestJSON<ChatCompletionResponse>(`${this.openAIBaseUrl}/chat/completions`, {
      method: "POST",
      body: JSON.stringify({ ...request, stream: false }),
    });
  }

  private async *streamChatCompletion(request: ChatCompletionStreamRequest): AsyncIterable<ChatCompletionChunk> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    const activeRequest = await this.requestRaw(`${this.openAIBaseUrl}/chat/completions`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify({ ...request, stream: true }),
    });

    try {
      yield* readSSE<ChatCompletionChunk>(activeRequest.response);
    } finally {
      activeRequest.cleanup();
    }
  }

  private async createResponse(request: ResponseRequest): Promise<JoyTokenResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    if (request.stream) {
      throw new Error("Use joytoken.responses.stream() for streaming responses.");
    }

    return this.requestJSON<JoyTokenResponse>(`${this.openAIBaseUrl}/responses`, {
      method: "POST",
      body: JSON.stringify({ ...request, stream: false }),
    });
  }

  private async *streamResponse(request: ResponseStreamRequest): AsyncIterable<ResponseStreamEvent> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    const activeRequest = await this.requestRaw(`${this.openAIBaseUrl}/responses`, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify({ ...request, stream: true }),
    });

    try {
      yield* readSSE<ResponseStreamEvent>(activeRequest.response);
    } finally {
      activeRequest.cleanup();
    }
  }

  private async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    return this.requestJSON<ImageGenerationResponse>(`${this.openAIBaseUrl}/images/generations`, {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  private async createMessage(request: MessageRequest): Promise<MessageResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    if (request.stream) {
      throw new Error("Use joytoken.messages.stream() for streaming responses.");
    }

    return this.requestJSON<MessageResponse>(
      `${this.anthropicBaseUrl}/messages`,
      {
        method: "POST",
        headers: { "anthropic-version": this.anthropicVersion },
        body: JSON.stringify({ ...request, stream: false }),
      },
      "x-api-key",
    );
  }

  private async *streamMessage(request: MessageStreamRequest): AsyncIterable<MessageStreamEvent> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    const activeRequest = await this.requestRaw(
      `${this.anthropicBaseUrl}/messages`,
      {
        method: "POST",
        headers: { Accept: "text/event-stream", "anthropic-version": this.anthropicVersion },
        body: JSON.stringify({ ...request, stream: true }),
      },
      "x-api-key",
    );

    try {
      yield* readSSE<MessageStreamEvent>(activeRequest.response);
    } finally {
      activeRequest.cleanup();
    }
  }

  private async listModels(options: ListModelsOptions): Promise<ModelListResponse> {
    if (options.locale !== undefined && options.locale !== "zh" && options.locale !== "en") {
      throw new Error('JoyToken model locale must be "zh" or "en".');
    }

    const endpoint = new URL(`${this.apiBaseUrl}/api/v1/models`);
    if (options.locale) {
      endpoint.searchParams.set("locale", options.locale);
    }
    const response = await this.requestJSON<RawModelListResponse>(endpoint.toString(), { method: "GET" });
    const models = Array.isArray(response.data) ? response.data : response.data?.models;
    if (!Array.isArray(models)) {
      throw new Error("JoyToken model list response must contain data.models or an array in data.");
    }

    return {
      ...response,
      data: { models },
    };
  }

  private async getModelMetadata(): Promise<ModelMetadataResponse> {
    this.requireAPIKey();
    return this.requestJSON<ModelMetadataResponse>(`${this.apiBaseUrl}/api/v1/models/meta`, { method: "GET" });
  }

  private async getPricing(): Promise<PricingResponse> {
    this.requireAPIKey();
    return this.requestJSON<PricingResponse>(`${this.apiBaseUrl}/api/v1/pricing`, { method: "GET" });
  }

  private requireAPIKey(): void {
    if (!this.apiKey?.trim()) {
      throw new Error("JoyToken API key is required. Pass apiKey or set JOY_TOKEN_API_KEY.");
    }
  }

  private requireAutoModel(model: unknown): void {
    if (model !== "auto") {
      throw new Error('JoyToken model must be "auto".');
    }
  }

  private async requestJSON<T>(url: string, init: RequestInit, auth: "bearer" | "x-api-key" = "bearer"): Promise<T> {
    const activeRequest = await this.requestRaw(url, init, auth);
    try {
      return (await activeRequest.response.json()) as T;
    } finally {
      activeRequest.cleanup();
    }
  }

  private async requestRaw(
    url: string,
    init: RequestInit,
    auth: "bearer" | "x-api-key" = "bearer",
  ): Promise<ActiveRequest> {
    const controller = this.timeoutMs !== undefined && this.timeoutMs > 0 ? new AbortController() : undefined;
    const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (timeout) clearTimeout(timeout);
    };

    try {
      const response = await this.fetcher(url, {
        ...init,
        signal: init.signal ?? controller?.signal,
        headers: this.headers(init.headers, auth),
      });

      if (!response.ok) {
        throw await buildAPIError(response);
      }

      return { response, cleanup };
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private headers(headers: HeadersInit | undefined, auth: "bearer" | "x-api-key"): Headers {
    const output = new Headers();
    for (const [key, value] of Object.entries(this.defaultHeaders)) {
      output.set(key, value);
    }

    // Request-specific SDK headers take precedence over general defaults.
    for (const [key, value] of new Headers(headers)) {
      output.set(key, value);
    }
    if (globalThis.process?.versions?.node && !output.has("User-Agent")) {
      output.set("User-Agent", `joytoken-client-sdk-ts/${SDK_VERSION}`);
    }
    if (!output.has("Accept")) output.set("Accept", "application/json");
    if (!output.has("Content-Type")) output.set("Content-Type", "application/json");

    if (auth === "x-api-key") {
      output.delete("Authorization");
      if (this.apiKey) output.set("x-api-key", this.apiKey);
    } else {
      output.delete("x-api-key");
      if (this.apiKey) output.set("Authorization", `Bearer ${this.apiKey}`);
    }

    return output;
  }
}

async function* readSSE<T>(response: Response): AsyncIterable<T> {
  if (!response.body) {
    throw new JoyTokenAPIError("JoyToken streaming response did not include a body", {
      status: response.status,
      responseHeaders: response.headers,
      body: undefined,
      requestId: extractRequestId(response.headers),
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        if (buffer) {
          dataLines = appendSSELine(dataLines, buffer);
          buffer = "";
        }
        const finalValue = parseSSEEvent<T>(dataLines);
        if (finalValue === STREAM_DONE) return;
        if (finalValue !== undefined) yield finalValue;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line === "") {
          const value = parseSSEEvent<T>(dataLines);
          dataLines = [];
          if (value === STREAM_DONE) return;
          if (value !== undefined) yield value;
          continue;
        }
        dataLines = appendSSELine(dataLines, line);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function appendSSELine(dataLines: string[], line: string): string[] {
  if (line.startsWith(":")) return dataLines;
  if (!line.startsWith("data:")) return dataLines;
  const value = line.slice("data:".length);
  return [...dataLines, value.startsWith(" ") ? value.slice(1) : value];
}

function parseSSEEvent<T>(dataLines: string[]): T | typeof STREAM_DONE | undefined {
  if (dataLines.length === 0) return undefined;
  const data = dataLines.join("\n").trim();
  if (data === "[DONE]") return STREAM_DONE;
  return JSON.parse(data) as T;
}

async function buildAPIError(response: Response): Promise<JoyTokenAPIError> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  const message =
    typeof body === "object" && body && "error" in body
      ? JSON.stringify((body as { error: unknown }).error)
      : `JoyToken API request failed with status ${response.status}`;

  return new JoyTokenAPIError(message, {
    status: response.status,
    responseHeaders: response.headers,
    body,
    requestId: extractRequestId(response.headers),
  });
}

function extractRequestId(headers: Headers): string | undefined {
  return headers.get("x-request-id") ?? headers.get("x-daoe-request-id") ?? undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
