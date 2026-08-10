import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ChatCompletionStreamRequest, ImageGenerationRequest, ImageGenerationResponse, JoyTokenClientOptions, ListModelsOptions, MessageRequest, MessageResponse, MessageStreamEvent, MessageStreamRequest, ModelListResponse, ModelMetadataResponse, PricingResponse, Response as JoyTokenResponse, ResponseRequest, ResponseStreamEvent, ResponseStreamRequest } from "./types.js";
export declare class JoyTokenAPIError extends Error {
    readonly status: number;
    readonly requestId?: string;
    readonly responseHeaders: Headers;
    readonly body: unknown;
    constructor(message: string, options: {
        status: number;
        responseHeaders: Headers;
        body: unknown;
        requestId?: string;
    });
}
export declare class JoyTokenClient {
    readonly apiBaseUrl: string;
    readonly openAIBaseUrl: string;
    readonly anthropicBaseUrl: string;
    readonly anthropicVersion: string;
    readonly timeoutMs: number;
    private readonly apiKey?;
    private readonly fetcher;
    private readonly defaultHeaders;
    readonly chat: {
        completions: {
            create: (request: ChatCompletionRequest) => Promise<ChatCompletionResponse>;
            stream: (request: Omit<ChatCompletionStreamRequest, "stream">) => AsyncIterable<ChatCompletionChunk>;
        };
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
    readonly messages: {
        create: (request: MessageRequest) => Promise<MessageResponse>;
        stream: (request: Omit<MessageStreamRequest, "stream">) => AsyncIterable<MessageStreamEvent>;
    };
    readonly responses: {
        create: (request: ResponseRequest) => Promise<JoyTokenResponse>;
        stream: (request: Omit<ResponseStreamRequest, "stream">) => AsyncIterable<ResponseStreamEvent>;
    };
    constructor(options?: JoyTokenClientOptions);
    private createChatCompletion;
    private streamChatCompletion;
    private createResponse;
    private streamResponse;
    private generateImage;
    private createMessage;
    private streamMessage;
    private listModels;
    private getModelMetadata;
    private getPricing;
    private requireAPIKey;
    private requireAutoModel;
    private requestJSON;
    private requestRaw;
    private headers;
}
//# sourceMappingURL=client.d.ts.map