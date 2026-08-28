import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionStreamRequest,
  ChatMessage,
  ChatTool,
  ImageGenerationRequest,
  ImageGenerationResponse,
  JoyTokenClientOptions,
  ListModelsOptions,
  MessageRequest,
  MessageResponse,
  MessageStreamEvent,
  MessageStreamRequest,
  MessageTool,
  ModelInfo,
  ModelListResponse,
  ModelMetadataResponse,
  PricingResponse,
  Response as JoyTokenResponse,
  ResponseInputItem,
  ResponseRequest,
  ResponseOutputItem,
  ResponseStreamEvent,
  ResponseStreamRequest,
  ResponseTool,
  ToolCall,
  ToolCallResult,
  ToolRunStreamOptions,
} from "./types.js";
import {
  calculator,
  dateTime,
  parseToolArguments,
  safeExecuteTool,
  stringifyToolResult,
  toChatTool,
  toResponseTool,
  type Tool,
  type ToolExecutionContext,
} from "./tools.js";
import {
  chatResponseToMessage,
  chatStreamToMessages,
  messageRequestToChat,
  messageToolToChat,
  type ChatWireTool,
} from "./compat.js";
import { fileRead, fileWrite, listDir, fileSearch, absRoot } from "./file-tools.js";
import { gateFileWrite, type FilePermissionFunc } from "./file-permission.js";
import { shell, absWorkingDir } from "./shell-tools.js";
import { gateShell, type ShellPermissionFunc } from "./shell-permission.js";
import { FinishReasonKind, classifyFinishReason, malformedToolCallNudge } from "./finish-reason.js";
import { mergeOpaqueObject } from "./opaque.js";

const DEFAULT_API_BASE_URL = "https://api.joytokens.ai";
const SDK_VERSION = "0.2.0";
const DEFAULT_TIMEOUT_MS = 60_000;
// Model generation requests are not inherently idempotent: a provider may
// have completed and billed a request even when the client receives a
// transport or Gateway error. Keep retries opt-in so the SDK does not duplicate
// model calls or amplify an upstream circuit breaker by default.
const DEFAULT_MAX_RETRIES = 0;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;
const DEFAULT_TOOL_MAX_STEPS = 8;
const STREAM_DONE = Symbol("stream-done");

interface ActiveRequest {
  response: Response;
  cleanup(): void;
}

interface RawModelListResponse extends Omit<ModelListResponse, "data"> {
  data: ModelInfo[] | { models?: ModelInfo[] };
}

interface ToolPlan<TDeclaration> {
  declarations: TDeclaration[] | undefined;
  executables: Map<string, Tool>;
  automatic: boolean;
}

export type ErrorCode =
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "network"
  | "invalid_request"
  | "authentication"
  | "permission"
  | "not_found"
  | "unknown";

export type JoyTokenProtocol = "chat" | "responses" | "messages";

export interface JoyTokenToolCallDiagnostic {
  readonly id: string;
  readonly name: string;
  /** Whether the Gateway supplied opaque provider metadata for this call. */
  readonly hasExtraContent: boolean;
}

/**
 * Read-only execution context attached to HTTP errors from model requests.
 * It describes where the failure occurred without changing or retrying the
 * request, and deliberately excludes tool arguments and results.
 */
export interface JoyTokenErrorContext {
  readonly protocol: JoyTokenProtocol;
  readonly phase: "initial_request" | "tool_continuation" | "repair_continuation";
  /** One-based model request number within the public SDK call. */
  readonly requestNumber: number;
  /** One-based tool step whose results were submitted by this continuation. */
  readonly toolStep?: number;
  readonly toolCalls?: readonly JoyTokenToolCallDiagnostic[];
}

/** Maps an HTTP status code to a provider-neutral ErrorCode, aligned with the Go SDK. */
function classifyStatus(status: number): ErrorCode {
  if (status === 429) return "rate_limited";
  if (status === 401) return "authentication";
  if (status === 403) return "permission";
  if (status === 404) return "not_found";
  if (status === 400 || status === 422) return "invalid_request";
  if (status >= 500 && status <= 599) return "server_error";
  return "unknown";
}

export class JoyTokenAPIError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly requestId?: string;
  readonly responseHeaders: Headers;
  readonly body: unknown;
  readonly context?: JoyTokenErrorContext;

  constructor(
    message: string,
    options: {
      status: number;
      code: ErrorCode;
      responseHeaders: Headers;
      body: unknown;
      requestId?: string;
      context?: JoyTokenErrorContext;
    },
  ) {
    super(message);
    this.name = "JoyTokenAPIError";
    this.status = options.status;
    this.code = options.code;
    this.responseHeaders = options.responseHeaders;
    this.body = options.body;
    this.requestId = options.requestId;
    this.context = options.context;
  }
}

export class JoyTokenClient {
  readonly apiBaseUrl: string;
  readonly openAIBaseUrl: string;
  /** @deprecated Messages are adapted locally and do not request this URL. */
  readonly anthropicBaseUrl: string;
  /** @deprecated Messages are adapted locally and use the Chat Completions headers. */
  readonly anthropicVersion: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  private readonly apiKey?: string;
  private readonly fetcher: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;
  private readonly chatCompletionsUrl: string;
  private readonly responsesUrl: string;

