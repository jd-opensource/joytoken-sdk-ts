const DEFAULT_API_BASE_URL = "https://api.joytokens.ai";
const SDK_VERSION = "0.2.0";
const DEFAULT_TIMEOUT_MS = 60_000;
const STREAM_DONE = Symbol("stream-done");
export class JoyTokenAPIError extends Error {
    status;
    requestId;
    responseHeaders;
    body;
    constructor(message, options) {
        super(message);
        this.name = "JoyTokenAPIError";
        this.status = options.status;
        this.responseHeaders = options.responseHeaders;
        this.body = options.body;
        this.requestId = options.requestId;
    }
}
export class JoyTokenClient {
    apiBaseUrl;
    openAIBaseUrl;
    anthropicBaseUrl;
    anthropicVersion;
    timeoutMs;
    apiKey;
    fetcher;
    defaultHeaders;
    chat = {
        completions: {
            create: (request) => this.createChatCompletion(request),
            stream: (request) => this.streamChatCompletion({ ...request, stream: true }),
        },
    };
    models = {
        list: (options = {}) => this.listModels(options),
        meta: () => this.getModelMetadata(),
    };
    images = {
        generate: (request) => this.generateImage(request),
    };
    pricing = {
        retrieve: () => this.getPricing(),
    };
    messages = {
        create: (request) => this.createMessage(request),
        stream: (request) => this.streamMessage({ ...request, stream: true }),
    };
    responses = {
        create: (request) => this.createResponse(request),
        stream: (request) => this.streamResponse({ ...request, stream: true }),
    };
    constructor(options = {}) {
        const env = globalThis.process?.env;
        this.apiKey = options.apiKey ?? env?.JOY_TOKEN_API_KEY;
        this.apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? env?.JOY_TOKEN_API_BASE_URL ?? DEFAULT_API_BASE_URL);
        this.openAIBaseUrl = trimTrailingSlash(options.openAIBaseUrl ?? env?.JOY_TOKEN_OPENAI_BASE_URL ?? `${this.apiBaseUrl}/openai/v1`);
        this.anthropicBaseUrl = trimTrailingSlash(options.anthropicBaseUrl ?? env?.JOY_TOKEN_ANTHROPIC_BASE_URL ?? `${this.apiBaseUrl}/anthropic/v1`);
        this.anthropicVersion = options.anthropicVersion ?? "2023-06-01";
        this.fetcher = options.fetch ?? globalThis.fetch;
        this.defaultHeaders = options.defaultHeaders ?? {};
        this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        if (!this.fetcher) {
            throw new Error("No fetch implementation available. Pass JoyTokenClient({ fetch }) in this runtime.");
        }
    }
    async createChatCompletion(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        if (request.stream) {
            throw new Error("Use joytoken.chat.completions.stream() for streaming responses.");
        }
        return this.requestJSON(`${this.openAIBaseUrl}/chat/completions`, {
            method: "POST",
            body: JSON.stringify({ ...request, stream: false }),
        });
    }
    async *streamChatCompletion(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        const activeRequest = await this.requestRaw(`${this.openAIBaseUrl}/chat/completions`, {
            method: "POST",
            headers: { Accept: "text/event-stream" },
            body: JSON.stringify({ ...request, stream: true }),
        });
        try {
            yield* readSSE(activeRequest.response);
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async createResponse(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        if (request.stream) {
            throw new Error("Use joytoken.responses.stream() for streaming responses.");
        }
        return this.requestJSON(`${this.openAIBaseUrl}/responses`, {
            method: "POST",
            body: JSON.stringify({ ...request, stream: false }),
        });
    }
    async *streamResponse(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        const activeRequest = await this.requestRaw(`${this.openAIBaseUrl}/responses`, {
            method: "POST",
            headers: { Accept: "text/event-stream" },
            body: JSON.stringify({ ...request, stream: true }),
        });
        try {
            yield* readSSE(activeRequest.response);
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async generateImage(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        return this.requestJSON(`${this.openAIBaseUrl}/images/generations`, {
            method: "POST",
            body: JSON.stringify(request),
        });
    }
    async createMessage(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        if (request.stream) {
            throw new Error("Use joytoken.messages.stream() for streaming responses.");
        }
        return this.requestJSON(`${this.anthropicBaseUrl}/messages`, {
            method: "POST",
            headers: { "anthropic-version": this.anthropicVersion },
            body: JSON.stringify({ ...request, stream: false }),
        }, "x-api-key");
    }
    async *streamMessage(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        const activeRequest = await this.requestRaw(`${this.anthropicBaseUrl}/messages`, {
            method: "POST",
            headers: { Accept: "text/event-stream", "anthropic-version": this.anthropicVersion },
            body: JSON.stringify({ ...request, stream: true }),
        }, "x-api-key");
        try {
            yield* readSSE(activeRequest.response);
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async listModels(options) {
        if (options.locale !== undefined && options.locale !== "zh" && options.locale !== "en") {
            throw new Error('JoyToken model locale must be "zh" or "en".');
        }
        const endpoint = new URL(`${this.apiBaseUrl}/api/v1/models`);
        if (options.locale) {
            endpoint.searchParams.set("locale", options.locale);
        }
        const response = await this.requestJSON(endpoint.toString(), { method: "GET" });
        const models = Array.isArray(response.data) ? response.data : response.data?.models;
        if (!Array.isArray(models)) {
            throw new Error("JoyToken model list response must contain data.models or an array in data.");
        }
        return {
            ...response,
            data: { models },
        };
    }
    async getModelMetadata() {
        this.requireAPIKey();
        return this.requestJSON(`${this.apiBaseUrl}/api/v1/models/meta`, { method: "GET" });
    }
    async getPricing() {
        this.requireAPIKey();
        return this.requestJSON(`${this.apiBaseUrl}/api/v1/pricing`, { method: "GET" });
    }
    requireAPIKey() {
        if (!this.apiKey?.trim()) {
            throw new Error("JoyToken API key is required. Pass apiKey or set JOY_TOKEN_API_KEY.");
        }
    }
    requireAutoModel(model) {
        if (model !== "auto") {
            throw new Error('JoyToken model must be "auto".');
        }
    }
    async requestJSON(url, init, auth = "bearer") {
        const activeRequest = await this.requestRaw(url, init, auth);
        try {
            return (await activeRequest.response.json());
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async requestRaw(url, init, auth = "bearer") {
        const controller = this.timeoutMs !== undefined && this.timeoutMs > 0 ? new AbortController() : undefined;
        const timeout = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp)
                return;
            cleanedUp = true;
            if (timeout)
                clearTimeout(timeout);
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
        }
        catch (error) {
            cleanup();
            throw error;
        }
    }
    headers(headers, auth) {
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
        if (!output.has("Accept"))
            output.set("Accept", "application/json");
        if (!output.has("Content-Type"))
            output.set("Content-Type", "application/json");
        if (auth === "x-api-key") {
            output.delete("Authorization");
            if (this.apiKey)
                output.set("x-api-key", this.apiKey);
        }
        else {
            output.delete("x-api-key");
            if (this.apiKey)
                output.set("Authorization", `Bearer ${this.apiKey}`);
        }
        return output;
    }
}
async function* readSSE(response) {
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
    let dataLines = [];
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                buffer += decoder.decode();
                if (buffer) {
                    dataLines = appendSSELine(dataLines, buffer);
                    buffer = "";
                }
                const finalValue = parseSSEEvent(dataLines);
                if (finalValue === STREAM_DONE)
                    return;
                if (finalValue !== undefined)
                    yield finalValue;
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                if (line === "") {
                    const value = parseSSEEvent(dataLines);
                    dataLines = [];
                    if (value === STREAM_DONE)
                        return;
                    if (value !== undefined)
                        yield value;
                    continue;
                }
                dataLines = appendSSELine(dataLines, line);
            }
        }
    }
    finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}
function appendSSELine(dataLines, line) {
    if (line.startsWith(":"))
        return dataLines;
    if (!line.startsWith("data:"))
        return dataLines;
    const value = line.slice("data:".length);
    return [...dataLines, value.startsWith(" ") ? value.slice(1) : value];
}
function parseSSEEvent(dataLines) {
    if (dataLines.length === 0)
        return undefined;
    const data = dataLines.join("\n").trim();
    if (data === "[DONE]")
        return STREAM_DONE;
    return JSON.parse(data);
}
async function buildAPIError(response) {
    const text = await response.text();
    let body = text;
    try {
        body = text ? JSON.parse(text) : undefined;
    }
    catch {
        body = text;
    }
    const message = typeof body === "object" && body && "error" in body
        ? JSON.stringify(body.error)
        : `JoyToken API request failed with status ${response.status}`;
    return new JoyTokenAPIError(message, {
        status: response.status,
        responseHeaders: response.headers,
        body,
        requestId: extractRequestId(response.headers),
    });
}
function extractRequestId(headers) {
    return headers.get("x-request-id") ?? headers.get("x-daoe-request-id") ?? undefined;
}
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
//# sourceMappingURL=client.js.map