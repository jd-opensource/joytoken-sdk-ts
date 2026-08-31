import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamRequest, ImageGenerationRequest, ImageGenerationResponse, JoyTokenClientOptions, ListModelsOptions, MessageRequest, MessageResponse, MessageStreamEvent, ModelListResponse, ModelMetadataResponse, PricingResponse, Response as JoyTokenResponse, ResponseRequest, ResponseStreamEvent, ToolRunStreamOptions } from "./types.js";
export type ErrorCode = "rate_limited" | "server_error" | "timeout" | "network" | "invalid_request" | "authentication" | "permission" | "not_found" | "unknown";
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
export declare class JoyTokenAPIError extends Error {
    readonly status: number;
    readonly code: ErrorCode;
    readonly requestId?: string;
    readonly responseHeaders: Headers;
    readonly body: unknown;
    readonly context?: JoyTokenErrorContext;
    constructor(message: string, options: {
        status: number;
        code: ErrorCode;
        responseHeaders: Headers;
        body: unknown;
        requestId?: string;
        context?: JoyTokenErrorContext;
    });
}
export declare class JoyTokenClient {
    readonly apiBaseUrl: string;
    readonly openAIBaseUrl: string;
    /** @deprecated Messages are adapted locally and do not request this URL. */
    readonly anthropicBaseUrl: string;
    /** @deprecated Messages are adapted locally and use the Chat Completions headers. */
    readonly anthropicVersion: string;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    private readonly apiKey?;
    private readonly fetcher;
    private readonly defaultHeaders;
    private readonly chatCompletionsUrl;
    private readonly responsesUrl;
    private readonly registeredTools;
    private readonly defaultLocalTools;
    private readonly defaultBuiltinTools;
    private readonly toolMaxSteps;
    private readonly fileWorkspace?;
    private readonly filePermission?;
    private readonly shellWorkspace?;
    private readonly shellPermission?;
    private readonly excludedDefaultTools;
    readonly chat: {
        completions: {
            create: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
            run: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
            executeTools: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
            stream: (request: Omit<ChatCompletionStreamRequest, "stream">) => AsyncIterable<ChatCompletionChunk>;
            runStream: (request: Omit<ChatCompletionStreamRequest, "stream">, options?: ToolRunStreamOptions) => Promise<ChatCompletionResponse>;
            executeToolsStream: (request: Omit<ChatCompletionStreamRequest, "stream">, options?: ToolRunStreamOptions) => Promise<ChatCompletionResponse>;
        };
    };
    readonly responses: {
        create: (request: ResponseRequest) => Promise<JoyTokenResponse>;
        run: (request: ResponseRequest) => Promise<JoyTokenResponse>;
        executeTools: (request: ResponseRequest) => Promise<JoyTokenResponse>;
        stream: (request: ResponseRequest) => AsyncIterable<ResponseStreamEvent>;
        runStream: (request: ResponseRequest, options?: ToolRunStreamOptions) => Promise<JoyTokenResponse>;
        executeToolsStream: (request: ResponseRequest, options?: ToolRunStreamOptions) => Promise<JoyTokenResponse>;
    };
    readonly messages: {
        create: (request: MessageRequest) => Promise<MessageResponse>;
        run: (request: MessageRequest) => Promise<MessageResponse>;
        executeTools: (request: MessageRequest) => Promise<MessageResponse>;
        stream: (request: MessageRequest) => AsyncIterable<MessageStreamEvent>;
        runStream: (request: MessageRequest, options?: ToolRunStreamOptions) => Promise<MessageResponse>;
        executeToolsStream: (request: MessageRequest, options?: ToolRunStreamOptions) => Promise<MessageResponse>;
    };
    readonly models: {
        list: (options?: ListModelsOptions) => Promise<ModelListResponse>;
        meta: () => Promise<ModelMetadataResponse>;
    };
    readonly images: {
        generate: (request: ImageGenerationRequest) => Promise<ImageGenerationResponse>;
    };
    readonly pricing: {
        retrieve: () => Promise<PricingResponse>;
    };
    constructor(options?: JoyTokenClientOptions);
    private createChatCompletion;
    private runChatCompletionExplicit;
    private completeChat;
    /**
     * createChatCompletionOnce injects tool declarations and performs a single
     * non-streaming request. It never executes tool calls, so it is safe to call
     * from the tool-calling loop without risking recursion.
     */
    private createChatCompletionOnce;
    /**
     * runChatCompletion drives the multi-turn tool-calling loop. Each turn sends
     * the accumulated messages, executes any tool calls whose name maps to a
     * registered executable tool, and appends the tool outputs before the next
     * turn. It stops on a plain stop finish, when no executable tool calls remain,
     * or when the step budget is exhausted.
     */
    private runChatCompletion;
    private streamChatCompletion;
    private runChatCompletionStreamExplicit;
    private runChatCompletionStream;
    private collectChatStreamTurn;
    private streamChatCompletionWire;
    private createResponse;
    private runResponseExplicit;
    private runResponseStreamExplicit;
    private createResponseOnce;
    private completeResponse;
    private streamResponse;
    private streamResponseWire;
    private collectResponseStreamTurn;
    private createMessage;
    private runMessageExplicit;
    private streamMessage;
    private runMessageStreamExplicit;
    private generateImage;
    private listModels;
    private getModelMetadata;
    private getPricing;
    private requireAPIKey;
    private requireAutoModel;
    private toolSet;
    private defaultToolSet;
    private chatToolPlan;
    private responseToolPlan;
    private messageToolPlan;
    private toolPlan;
    private runTool;
    private requestJSON;
    /**
     * Non-streaming Chat requests need the same mid-payload error guard as the
     * streaming path: the Gateway can answer HTTP 200 with an
     * `{"error":{...},"choices":[]}` envelope (for example a failed orchestration
     * run). requestJSON alone would surface that as an empty response, so detect
     * the error envelope on the raw body before returning.
     */
    private requestChatCompletionJSON;
    private requestRaw;
    private headers;
}
//# sourceMappingURL=client.d.ts.map