  private readonly registeredTools: Tool[];
  private readonly defaultLocalTools: boolean;
  private readonly defaultBuiltinTools: boolean;
  private readonly toolMaxSteps: number;
  private readonly fileWorkspace?: string;
  private readonly filePermission?: FilePermissionFunc;
  private readonly shellWorkspace?: string;
  private readonly shellPermission?: ShellPermissionFunc;
  private readonly excludedDefaultTools: Set<string>;

  readonly chat = {
    completions: {
      create: (request: ChatCompletionRequest): Promise<ChatCompletionResponse> => this.createChatCompletion(request),
      run: (request: ChatCompletionRequest): Promise<ChatCompletionResponse> => this.runChatCompletionExplicit(request),
      executeTools: (request: ChatCompletionRequest): Promise<ChatCompletionResponse> =>
        this.runChatCompletionExplicit(request),
      stream: (request: Omit<ChatCompletionStreamRequest, "stream">): AsyncIterable<ChatCompletionChunk> =>
        this.streamChatCompletion({ ...request, stream: true }),
      runStream: (
        request: Omit<ChatCompletionStreamRequest, "stream">,
        options: ToolRunStreamOptions = {},
      ): Promise<ChatCompletionResponse> => this.runChatCompletionStreamExplicit(request, options),
      executeToolsStream: (
        request: Omit<ChatCompletionStreamRequest, "stream">,
        options: ToolRunStreamOptions = {},
      ): Promise<ChatCompletionResponse> => this.runChatCompletionStreamExplicit(request, options),
    },
  };

  readonly responses = {
    create: (request: ResponseRequest): Promise<JoyTokenResponse> => this.createResponse(request),
    run: (request: ResponseRequest): Promise<JoyTokenResponse> => this.runResponseExplicit(request),
    executeTools: (request: ResponseRequest): Promise<JoyTokenResponse> => this.runResponseExplicit(request),
    stream: (request: ResponseRequest): AsyncIterable<ResponseStreamEvent> =>
      this.streamResponse({ ...request, stream: true }),
    runStream: (request: ResponseRequest, options: ToolRunStreamOptions = {}): Promise<JoyTokenResponse> =>
      this.runResponseStreamExplicit(request, options),
    executeToolsStream: (request: ResponseRequest, options: ToolRunStreamOptions = {}): Promise<JoyTokenResponse> =>
      this.runResponseStreamExplicit(request, options),
  };

  readonly messages = {
    create: (request: MessageRequest): Promise<MessageResponse> => this.createMessage(request),
    run: (request: MessageRequest): Promise<MessageResponse> => this.runMessageExplicit(request),
    executeTools: (request: MessageRequest): Promise<MessageResponse> => this.runMessageExplicit(request),
    stream: (request: MessageRequest): AsyncIterable<MessageStreamEvent> =>
      this.streamMessage({ ...request, stream: true }),
    runStream: (
      request: MessageRequest,
      options: ToolRunStreamOptions = {},
    ): Promise<MessageResponse> => this.runMessageStreamExplicit(request, options),
    executeToolsStream: (
      request: MessageRequest,
      options: ToolRunStreamOptions = {},
    ): Promise<MessageResponse> => this.runMessageStreamExplicit(request, options),
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

  constructor(options: JoyTokenClientOptions = {}) {
    const env = globalThis.process?.env;
    this.apiKey = options.apiKey ?? env?.JOY_TOKEN_API_KEY;
    const configuredApiBase = options.apiBaseUrl ?? env?.JOY_TOKEN_API_BASE_URL;
    const configuredAnthropicBase = options.anthropicBaseUrl ?? env?.JOY_TOKEN_ANTHROPIC_BASE_URL;
    this.apiBaseUrl = trimTrailingSlash(configuredApiBase ?? DEFAULT_API_BASE_URL);
    const configuredModelBase =
      options.openAIBaseUrl ??
      env?.JOY_TOKEN_OPENAI_BASE_URL ??
      configuredApiBase ??
      configuredAnthropicBase ??
      DEFAULT_API_BASE_URL;
    this.openAIBaseUrl = deriveOpenAIBaseUrl(configuredModelBase);
    this.chatCompletionsUrl = `${this.openAIBaseUrl}/chat/completions`;
    this.responsesUrl = `${this.openAIBaseUrl}/responses`;
    this.anthropicBaseUrl = trimTrailingSlash(configuredAnthropicBase ?? `${this.apiBaseUrl}/anthropic/v1`);
    this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries !== undefined && options.maxRetries > 0 ? options.maxRetries : options.maxRetries === 0 ? 0 : DEFAULT_MAX_RETRIES;

    this.registeredTools = options.tools ? [...options.tools] : [];
    this.defaultLocalTools = options.defaultLocalTools ?? true;
    this.defaultBuiltinTools = options.defaultBuiltinTools ?? false;
    this.toolMaxSteps = options.toolMaxSteps && options.toolMaxSteps > 0 ? options.toolMaxSteps : DEFAULT_TOOL_MAX_STEPS;
    this.fileWorkspace = options.fileWorkspace;
    this.filePermission = options.filePermission;
    this.shellWorkspace = options.shellWorkspace;
    this.shellPermission = options.shellPermission;
    this.excludedDefaultTools = new Set((options.excludedDefaultTools ?? []).filter((name) => name !== ""));

    if (!this.fetcher) {
      throw new Error("No fetch implementation available. Pass JoyTokenClient({ fetch }) in this runtime.");
    }
  }

  private async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const plan = this.chatToolPlan(request.tools);
    return this.completeChat(request, plan, plan.automatic, "chat");
  }

