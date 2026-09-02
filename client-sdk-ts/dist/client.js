import { ORCHESTRATION_FINAL_TASK_ID } from "./types.js";
import { calculator, dateTime, parseToolArguments, safeExecuteTool, stringifyToolResult, toChatTool, toResponseTool, } from "./tools.js";
import { chatResponseToMessage, chatStreamToMessages, messageRequestToChat, messageToolToChat, } from "./compat.js";
import { fileRead, fileWrite, listDir, fileSearch, absRoot } from "./file-tools.js";
import { gateFileWrite } from "./file-permission.js";
import { shell, absWorkingDir } from "./shell-tools.js";
import { gateShell } from "./shell-permission.js";
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
/** Maps an HTTP status code to a provider-neutral ErrorCode, aligned with the Go SDK. */
function classifyStatus(status) {
    if (status === 429)
        return "rate_limited";
    if (status === 401)
        return "authentication";
    if (status === 403)
        return "permission";
    if (status === 404)
        return "not_found";
    if (status === 400 || status === 422)
        return "invalid_request";
    if (status >= 500 && status <= 599)
        return "server_error";
    return "unknown";
}
export class JoyTokenAPIError extends Error {
    status;
    code;
    requestId;
    responseHeaders;
    body;
    context;
    constructor(message, options) {
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
    apiBaseUrl;
    openAIBaseUrl;
    /** @deprecated Messages are adapted locally and do not request this URL. */
    anthropicBaseUrl;
    /** @deprecated Messages are adapted locally and use the Chat Completions headers. */
    anthropicVersion;
    timeoutMs;
    maxRetries;
    apiKey;
    fetcher;
    defaultHeaders;
    chatCompletionsUrl;
    responsesUrl;
    registeredTools;
    defaultLocalTools;
    defaultBuiltinTools;
    toolMaxSteps;
    fileWorkspace;
    filePermission;
    shellWorkspace;
    shellPermission;
    excludedDefaultTools;
    chat = {
        completions: {
            create: (request) => this.createChatCompletion(request),
            run: (request) => this.runChatCompletionExplicit(request),
            executeTools: (request) => this.runChatCompletionExplicit(request),
            stream: (request) => this.streamChatCompletion({ ...request, stream: true }),
            runStream: (request, options = {}) => this.runChatCompletionStreamExplicit(request, options),
            executeToolsStream: (request, options = {}) => this.runChatCompletionStreamExplicit(request, options),
        },
    };
    responses = {
        create: (request) => this.createResponse(request),
        run: (request) => this.runResponseExplicit(request),
        executeTools: (request) => this.runResponseExplicit(request),
        stream: (request) => this.streamResponse({ ...request, stream: true }),
        runStream: (request, options = {}) => this.runResponseStreamExplicit(request, options),
        executeToolsStream: (request, options = {}) => this.runResponseStreamExplicit(request, options),
    };
    messages = {
        create: (request) => this.createMessage(request),
        run: (request) => this.runMessageExplicit(request),
        executeTools: (request) => this.runMessageExplicit(request),
        stream: (request) => this.streamMessage({ ...request, stream: true }),
        runStream: (request, options = {}) => this.runMessageStreamExplicit(request, options),
        executeToolsStream: (request, options = {}) => this.runMessageStreamExplicit(request, options),
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
    constructor(options = {}) {
        const env = globalThis.process?.env;
        this.apiKey = options.apiKey ?? env?.JOY_TOKEN_API_KEY;
        const configuredApiBase = options.apiBaseUrl ?? env?.JOY_TOKEN_API_BASE_URL;
        const configuredAnthropicBase = options.anthropicBaseUrl ?? env?.JOY_TOKEN_ANTHROPIC_BASE_URL;
        this.apiBaseUrl = trimTrailingSlash(configuredApiBase ?? DEFAULT_API_BASE_URL);
        const configuredModelBase = options.openAIBaseUrl ??
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
    async createChatCompletion(request) {
        const plan = this.chatToolPlan(request.tools);
        return this.completeChat(request, plan, plan.automatic, "chat");
    }
    async runChatCompletionExplicit(request) {
        return this.completeChat(request, this.chatToolPlan(request.tools), true, "chat");
    }
    async completeChat(request, plan, executeTools, protocol) {
        const first = await withAPIErrorContext(requestErrorContext(protocol, "initial_request", 1), () => this.createChatCompletionOnce(request, plan.declarations));
        if (!executeTools)
            return first;
        return this.runChatCompletion(request, plan, first, protocol);
    }
    /**
     * createChatCompletionOnce injects tool declarations and performs a single
     * non-streaming request. It never executes tool calls, so it is safe to call
     * from the tool-calling loop without risking recursion.
     */
    async createChatCompletionOnce(request, declarations) {
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
        return this.requestChatCompletionJSON({
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
    async runChatCompletion(request, plan, first, protocol) {
        const messages = [...request.messages];
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
                response = await withAPIErrorContext(requestErrorContext(protocol, "repair_continuation", step + 2), () => this.createChatCompletionOnce({ ...request, messages }, plan.declarations));
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
            response = await withAPIErrorContext(requestErrorContext(protocol, "tool_continuation", step + 2, step + 1, toolCalls), () => this.createChatCompletionOnce({ ...request, messages }, plan.declarations));
        }
        return response;
    }
    async *streamChatCompletion(request) {
        const plan = this.chatToolPlan(request.tools);
        try {
            yield* this.streamChatCompletionWire(request, plan.declarations);
        }
        catch (error) {
            throw attachAPIErrorContext(error, requestErrorContext("chat", "initial_request", 1));
        }
    }
    async runChatCompletionStreamExplicit(request, options) {
        const plan = this.chatToolPlan(request.tools);
        return this.runChatCompletionStream(request, plan, options, "chat");
    }
    async runChatCompletionStream(request, plan, options, protocol) {
        const messages = [...request.messages];
        let response;
        let continuationCalls = [];
        for (let step = 0; step < this.toolMaxSteps; step += 1) {
            const context = step === 0
                ? requestErrorContext(protocol, "initial_request", 1)
                : requestErrorContext(protocol, "tool_continuation", step + 1, step, continuationCalls);
            response = await withAPIErrorContext(context, () => this.collectChatStreamTurn({ ...request, messages, stream: true }, plan.declarations, options.onTextDelta, options.onOrchestrationEvent));
            const message = response.choices[0]?.message;
            if (!message)
                return response;
            messages.push(message);
            const toolCalls = message.tool_calls ?? [];
            if (toolCalls.length === 0)
                return response;
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
    async collectChatStreamTurn(request, declarations, onTextDelta, onOrchestrationEvent) {
        let id;
        let object;
        let created;
        let model;
        let usage;
        let finishReason;
        let content = "";
        let extraMetadata = {};
        const orchestration = new OrchestrationAggregator(onOrchestrationEvent);
        const calls = new Map();
        for await (const chunk of this.streamChatCompletionWire(request, declarations)) {
            const { id: _id, object: _object, created: _created, model: _model, choices: _choices, usage: _usage, orchestration: _orchestration, ...chunkMetadata } = chunk;
            extraMetadata = { ...extraMetadata, ...chunkMetadata };
            id = chunk.id ?? id;
            object = chunk.object ?? object;
            created = chunk.created ?? created;
            model = chunk.model ?? model;
            usage = chunk.usage ?? usage;
            orchestration.observe(chunk.orchestration);
            for (const choice of chunk.choices ?? []) {
                finishReason = choice.finish_reason ?? finishReason;
                const delta = choice.delta;
                const text = chatContentText(delta.content);
                if (text) {
                    // In orchestrated turns, only the final-answer stage feeds the reply
                    // text; intermediate stages are recorded but not concatenated here.
                    if (orchestration.emitText(text)) {
                        content += text;
                        onTextDelta?.(text);
                    }
                }
                for (const raw of delta.tool_calls ?? []) {
                    const index = typeof raw.index === "number" ? raw.index : 0;
                    const fn = (raw.function ?? {});
                    const call = calls.get(index) ?? { id: "", type: "function", name: "", arguments: "" };
                    if (typeof raw.id === "string" && raw.id)
                        call.id = raw.id;
                    if (raw.type === "function")
                        call.type = raw.type;
                    if (typeof fn.name === "string")
                        call.name += fn.name;
                    if (typeof fn.arguments === "string")
                        call.arguments += fn.arguments;
                    if (typeof raw.thought_signature === "string" && raw.thought_signature) {
                        call.thought_signature = raw.thought_signature;
                    }
                    call.extra_content = mergeOpaqueObject(call.extra_content, raw.extra_content);
                    calls.set(index, call);
                }
            }
        }
        const orchestrationResult = orchestration.result();
        // When the gateway orchestrated the turn but never emitted a final stage,
        // fall back to concatenating every stage so no content is silently dropped.
        if (orchestrationResult && !content) {
            content = orchestrationResult.stages.map((stage) => stage.content).join("");
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
                                tool_calls: [...calls.values()].map((call) => ({
                                    id: call.id,
                                    type: call.type,
                                    function: { name: call.name, arguments: call.arguments },
                                    ...(call.thought_signature === undefined ? {} : { thought_signature: call.thought_signature }),
                                    ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
                                })),
                            }
                            : {}),
                    },
                    finish_reason: finishReason,
                }],
            ...(usage === undefined ? {} : { usage }),
            ...(orchestrationResult === undefined ? {} : { orchestration: orchestrationResult }),
        };
    }
    async *streamChatCompletionWire(request, declarations) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        const { tools: _requestTools, ...rest } = request;
        const activeRequest = await this.requestRaw(this.chatCompletionsUrl, {
            method: "POST",
            headers: { Accept: "text/event-stream" },
            body: JSON.stringify({
                ...rest,
                stream: true,
                stream_options: { ...request.stream_options, include_usage: true },
                ...(declarations === undefined ? {} : { tools: declarations }),
            }),
        });
        try {
            for await (const event of readSSE(activeRequest.response)) {
                throwIfChatResponseError(event, activeRequest.response);
                yield normalizeChatCompletionChunk(event);
            }
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async createResponse(request) {
        const plan = this.responseToolPlan(request.tools);
        if (!plan.automatic) {
            return withAPIErrorContext(requestErrorContext("responses", "initial_request", 1), () => this.createResponseOnce(request, plan.declarations));
        }
        return this.completeResponse(request, plan);
    }
    async runResponseExplicit(request) {
        return this.completeResponse(request, this.responseToolPlan(request.tools));
    }
    async runResponseStreamExplicit(request, options) {
        return this.completeResponse(request, this.responseToolPlan(request.tools), options);
    }
    async createResponseOnce(request, declarations) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        if (request.stream)
            throw new Error("Use joytoken.responses.stream() for streaming responses.");
        const { tools: _requestTools, ...rest } = request;
        const response = await this.requestJSON(this.responsesUrl, {
            method: "POST",
            body: JSON.stringify({
                ...rest,
                stream: false,
                ...(declarations === undefined ? {} : { tools: declarations }),
            }),
        });
        return withResponseOutputText(response);
    }
    async completeResponse(request, plan, streamOptions) {
        let input = normalizeResponseInput(request.input);
        const chained = request.previous_response_id !== undefined;
        let previousResponseId = request.previous_response_id;
        const requestTurn = async (context) => {
            const stepRequest = {
                ...request,
                input,
                ...(previousResponseId === undefined ? {} : { previous_response_id: previousResponseId }),
            };
            return withAPIErrorContext(context, () => streamOptions
                ? this.collectResponseStreamTurn({ ...stepRequest, stream: true }, plan.declarations, streamOptions.onTextDelta)
                : this.createResponseOnce(stepRequest, plan.declarations));
        };
        let response = await requestTurn(requestErrorContext("responses", "initial_request", 1));
        for (let step = 0; step < this.toolMaxSteps; step += 1) {
            const calls = responseFunctionCalls(response);
            if (calls.length === 0)
                return response;
            const replay = chained ? [] : [...input, ...(response.output ?? []).map(responseOutputToInput)];
            const outputs = [];
            for (const call of calls) {
                const toolCall = responseFunctionCallToToolCall(call);
                const result = await this.runTool(plan.executables, step, toolCall, responseInputToContextMessages(chained ? [...input, responseOutputToInput(call)] : replay, request.instructions));
                streamOptions?.onToolResult?.(result);
                outputs.push({
                    type: "function_call_output",
                    call_id: result.tool_call_id,
                    output: result.content,
                });
            }
            input = [...replay, ...outputs];
            if (chained)
                previousResponseId = response.id;
            const toolCalls = calls.map(responseFunctionCallToToolCall);
            response = await requestTurn(requestErrorContext("responses", "tool_continuation", step + 2, step + 1, toolCalls));
        }
        return response;
    }
    async *streamResponse(request) {
        const plan = this.responseToolPlan(request.tools);
        try {
            yield* this.streamResponseWire(request, plan.declarations);
        }
        catch (error) {
            throw attachAPIErrorContext(error, requestErrorContext("responses", "initial_request", 1));
        }
    }
    async *streamResponseWire(request, declarations) {
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
            yield* readSSE(activeRequest.response);
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async collectResponseStreamTurn(request, declarations, onTextDelta) {
        let terminalResponse;
        const output = [];
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
            if (event.response &&
                (event.type === "response.completed" || event.type === "response.incomplete" || event.type === "response.failed")) {
                terminalResponse = event.response;
            }
        }
        if (!terminalResponse) {
            throw new Error("JoyToken Responses stream ended without a terminal response event.");
        }
        const terminalOutput = terminalResponse.output ?? [];
        const outputLength = Math.max(output.length, terminalOutput.length);
        const collectedOutput = Array.from({ length: outputLength }, (_, index) => {
            const streamed = output[index];
            const terminal = terminalOutput[index];
            if (!streamed)
                return terminal;
            if (!terminal)
                return streamed;
            const extraContent = mergeOpaqueObject(streamed.extra_content, terminal.extra_content);
            return {
                ...streamed,
                ...terminal,
                ...(extraContent === undefined ? {} : { extra_content: extraContent }),
            };
        }).filter((item) => item !== undefined);
        const response = collectedOutput.length > 0
            ? { ...terminalResponse, output: collectedOutput }
            : terminalResponse;
        return withResponseOutputText(response);
    }
    async createMessage(request) {
        const plan = this.messageToolPlan(request.tools);
        const response = await this.completeChat(messageRequestToChat(request, plan.declarations), plan, plan.automatic, "messages");
        return chatResponseToMessage(response);
    }
    async runMessageExplicit(request) {
        const plan = this.messageToolPlan(request.tools);
        const response = await this.completeChat(messageRequestToChat(request, plan.declarations), plan, true, "messages");
        return chatResponseToMessage(response);
    }
    async *streamMessage(request) {
        const plan = this.messageToolPlan(request.tools);
        const chatRequest = messageRequestToChat(request, plan.declarations);
        try {
            yield* chatStreamToMessages(this.streamChatCompletionWire({ ...chatRequest, stream: true }, plan.declarations));
        }
        catch (error) {
            throw attachAPIErrorContext(error, requestErrorContext("messages", "initial_request", 1));
        }
    }
    async runMessageStreamExplicit(request, options) {
        const plan = this.messageToolPlan(request.tools);
        const chatRequest = messageRequestToChat(request, plan.declarations);
        const response = await this.runChatCompletionStream(chatRequest, plan, options, "messages");
        return chatResponseToMessage(response);
    }
    async generateImage(request) {
        this.requireAutoModel(request.model);
        this.requireAPIKey();
        return this.requestJSON(`${this.openAIBaseUrl}/images/generations`, {
            method: "POST",
            body: JSON.stringify(request),
        });
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
    toolSet(tools) {
        const byName = new Map();
        const order = [];
        const add = (tool) => {
            if (!tool.name || byName.has(tool.name))
                return;
            byName.set(tool.name, tool);
            order.push(tool);
        };
        for (const tool of tools)
            add(tool);
        return { byName, order };
    }
    defaultToolSet() {
        const defaults = [];
        const add = (tool) => {
            if (!this.excludedDefaultTools.has(tool.name))
                defaults.push(tool);
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
    chatToolPlan(requestTools) {
        return this.toolPlan(requestTools, requestTools, requestTools?.map((tool) => tool.function?.name).filter((name) => Boolean(name)));
    }
    responseToolPlan(requestTools) {
        const registered = this.toolSet(this.registeredTools);
        if (requestTools !== undefined) {
            assertHostedFileSearchTools(requestTools);
            const names = new Set(requestTools
                .filter((tool) => tool.type === "function")
                .map((tool) => (typeof tool.name === "string" ? tool.name : ""))
                .filter(Boolean));
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
        const declarations = defaults.order.map(toResponseTool);
        if (this.defaultBuiltinTools && !this.excludedDefaultTools.has("web_search_preview")) {
            declarations.push({ type: "web_search_preview" });
        }
        return {
            declarations: declarations.length > 0 ? declarations : undefined,
            executables: defaults.byName,
            automatic: defaults.order.length > 0,
        };
    }
    messageToolPlan(requestTools) {
        return this.toolPlan(requestTools, requestTools?.map(messageToolToChat), requestTools?.map((tool) => tool.name));
    }
    toolPlan(requestTools, requestDeclarations, requestNames) {
        const registered = this.toolSet(this.registeredTools);
        if (requestTools !== undefined) {
            const names = new Set(requestNames ?? []);
            const executables = new Map([...registered.byName].filter(([name, tool]) => names.has(name) && typeof tool.execute === "function"));
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
    async runTool(executables, step, toolCall, messages) {
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
        const context = { step, toolCall, messages };
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
    async requestJSON(url, init, auth = "bearer") {
        const activeRequest = await this.requestRaw(url, init, auth);
        try {
            return (await activeRequest.response.json());
        }
        finally {
            activeRequest.cleanup();
        }
    }
    /**
     * Non-streaming Chat requests need the same mid-payload error guard as the
     * streaming path: the Gateway can answer HTTP 200 with an
     * `{"error":{...},"choices":[]}` envelope (for example a failed orchestration
     * run). requestJSON alone would surface that as an empty response, so detect
     * the error envelope on the raw body before returning.
     */
    async requestChatCompletionJSON(init) {
        const activeRequest = await this.requestRaw(this.chatCompletionsUrl, init);
        try {
            const body = (await activeRequest.response.json());
            throwIfChatResponseError(body, activeRequest.response);
            const response = body;
            // Non-streaming orchestration fallback: gateways that return an
            // aggregated response (top-level plan/metadata) don't populate
            // `orchestration`. Fold it in so both streaming and non-streaming turns
            // expose the same OrchestrationResult shape.
            if (response.orchestration === undefined) {
                const orchestration = parseOrchestrationResponse(response);
                if (orchestration !== undefined)
                    response.orchestration = orchestration;
            }
            return response;
        }
        finally {
            activeRequest.cleanup();
        }
    }
    async requestRaw(url, init, auth = "bearer") {
        for (let attempt = 0;; attempt++) {
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
            }
            catch (error) {
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
/**
 * OrchestrationAggregator tracks orchestration metadata across the chunks of a
 * single streamed turn. It decides which text deltas belong to the final
 * answer, records every sub-task's aggregated content, and emits progress
 * events (plan announcement and per-sub-task transitions).
 */
class OrchestrationAggregator {
    onEvent;
    seen = false;
    planEmitted = false;
    plan;
    stages = [];
    stageByKey = new Map();
    currentKey;
    currentIsFinal = false;
    constructor(onEvent) {
        this.onEvent = onEvent;
    }
    /** Records orchestration metadata from one chunk, emitting events on change. */
    observe(info) {
        if (!info)
            return;
        this.seen = true;
        if (Array.isArray(info.plan) && !this.planEmitted) {
            this.plan = info.plan;
            this.planEmitted = true;
            this.onEvent?.({
                type: "plan",
                plan: info.plan,
                ...(info.phase === undefined ? {} : { phase: info.phase }),
            });
        }
        if (info.task_id === undefined && info.task_seq === undefined && info.title === undefined) {
            return;
        }
        const key = info.task_id ?? (info.task_seq !== undefined ? `seq:${info.task_seq}` : "");
        const isFinal = info.task_id === ORCHESTRATION_FINAL_TASK_ID;
        let stage = this.stageByKey.get(key);
        if (!stage) {
            stage = {
                content: "",
                ...(info.task_id === undefined ? {} : { task_id: info.task_id }),
                ...(info.task_seq === undefined ? {} : { task_seq: info.task_seq }),
                ...(info.title === undefined ? {} : { title: info.title }),
                ...(info.task_status === undefined ? {} : { task_status: info.task_status }),
            };
            this.stageByKey.set(key, stage);
            this.stages.push(stage);
        }
        else {
            if (info.task_status !== undefined)
                stage.task_status = info.task_status;
            if (info.title !== undefined && stage.title === undefined)
                stage.title = info.title;
            if (info.task_seq !== undefined && stage.task_seq === undefined)
                stage.task_seq = info.task_seq;
        }
        if (key !== this.currentKey) {
            this.currentKey = key;
            this.currentIsFinal = isFinal;
            this.onEvent?.({
                type: "stage",
                final: isFinal,
                ...(info.task_id === undefined ? {} : { task_id: info.task_id }),
                ...(info.task_seq === undefined ? {} : { task_seq: info.task_seq }),
                ...(info.task_status === undefined ? {} : { task_status: info.task_status }),
                ...(info.title === undefined ? {} : { title: info.title }),
            });
        }
        else if (info.task_status !== undefined) {
            this.onEvent?.({
                type: "stage",
                final: isFinal,
                ...(info.task_id === undefined ? {} : { task_id: info.task_id }),
                ...(info.task_seq === undefined ? {} : { task_seq: info.task_seq }),
                task_status: info.task_status,
                ...(info.title === undefined ? {} : { title: info.title }),
            });
        }
    }
    /**
     * Records a text delta against the active sub-task and reports whether it
     * should feed the user-facing reply. Non-orchestrated turns always emit;
     * orchestrated turns emit only the final-answer stage.
     */
    emitText(text) {
        if (!this.seen)
            return true;
        if (this.currentKey !== undefined) {
            const stage = this.stageByKey.get(this.currentKey);
            if (stage)
                stage.content += text;
        }
        return this.currentIsFinal;
    }
    /** Returns the aggregated orchestration summary, or undefined if none seen. */
    result() {
        if (!this.seen)
            return undefined;
        return {
            ...(this.plan === undefined ? {} : { plan: this.plan }),
            stages: this.stages,
        };
    }
}
/** Coerces an unknown value to a trimmed string, or undefined when unusable. */
function asString(value) {
    return typeof value === "string" ? value : undefined;
}
/**
 * Extracts stage records from a non-streaming orchestration payload. The
 * gateway may serialize per-sub-task content as (a) an array of objects, (b) a
 * JSON string encoding such an array, or (c) OpenAI-style content parts. This
 * normalizes all three into partial {@link OrchestrationStage} records.
 */
function extractContentStages(content) {
    let value = content;
    if (typeof content === "string") {
        const raw = content;
        const trimmed = raw.trim();
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            try {
                value = JSON.parse(trimmed);
            }
            catch {
                return [{ content: raw }];
            }
        }
        else {
            return [{ content: raw }];
        }
    }
    const items = Array.isArray(value) ? value : [value];
    const stages = [];
    for (const item of items) {
        if (typeof item === "string") {
            stages.push({ content: item });
            continue;
        }
        if (typeof item !== "object" || item === null)
            continue;
        const record = item;
        // OpenAI-style content parts: { type: "text", text: "..." }.
        const text = asString(record.content) ?? asString(record.text);
        const stage = { content: text ?? "" };
        if (typeof record.task_id === "string")
            stage.task_id = record.task_id;
        if (typeof record.task_seq === "number")
            stage.task_seq = record.task_seq;
        if (typeof record.task_status === "string")
            stage.task_status = record.task_status;
        if (typeof record.title === "string")
            stage.title = record.title;
        stages.push(stage);
    }
    return stages;
}
/**
 * Normalizes a *non-streaming* orchestration response into an
 * {@link OrchestrationResult}, mirroring what the streaming aggregator produces.
 *
 * It reads the top-level `plan` and `metadata` arrays plus the per-sub-task
 * content carried in `choices[].message.content`, merging metadata into stages
 * by matching `task_id`/`task_seq`. Returns undefined when the response shows no
 * orchestration signal (no plan, no metadata array), so callers can safely skip
 * non-orchestrated turns.
 */
export function parseOrchestrationResponse(response) {
    if (!response)
        return undefined;
    const plan = Array.isArray(response.plan) ? response.plan : undefined;
    const metadata = Array.isArray(response.metadata) ? response.metadata : [];
    // A metadata entry only signals orchestration when it identifies a sub-task
    // (carries a task_id, task_seq, or title). Plain (non-orchestrated) turns can
    // still carry a single bookkeeping metadata row — e.g. model/billing info with
    // task_id/task_seq/title all null — which must NOT be treated as a sub-task.
    const hasSubTaskMetadata = metadata.some((m) => typeof m.task_id === "string" || typeof m.task_seq === "number" || typeof m.title === "string");
    // No orchestration signal at all: no plan and no real sub-task metadata. This
    // keeps the non-streaming fallback aligned with the streaming aggregator,
    // which surfaces no orchestration for plain chat turns.
    if (plan === undefined && !hasSubTaskMetadata)
        return undefined;
    const contentStages = extractContentStages(response.choices?.[0]?.message?.content);
    // Index metadata by task_id, task_seq, and title for merging into stages.
    // Title matching is required because per-sub-task content entries often carry
    // only `content` + `title` (no task_id/task_seq), while the metadata array
    // carries the identifiers; matching on title is the only way to reunite them.
    const metaById = new Map();
    const metaBySeq = new Map();
    const metaByTitle = new Map();
    for (const meta of metadata) {
        if (typeof meta.task_id === "string")
            metaById.set(meta.task_id, meta);
        if (typeof meta.task_seq === "number")
            metaBySeq.set(meta.task_seq, meta);
        if (typeof meta.title === "string" && meta.title.length > 0 && !metaByTitle.has(meta.title)) {
            metaByTitle.set(meta.title, meta);
        }
    }
    const stages = [];
    const usedMeta = new Set();
    const mergeMeta = (stage) => {
        const meta = (stage.task_id !== undefined ? metaById.get(stage.task_id) : undefined) ??
            (stage.task_seq !== undefined ? metaBySeq.get(stage.task_seq) : undefined) ??
            (stage.title !== undefined ? metaByTitle.get(stage.title) : undefined);
        if (!meta)
            return;
        usedMeta.add(meta);
        if (stage.task_id === undefined && typeof meta.task_id === "string")
            stage.task_id = meta.task_id;
        if (stage.task_seq === undefined && typeof meta.task_seq === "number")
            stage.task_seq = meta.task_seq;
        if (stage.task_status === undefined && typeof meta.task_status === "string")
            stage.task_status = meta.task_status;
        if (stage.title === undefined && typeof meta.title === "string")
            stage.title = meta.title;
    };
    // Prefer content-derived stages when the payload carried per-sub-task content.
    if (contentStages.length > 0 && (contentStages.length > 1 || metadata.length <= 1 || contentStages[0]?.task_id !== undefined)) {
        for (const partial of contentStages) {
            const stage = { content: partial.content ?? "" };
            if (partial.task_id !== undefined)
                stage.task_id = partial.task_id;
            if (partial.task_seq !== undefined)
                stage.task_seq = partial.task_seq;
            if (partial.task_status !== undefined)
                stage.task_status = partial.task_status;
            if (partial.title !== undefined)
                stage.title = partial.title;
            mergeMeta(stage);
            stages.push(stage);
        }
    }
    // Emit any metadata entries that had no matching content stage, so every
    // announced sub-task is represented even when its content was empty. Skip
    // orchestration control placeholders (e.g. the planner entry) that carry no
    // title, since they are not real sub-tasks and the streaming aggregator does
    // not surface them as stages either.
    for (const meta of metadata) {
        if (usedMeta.has(meta))
            continue;
        if (typeof meta.title !== "string" || meta.title.length === 0)
            continue;
        const stage = { content: "" };
        if (typeof meta.task_id === "string")
            stage.task_id = meta.task_id;
        if (typeof meta.task_seq === "number")
            stage.task_seq = meta.task_seq;
        if (typeof meta.task_status === "string")
            stage.task_status = meta.task_status;
        stage.title = meta.title;
        stages.push(stage);
    }
    return {
        ...(plan === undefined ? {} : { plan }),
        stages,
    };
}
function chatContentText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .map((part) => (typeof part === "object" && part !== null && "text" in part ? String(part.text ?? "") : ""))
        .join("");
}
function emptyChatResponse() {
    return {
        choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "length" }],
    };
}
function requestErrorContext(protocol, phase, requestNumber, toolStep, toolCalls) {
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
                    hasThoughtSignature: typeof call.thought_signature === "string" && call.thought_signature.length > 0,
                    hasExtraContent: call.extra_content !== undefined,
                })),
            }),
    };
}
async function withAPIErrorContext(context, operation) {
    try {
        return await operation();
    }
    catch (error) {
        throw attachAPIErrorContext(error, context);
    }
}
function attachAPIErrorContext(error, context) {
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
function normalizeResponseInput(input) {
    if (typeof input === "string") {
        return input === "" ? [] : [{ type: "message", role: "user", content: input }];
    }
    return input.map((item) => ({ ...item }));
}
function responseOutputToInput(item) {
    return { ...item };
}
function responseFunctionCalls(response) {
    return (response.output ?? []).filter((item) => item.type === "function_call");
}
function responseFunctionCallToToolCall(call) {
    return {
        id: call.call_id ?? call.id ?? "",
        type: "function",
        function: { name: call.name ?? "", arguments: call.arguments ?? "" },
        ...(typeof call.thought_signature === "string" ? { thought_signature: call.thought_signature } : {}),
        ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
    };
}
function responseOutputText(response) {
    let text = "";
    for (const item of response.output ?? []) {
        for (const part of item.content ?? []) {
            if (part.type === "output_text" && typeof part.text === "string")
                text += part.text;
        }
    }
    return text;
}
function withResponseOutputText(response) {
    return response.output_text === undefined ? { ...response, output_text: responseOutputText(response) } : response;
}
function assertHostedFileSearchTools(tools) {
    for (const tool of tools) {
        if (tool.type !== "file_search")
            continue;
        if (!Array.isArray(tool.vector_store_ids) || tool.vector_store_ids.length === 0) {
            throw new Error("Responses hosted file_search requires a non-empty vector_store_ids array.");
        }
    }
}
function responseInputToContextMessages(input, instructions) {
    const messages = [];
    if (instructions)
        messages.push({ role: "system", content: instructions });
    for (const item of input) {
        if (item.type === "function_call") {
            const call = {
                id: item.call_id ?? item.id ?? "",
                type: "function",
                function: { name: item.name ?? "", arguments: item.arguments ?? "" },
                ...(typeof item.thought_signature === "string" ? { thought_signature: item.thought_signature } : {}),
                ...(item.extra_content === undefined ? {} : { extra_content: item.extra_content }),
            };
            const previous = messages.at(-1);
            if (previous?.role === "assistant" && previous.tool_calls)
                previous.tool_calls.push(call);
            else
                messages.push({ role: "assistant", content: null, tool_calls: [call] });
            continue;
        }
        if (item.type === "function_call_output") {
            messages.push({ role: "tool", tool_call_id: item.call_id ?? "", content: item.output ?? "" });
            continue;
        }
        if (["reasoning", "web_search_call", "file_search_call"].includes(item.type ?? ""))
            continue;
        const role = item.role === "assistant" || item.role === "system" || item.role === "developer" ? item.role : "user";
        messages.push({ role, content: responseInputContentText(item.content) });
    }
    return messages;
}
function responseInputContentText(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content.map((part) => String(part.text ?? "")).join("");
}
/**
 * The Gateway can surface a failure (for example an orchestration run that
 * fails server-side) as an HTTP 200 payload shaped like
 * `{"error":{"message":...,"type":...},"choices":[]}` — both as a mid-stream SSE
 * event and as a non-streaming response body. Without this guard such payloads
 * would be normalized into an empty chunk / empty response and the caller would
 * silently receive a truncated or empty reply. Detect the error envelope and
 * raise so the failure surfaces, mirroring the Responses protocol behavior.
 */
function throwIfChatResponseError(value, response) {
    if (!isRecord(value))
        return;
    const error = value.error;
    if (error === undefined || error === null)
        return;
    const detail = isRecord(error) ? error : { message: error };
    const message = typeof detail.message === "string" && detail.message.length > 0
        ? detail.message
        : "JoyToken Chat returned an error event";
    throw new JoyTokenAPIError(`JoyToken Chat stream error: ${message}`, {
        status: response.status,
        code: classifyStatus(response.status),
        responseHeaders: response.headers,
        body: error,
        requestId: extractRequestId(response.headers),
    });
}
/**
 * The Gateway may interleave metadata-only or usage-only SSE events with Chat
 * delta events. Keep every field from the wire while honoring the public
 * ChatCompletionChunk contract: choices is always an array and every exposed
 * choice has a delta object.
 */
function normalizeChatCompletionChunk(value) {
    if (!isRecord(value)) {
        throw new TypeError("JoyToken Chat streaming event must be a JSON object");
    }
    const rawChoices = Array.isArray(value.choices) ? value.choices : [];
    const choices = rawChoices.flatMap((rawChoice, fallbackIndex) => {
        if (!isRecord(rawChoice))
            return [];
        return [{
                ...rawChoice,
                index: typeof rawChoice.index === "number" ? rawChoice.index : fallbackIndex,
                delta: isRecord(rawChoice.delta) ? rawChoice.delta : {},
            }];
    });
    return { ...value, choices };
}
async function* readSSE(response) {
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
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
    const message = extractAPIErrorMessage(body) ?? `JoyToken API request failed with status ${response.status}`;
    return new JoyTokenAPIError(message, {
        status: response.status,
        code: classifyStatus(response.status),
        responseHeaders: response.headers,
        body,
        requestId: extractRequestId(response.headers),
    });
}
function extractAPIErrorMessage(body) {
    if (typeof body === "string")
        return body || undefined;
    if (!isRecord(body))
        return undefined;
    const error = body.error;
    if (typeof error === "string")
        return error || undefined;
    if (isRecord(error) && typeof error.message === "string" && error.message)
        return error.message;
    if (typeof body.message === "string" && body.message)
        return body.message;
    return error === undefined ? undefined : JSON.stringify(error);
}
function extractRequestId(headers) {
    return headers.get("x-request-id") ?? headers.get("x-daoe-request-id") ?? undefined;
}
/** Retry on rate-limit (429) and server/gateway errors (5xx); 4xx are deterministic. */
function isRetryableStatus(status) {
    return status === 429 || (status >= 500 && status <= 599);
}
/** Parses a Retry-After header (seconds or HTTP date). Returns 0 when absent/unparseable. */
function parseRetryAfter(value) {
    if (!value)
        return 0;
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
function backoffDelay(attempt, retryAfterMs) {
    if (retryAfterMs > 0) {
        return Math.min(retryAfterMs, RETRY_MAX_DELAY_MS);
    }
    const backoff = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
    return Math.floor(Math.random() * (backoff + 1));
}
/** Sleeps for the given ms, aborting early (and rejecting) if the signal fires. */
function sleep(ms, signal) {
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
function trimTrailingSlash(value) {
    return value.replace(/\/+$/, "");
}
function deriveOpenAIBaseUrl(value) {
    let base = trimTrailingSlash(value);
    base = base.replace(/\/openai\/v1\/(?:chat\/completions|responses|images\/generations)$/i, "/openai/v1");
    base = base.replace(/\/anthropic\/v1(?:\/messages)?$/i, "");
    base = base.replace(/(?:\/openai\/v1){2,}$/i, "/openai/v1");
    return /\/openai\/v1$/i.test(base) ? base : `${base}/openai/v1`;
}
//# sourceMappingURL=client.js.map