  private async runChatCompletionExplicit(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return this.completeChat(request, this.chatToolPlan(request.tools), true, "chat");
  }

  private async completeChat(
    request: ChatCompletionRequest,
    plan: ToolPlan<ChatWireTool>,
    executeTools: boolean,
    protocol: JoyTokenProtocol,
  ): Promise<ChatCompletionResponse> {
    const first = await withAPIErrorContext(
      requestErrorContext(protocol, "initial_request", 1),
      () => this.createChatCompletionOnce(request, plan.declarations),
    );
    if (!executeTools) return first;
    return this.runChatCompletion(request, plan, first, protocol);
  }

  /**
   * createChatCompletionOnce injects tool declarations and performs a single
   * non-streaming request. It never executes tool calls, so it is safe to call
   * from the tool-calling loop without risking recursion.
   */
  private async createChatCompletionOnce(
    request: ChatCompletionRequest,
    declarations: ChatWireTool[] | undefined,
  ): Promise<ChatCompletionResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    if (request.stream) {
      throw new Error("Use joytoken.chat.completions.stream() for streaming responses.");
    }

    const { tools: _requestTools, ...rest } = request;
    const body = {
      ...rest,
      stream: false,
      ...(declarations === undefined ? {} : { tools: declarations }),
    };

    return this.requestJSON<ChatCompletionResponse>(this.chatCompletionsUrl, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * runChatCompletion drives the multi-turn tool-calling loop. Each turn sends
   * the accumulated messages, executes any tool calls whose name maps to a
   * registered executable tool, and appends the tool outputs before the next
   * turn. It stops on a plain stop finish, when no executable tool calls remain,
   * or when the step budget is exhausted.
   */
  private async runChatCompletion(
    request: ChatCompletionRequest,
    plan: ToolPlan<ChatWireTool>,
    first: ChatCompletionResponse,
    protocol: JoyTokenProtocol,
  ): Promise<ChatCompletionResponse> {
    const messages: ChatMessage[] = [...(request.messages as ChatMessage[])];
    let response = first;

    for (let step = 0; step < this.toolMaxSteps; step += 1) {
      const choice = response.choices?.[0];
      const message = choice?.message;
      if (!message) {
        return response;
      }

      messages.push(message);
      const kind = classifyFinishReason(choice?.finish_reason);
      const toolCalls = message.tool_calls ?? [];

      if (kind === FinishReasonKind.MalformedToolCall && toolCalls.length === 0) {
        messages.push({ role: "user", content: malformedToolCallNudge });
        response = await withAPIErrorContext(
          requestErrorContext(protocol, "repair_continuation", step + 2),
          () => this.createChatCompletionOnce({ ...request, messages }, plan.declarations),
        );
        continue;
      }

      if (toolCalls.length === 0) {
        return response;
      }
      for (const toolCall of toolCalls) {
        const result = await this.runTool(plan.executables, step, toolCall, messages);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function?.name,
          content: result.content,
        });
      }
      response = await withAPIErrorContext(
        requestErrorContext(protocol, "tool_continuation", step + 2, step + 1, toolCalls),
        () => this.createChatCompletionOnce({ ...request, messages }, plan.declarations),
      );
    }

    return response;
  }

  private async *streamChatCompletion(request: ChatCompletionStreamRequest): AsyncIterable<ChatCompletionChunk> {
    const plan = this.chatToolPlan(request.tools as ChatTool[] | undefined);
    try {
      yield* this.streamChatCompletionWire(request, plan.declarations);
    } catch (error) {
      throw attachAPIErrorContext(error, requestErrorContext("chat", "initial_request", 1));
    }
  }

  private async runChatCompletionStreamExplicit(
    request: Omit<ChatCompletionStreamRequest, "stream">,
    options: ToolRunStreamOptions,
  ): Promise<ChatCompletionResponse> {
    const plan = this.chatToolPlan(request.tools as ChatTool[] | undefined);
    return this.runChatCompletionStream(request, plan, options, "chat");
  }

  private async runChatCompletionStream(
    request: Omit<ChatCompletionStreamRequest, "stream">,
    plan: ToolPlan<ChatWireTool>,
    options: ToolRunStreamOptions,
    protocol: JoyTokenProtocol,
  ): Promise<ChatCompletionResponse> {
    const messages: ChatMessage[] = [...(request.messages as ChatMessage[])];
    let response: ChatCompletionResponse | undefined;
    let continuationCalls: ToolCall[] = [];

    for (let step = 0; step < this.toolMaxSteps; step += 1) {
      const context = step === 0
        ? requestErrorContext(protocol, "initial_request", 1)
        : requestErrorContext(protocol, "tool_continuation", step + 1, step, continuationCalls);
      response = await withAPIErrorContext(
        context,
        () => this.collectChatStreamTurn(
          { ...request, messages, stream: true },
          plan.declarations,
          options.onTextDelta,
        ),
      );
      const message = response.choices[0]?.message;
      if (!message) return response;
      messages.push(message);
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) return response;
      continuationCalls = toolCalls;
      for (const toolCall of toolCalls) {
        const result = await this.runTool(plan.executables, step, toolCall, messages);
        options.onToolResult?.(result);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function?.name,
          content: result.content,
        });
      }
    }
    return response ?? emptyChatResponse();
  }

  private async collectChatStreamTurn(
    request: ChatCompletionStreamRequest,
    declarations: ChatWireTool[] | undefined,
    onTextDelta?: (delta: string) => void,
  ): Promise<ChatCompletionResponse> {
    let id: string | undefined;
    let object: string | undefined;
    let created: number | undefined;
    let model: string | undefined;
    let usage: ChatCompletionResponse["usage"];
    let finishReason: string | null | undefined;
    let content = "";
    let extraMetadata: Record<string, unknown> = {};
    const calls = new Map<number, {
      id: string;
      type: "function";
      name: string;
      arguments: string;
      extra_content?: Record<string, unknown>;
    }>();
    for await (const chunk of this.streamChatCompletionWire(request, declarations)) {
      const {
        id: _id,
        object: _object,
        created: _created,
        model: _model,
        choices: _choices,
        usage: _usage,
        ...chunkMetadata
      } = chunk;
      extraMetadata = { ...extraMetadata, ...chunkMetadata };
      id = chunk.id ?? id;
      object = chunk.object ?? object;
      created = chunk.created ?? created;
      model = chunk.model ?? model;
      usage = chunk.usage ?? usage;
      for (const choice of chunk.choices ?? []) {
        finishReason = choice.finish_reason ?? finishReason;
        const delta = choice.delta as Partial<ChatMessage> & { tool_calls?: Array<Record<string, unknown>> };
        const text = chatContentText(delta.content);
        if (text) {
          content += text;
          onTextDelta?.(text);
        }
        for (const raw of delta.tool_calls ?? []) {
          const index = typeof raw.index === "number" ? raw.index : 0;
          const fn = (raw.function ?? {}) as Record<string, unknown>;
          const call = calls.get(index) ?? { id: "", type: "function", name: "", arguments: "" };
          if (typeof raw.id === "string" && raw.id) call.id = raw.id;
          if (raw.type === "function") call.type = raw.type;
          if (typeof fn.name === "string") call.name += fn.name;
          if (typeof fn.arguments === "string") call.arguments += fn.arguments;
          call.extra_content = mergeOpaqueObject(call.extra_content, raw.extra_content);
          calls.set(index, call);
        }
      }
    }
    return {
      ...extraMetadata,
      ...(id === undefined ? {} : { id }),
      ...(object === undefined ? {} : { object }),
      ...(created === undefined ? {} : { created }),
      ...(model === undefined ? {} : { model }),
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: content || null,
          ...(calls.size
            ? {
                tool_calls: [...calls.values()].map((call): ToolCall => ({
                  id: call.id,
                  type: call.type,
                  function: { name: call.name, arguments: call.arguments },
                  ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
                })),
              }
            : {}),
        },
        finish_reason: finishReason,
      }],
      ...(usage === undefined ? {} : { usage }),
    };
  }

  private async *streamChatCompletionWire(
    request: ChatCompletionStreamRequest,
    declarations: ChatWireTool[] | undefined,
  ): AsyncIterable<ChatCompletionChunk> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    const { tools: _requestTools, ...rest } = request;
    const activeRequest = await this.requestRaw(this.chatCompletionsUrl, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify({
        ...rest,
        stream: true,
        stream_options: { ...(request.stream_options as Record<string, unknown> | undefined), include_usage: true },
        ...(declarations === undefined ? {} : { tools: declarations }),
      }),
    });

    try {
      for await (const event of readSSE<unknown>(activeRequest.response)) {
        yield normalizeChatCompletionChunk(event);
      }
    } finally {
      activeRequest.cleanup();
    }
  }

  private async createResponse(request: ResponseRequest): Promise<JoyTokenResponse> {
    const plan = this.responseToolPlan(request.tools);
    if (!plan.automatic) {
      return withAPIErrorContext(
        requestErrorContext("responses", "initial_request", 1),
        () => this.createResponseOnce(request, plan.declarations),
      );
    }
    return this.completeResponse(request, plan);
  }

  private async runResponseExplicit(request: ResponseRequest): Promise<JoyTokenResponse> {
    return this.completeResponse(request, this.responseToolPlan(request.tools));
  }

  private async runResponseStreamExplicit(
    request: ResponseRequest,
    options: ToolRunStreamOptions,
  ): Promise<JoyTokenResponse> {
    return this.completeResponse(request, this.responseToolPlan(request.tools), options);
  }

  private async createResponseOnce(
    request: ResponseRequest,
    declarations: ResponseTool[] | undefined,
  ): Promise<JoyTokenResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    if (request.stream) throw new Error("Use joytoken.responses.stream() for streaming responses.");
    const { tools: _requestTools, ...rest } = request;
    const response = await this.requestJSON<JoyTokenResponse>(this.responsesUrl, {
      method: "POST",
      body: JSON.stringify({
        ...rest,
        stream: false,
        ...(declarations === undefined ? {} : { tools: declarations }),
      }),
    });
    return withResponseOutputText(response);
  }

  private async completeResponse(
    request: ResponseRequest,
    plan: ToolPlan<ResponseTool>,
    streamOptions?: ToolRunStreamOptions,
  ): Promise<JoyTokenResponse> {
    let input = normalizeResponseInput(request.input);
    const chained = request.previous_response_id !== undefined;
    let previousResponseId = request.previous_response_id;
    const requestTurn = async (context: JoyTokenErrorContext): Promise<JoyTokenResponse> => {
      const stepRequest: ResponseRequest = {
        ...request,
        input,
        ...(previousResponseId === undefined ? {} : { previous_response_id: previousResponseId }),
      };
      return withAPIErrorContext(
        context,
        () => streamOptions
          ? this.collectResponseStreamTurn({ ...stepRequest, stream: true }, plan.declarations, streamOptions.onTextDelta)
          : this.createResponseOnce(stepRequest, plan.declarations),
      );
    };
    let response = await requestTurn(requestErrorContext("responses", "initial_request", 1));

    for (let step = 0; step < this.toolMaxSteps; step += 1) {
      const calls = responseFunctionCalls(response);
      if (calls.length === 0) return response;

      const replay = chained ? [] : [...input, ...(response.output ?? []).map(responseOutputToInput)];
      const outputs: ResponseInputItem[] = [];
      for (const call of calls) {
        const toolCall = responseFunctionCallToToolCall(call);
        const result = await this.runTool(
          plan.executables,
          step,
          toolCall,
          responseInputToContextMessages(chained ? [...input, responseOutputToInput(call)] : replay, request.instructions),
        );
        streamOptions?.onToolResult?.(result);
        outputs.push({
          type: "function_call_output",
          call_id: result.tool_call_id,
          output: result.content,
        });
      }
      input = [...replay, ...outputs];
      if (chained) previousResponseId = response.id;
      const toolCalls = calls.map(responseFunctionCallToToolCall);
      response = await requestTurn(
        requestErrorContext("responses", "tool_continuation", step + 2, step + 1, toolCalls),
      );
    }
    return response;
  }

  private async *streamResponse(request: ResponseStreamRequest): AsyncIterable<ResponseStreamEvent> {
    const plan = this.responseToolPlan(request.tools as ResponseTool[] | undefined);
    try {
      yield* this.streamResponseWire(request, plan.declarations);
    } catch (error) {
      throw attachAPIErrorContext(error, requestErrorContext("responses", "initial_request", 1));
    }
  }

  private async *streamResponseWire(
    request: ResponseStreamRequest,
    declarations: ResponseTool[] | undefined,
  ): AsyncIterable<ResponseStreamEvent> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    const { tools: _requestTools, ...rest } = request;
    const activeRequest = await this.requestRaw(this.responsesUrl, {
      method: "POST",
      headers: { Accept: "text/event-stream" },
      body: JSON.stringify({
        ...rest,
        stream: true,
        ...(declarations === undefined ? {} : { tools: declarations }),
      }),
    });
    try {
      yield* readSSE<ResponseStreamEvent>(activeRequest.response);
    } finally {
      activeRequest.cleanup();
    }
  }

  private async collectResponseStreamTurn(
    request: ResponseStreamRequest,
    declarations: ResponseTool[] | undefined,
    onTextDelta?: (delta: string) => void,
  ): Promise<JoyTokenResponse> {
    let terminalResponse: JoyTokenResponse | undefined;
    const output: Array<ResponseOutputItem | undefined> = [];
    for await (const event of this.streamResponseWire(request, declarations)) {
      if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
        onTextDelta?.(event.delta);
      }
      if (event.type === "response.output_item.done" && event.item) {
        output[event.output_index ?? output.length] = event.item;
      }
      if (event.type === "error") {
        throw new Error(`JoyToken Responses stream error: ${JSON.stringify(event.error ?? event)}`);
      }
      if (
        event.response &&
        (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed")
      ) {
        terminalResponse = event.response;
      }
    }
    if (!terminalResponse) {
      throw new Error("JoyToken Responses stream ended without a terminal response event.");
    }
    const terminalOutput = terminalResponse.output ?? [];
    const outputLength = Math.max(output.length, terminalOutput.length);
    const collectedOutput = Array.from({ length: outputLength }, (_, index): ResponseOutputItem | undefined => {
      const streamed = output[index];
      const terminal = terminalOutput[index];
      if (!streamed) return terminal;
      if (!terminal) return streamed;
      const extraContent = mergeOpaqueObject(streamed.extra_content, terminal.extra_content);
      return {
        ...streamed,
        ...terminal,
        ...(extraContent === undefined ? {} : { extra_content: extraContent }),
      };
    }).filter((item): item is ResponseOutputItem => item !== undefined);
    const response = collectedOutput.length > 0
      ? { ...terminalResponse, output: collectedOutput }
      : terminalResponse;
    return withResponseOutputText(response);
  }

  private async createMessage(request: MessageRequest): Promise<MessageResponse> {
    const plan = this.messageToolPlan(request.tools);
    const response = await this.completeChat(
      messageRequestToChat(request, plan.declarations as ChatTool[] | undefined),
      plan,
      plan.automatic,
      "messages",
    );
    return chatResponseToMessage(response);
  }

  private async runMessageExplicit(request: MessageRequest): Promise<MessageResponse> {
    const plan = this.messageToolPlan(request.tools);
    const response = await this.completeChat(
      messageRequestToChat(request, plan.declarations as ChatTool[] | undefined),
      plan,
      true,
      "messages",
    );
    return chatResponseToMessage(response);
  }

  private async *streamMessage(request: MessageStreamRequest): AsyncIterable<MessageStreamEvent> {
    const plan = this.messageToolPlan(request.tools as MessageTool[] | undefined);
    const chatRequest = messageRequestToChat(request, plan.declarations as ChatTool[] | undefined);
    try {
      yield* chatStreamToMessages(
        this.streamChatCompletionWire({ ...chatRequest, stream: true }, plan.declarations),
      );
    } catch (error) {
      throw attachAPIErrorContext(error, requestErrorContext("messages", "initial_request", 1));
    }
  }

  private async runMessageStreamExplicit(
    request: MessageRequest,
    options: ToolRunStreamOptions,
  ): Promise<MessageResponse> {
    const plan = this.messageToolPlan(request.tools);
    const chatRequest = messageRequestToChat(request, plan.declarations as ChatTool[] | undefined);
    const response = await this.runChatCompletionStream(chatRequest, plan, options, "messages");
    return chatResponseToMessage(response);
  }

  private async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    this.requireAutoModel(request.model);
    this.requireAPIKey();
    return this.requestJSON<ImageGenerationResponse>(`${this.openAIBaseUrl}/images/generations`, {
      method: "POST",
      body: JSON.stringify(request),
    });
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

  private toolSet(tools: Tool[]): { byName: Map<string, Tool>; order: Tool[] } {
    const byName = new Map<string, Tool>();
    const order: Tool[] = [];
    const add = (tool: Tool): void => {
      if (!tool.name || byName.has(tool.name)) return;
      byName.set(tool.name, tool);
      order.push(tool);
    };
    for (const tool of tools) add(tool);
    return { byName, order };
  }

  private defaultToolSet(): { byName: Map<string, Tool>; order: Tool[] } {
    const defaults: Tool[] = [];
    const add = (tool: Tool): void => {
      if (!this.excludedDefaultTools.has(tool.name)) defaults.push(tool);
    };
    if (this.defaultLocalTools) {
      add(calculator());
      add(dateTime());
      const sandbox = { root: this.fileWorkspace };
      add(fileSearch(sandbox));
      add(listDir(sandbox));
      add(fileRead(sandbox));
      add(gateFileWrite(fileWrite(sandbox), absRoot(sandbox), this.filePermission));
      const shellSandbox = { workingDir: this.shellWorkspace };
      add(gateShell(shell(shellSandbox), absWorkingDir(shellSandbox), this.shellPermission));
    }
    return this.toolSet(defaults);
  }

  private chatToolPlan(requestTools: ChatTool[] | undefined): ToolPlan<ChatWireTool> {
    return this.toolPlan(
      requestTools,
      requestTools,
      requestTools?.map((tool) => tool.function?.name).filter((name): name is string => Boolean(name)),
    );
  }

  private responseToolPlan(requestTools: ResponseTool[] | undefined): ToolPlan<ResponseTool> {
    const registered = this.toolSet(this.registeredTools);
    if (requestTools !== undefined) {
      assertHostedFileSearchTools(requestTools);
      const names = new Set(
        requestTools
          .filter((tool) => tool.type === "function")
          .map((tool) => (typeof tool.name === "string" ? tool.name : ""))
          .filter(Boolean),
      );
      return {
        declarations: [...requestTools],
        executables: new Map([...registered.byName].filter(([name]) => names.has(name))),
        automatic: false,
      };
    }
    if (this.registeredTools.length > 0) {
      return {
        declarations: this.registeredTools.map(toResponseTool),
        executables: registered.byName,
        automatic: false,
      };
    }
    const defaults = this.defaultToolSet();
    const declarations: ResponseTool[] = defaults.order.map(toResponseTool);
    if (this.defaultBuiltinTools && !this.excludedDefaultTools.has("web_search_preview")) {
      declarations.push({ type: "web_search_preview" });
    }
    return {
      declarations: declarations.length > 0 ? declarations : undefined,
      executables: defaults.byName,
      automatic: defaults.order.length > 0,
    };
  }

  private messageToolPlan(requestTools: MessageTool[] | undefined): ToolPlan<ChatWireTool> {
    return this.toolPlan(requestTools, requestTools?.map(messageToolToChat), requestTools?.map((tool) => tool.name));
  }

  private toolPlan<T, TDeclaration extends ChatWireTool>(
    requestTools: T[] | undefined,
    requestDeclarations: TDeclaration[] | undefined,
    requestNames: string[] | undefined,
  ): ToolPlan<ChatWireTool> {
    const registered = this.toolSet(this.registeredTools);
    if (requestTools !== undefined) {
      const names = new Set(requestNames ?? []);
      const executables = new Map(
        [...registered.byName].filter(([name, tool]) => names.has(name) && typeof tool.execute === "function"),
      );
      return { declarations: requestDeclarations ?? [], executables, automatic: false };
    }
    if (this.registeredTools.length > 0) {
      return {
        declarations: this.registeredTools.map(toChatTool),
        executables: registered.byName,
        automatic: false,
      };
    }
    const defaults = this.defaultToolSet();
    return {
      declarations: defaults.order.length ? defaults.order.map(toChatTool) : undefined,
      executables: defaults.byName,
      automatic: defaults.order.length > 0,
    };
  }

  private async runTool(
    executables: Map<string, Tool>,
    step: number,
    toolCall: ToolCall,
    messages: ChatMessage[],
  ): Promise<ToolCallResult> {
    const name = toolCall.function?.name ?? "";
    const tool = executables.get(name);
    if (!tool || typeof tool.execute !== "function") {
      return {
        tool_call_id: toolCall.id,
        tool_name: name,
        content: JSON.stringify({
          error: {
            type: "tool_handler_not_found",
            tool: name,
            message: `Tool handler not found: ${name}`,
          },
        }),
        is_error: true,
      };
    }

    const input = parseToolArguments(toolCall.function?.arguments ?? "");
    const context: ToolExecutionContext = { step, toolCall, messages };
    const { output, error } = await safeExecuteTool(tool.execute, input, context);
    if (error) {
      return {
        tool_call_id: toolCall.id,
        tool_name: name,
        content: JSON.stringify({ error: { type: "tool_execution_error", tool: name, message: error.message } }),
        is_error: true,
      };
    }
    return {
      tool_call_id: toolCall.id,
      tool_name: name,
      content: stringifyToolResult(output),
      is_error: false,
    };
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
    for (let attempt = 0; ; attempt++) {
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
          // Retry transient server / rate-limit responses before surfacing them.
          if (attempt < this.maxRetries && isRetryableStatus(response.status)) {
            const retryAfter = parseRetryAfter(response.headers.get("retry-after"));
            // Drain the body so the connection can be reused.
            await response.text().catch(() => undefined);
            cleanup();
            await sleep(backoffDelay(attempt, retryAfter), init.signal);
            continue;
          }
          throw await buildAPIError(response);
        }

        return { response, cleanup };
      } catch (error) {
        cleanup();
        // An external abort (caller signal) or timeout is not retried.
        if (init.signal?.aborted) {
          throw error;
        }
        // JoyTokenAPIError already means a non-retryable response reached here.
        if (error instanceof JoyTokenAPIError) {
          throw error;
        }
        // Otherwise it is a network/transport error: retry if budget remains.
        if (attempt < this.maxRetries) {
          await sleep(backoffDelay(attempt, 0), init.signal);
          continue;
        }
        throw error;
      }
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

function chatContentText(content: ChatMessage["content"] | unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : ""))
    .join("");
}

function emptyChatResponse(): ChatCompletionResponse {
  return {
    choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "length" }],
  };
}

function requestErrorContext(
  protocol: JoyTokenProtocol,
  phase: JoyTokenErrorContext["phase"],
  requestNumber: number,
  toolStep?: number,
  toolCalls?: ToolCall[],
): JoyTokenErrorContext {
  return {
    protocol,
    phase,
    requestNumber,
    ...(toolStep === undefined ? {} : { toolStep }),
    ...(toolCalls === undefined
      ? {}
      : {
          toolCalls: toolCalls.map((call) => ({
            id: call.id,
            name: call.function?.name ?? "",
            hasExtraContent: call.extra_content !== undefined,
          })),
        }),
  };
}

async function withAPIErrorContext<T>(
  context: JoyTokenErrorContext,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw attachAPIErrorContext(error, context);
  }
}

function attachAPIErrorContext(error: unknown, context: JoyTokenErrorContext): unknown {
  if (error instanceof JoyTokenAPIError && error.context === undefined) {
    // Preserve the original error instance, stack, status, body, headers and
    // request ID. Only the diagnostic field is added; no request is retried.
    Object.defineProperty(error, "context", {
      value: context,
      enumerable: true,
      configurable: true,
      writable: false,
    });
  }
  return error;
}

function normalizeResponseInput(input: ResponseRequest["input"]): ResponseInputItem[] {
  if (typeof input === "string") {
    return input === "" ? [] : [{ type: "message", role: "user", content: input }];
  }
  return input.map((item) => ({ ...item }));
}

function responseOutputToInput(item: ResponseOutputItem): ResponseInputItem {
  return { ...item } as ResponseInputItem;
}

function responseFunctionCalls(response: JoyTokenResponse): ResponseOutputItem[] {
  return (response.output ?? []).filter((item) => item.type === "function_call");
}

function responseFunctionCallToToolCall(call: ResponseOutputItem): ToolCall {
  return {
    id: call.call_id ?? call.id ?? "",
    type: "function",
    function: { name: call.name ?? "", arguments: call.arguments ?? "" },
    ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
  };
}

function responseOutputText(response: JoyTokenResponse): string {
  let text = "";
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && typeof part.text === "string") text += part.text;
    }
  }
  return text;
}

function withResponseOutputText(response: JoyTokenResponse): JoyTokenResponse {
  return response.output_text === undefined ? { ...response, output_text: responseOutputText(response) } : response;
}

function assertHostedFileSearchTools(tools: ResponseTool[]): void {
  for (const tool of tools) {
    if (tool.type !== "file_search") continue;
    if (!Array.isArray(tool.vector_store_ids) || tool.vector_store_ids.length === 0) {
      throw new Error("Responses hosted file_search requires a non-empty vector_store_ids array.");
    }
  }
}

function responseInputToContextMessages(input: ResponseInputItem[], instructions?: string): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (instructions) messages.push({ role: "system", content: instructions });
  for (const item of input) {
    if (item.type === "function_call") {
      const call: ToolCall = {
        id: item.call_id ?? item.id ?? "",
        type: "function",
        function: { name: item.name ?? "", arguments: item.arguments ?? "" },
        ...(item.extra_content === undefined ? {} : { extra_content: item.extra_content }),
      };
      const previous = messages.at(-1);
      if (previous?.role === "assistant" && previous.tool_calls) previous.tool_calls.push(call);
      else messages.push({ role: "assistant", content: null, tool_calls: [call] });
      continue;
    }
    if (item.type === "function_call_output") {
      messages.push({ role: "tool", tool_call_id: item.call_id ?? "", content: item.output ?? "" });
      continue;
    }
    if (["reasoning", "web_search_call", "file_search_call"].includes(item.type ?? "")) continue;
    const role = item.role === "assistant" || item.role === "system" || item.role === "developer" ? item.role : "user";
    messages.push({ role, content: responseInputContentText(item.content) });
  }
  return messages;
}

function responseInputContentText(content: ResponseInputItem["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => String(part.text ?? "")).join("");
}

/**
 * The Gateway may interleave metadata-only or usage-only SSE events with Chat
 * delta events. Keep every field from the wire while honoring the public
 * ChatCompletionChunk contract: choices is always an array and every exposed
 * choice has a delta object.
 */
function normalizeChatCompletionChunk(value: unknown): ChatCompletionChunk {
  if (!isRecord(value)) {
    throw new TypeError("JoyToken Chat streaming event must be a JSON object");
  }

  const rawChoices = Array.isArray(value.choices) ? value.choices : [];
  const choices = rawChoices.flatMap((rawChoice, fallbackIndex) => {
    if (!isRecord(rawChoice)) return [];
    return [{
      ...rawChoice,
      index: typeof rawChoice.index === "number" ? rawChoice.index : fallbackIndex,
      delta: isRecord(rawChoice.delta) ? rawChoice.delta : {},
    }];
  }) as ChatCompletionChunk["choices"];

  return { ...value, choices } as ChatCompletionChunk;
}

async function* readSSE<T>(response: Response): AsyncIterable<T> {
  if (!response.body) {
    throw new JoyTokenAPIError("JoyToken streaming response did not include a body", {
      status: response.status,
      code: classifyStatus(response.status),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function buildAPIError(response: Response): Promise<JoyTokenAPIError> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }

  const message = extractAPIErrorMessage(body) ?? `JoyToken API request failed with status ${response.status}`;

  return new JoyTokenAPIError(message, {
    status: response.status,
    code: classifyStatus(response.status),
    responseHeaders: response.headers,
    body,
    requestId: extractRequestId(response.headers),
  });
}

function extractAPIErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body || undefined;
  if (!isRecord(body)) return undefined;
  const error = body.error;
  if (typeof error === "string") return error || undefined;
  if (isRecord(error) && typeof error.message === "string" && error.message) return error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return error === undefined ? undefined : JSON.stringify(error);
}

function extractRequestId(headers: Headers): string | undefined {
  return headers.get("x-request-id") ?? headers.get("x-daoe-request-id") ?? undefined;
}

/** Retry on rate-limit (429) and server/gateway errors (5xx); 4xx are deterministic. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Parses a Retry-After header (seconds or HTTP date). Returns 0 when absent/unparseable. */
function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const secs = Number(trimmed);
  if (Number.isInteger(secs) && secs >= 0) {
    return secs * 1000;
  }
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return 0;
}

/**
 * Computes the backoff delay (ms) for the given 0-based attempt. Prefers an
 * explicit Retry-After when provided, otherwise exponential backoff
 * (RETRY_BASE_DELAY_MS * 2^attempt) capped at RETRY_MAX_DELAY_MS with full jitter.
 */
function backoffDelay(attempt: number, retryAfterMs: number): number {
  if (retryAfterMs > 0) {
    return Math.min(retryAfterMs, RETRY_MAX_DELAY_MS);
  }
  const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return Math.floor(Math.random() * (backoff + 1));
}

/** Sleeps for the given ms, aborting early (and rejecting) if the signal fires. */
function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function deriveOpenAIBaseUrl(value: string): string {
  let base = trimTrailingSlash(value);
  base = base.replace(/\/openai\/v1\/(?:chat\/completions|responses|images\/generations)$/i, "/openai/v1");
  base = base.replace(/\/anthropic\/v1(?:\/messages)?$/i, "");
  base = base.replace(/(?:\/openai\/v1){2,}$/i, "/openai/v1");
  return /\/openai\/v1$/i.test(base) ? base : `${base}/openai/v1`;
}
