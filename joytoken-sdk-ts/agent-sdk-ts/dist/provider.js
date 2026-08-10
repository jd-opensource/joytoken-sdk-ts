import { JoyTokenClient, } from "@joytoken/client-sdk-ts";
export function createJoyTokenProvider(options = {}) {
    const client = new JoyTokenClient(options);
    const defaultModel = options.defaultModel ?? "auto";
    const protocol = options.protocol ?? "openai";
    return {
        async complete(request) {
            if (protocol === "anthropic") {
                return completeAnthropic(client, request, defaultModel);
            }
            const payload = {
                model: request.model || defaultModel,
                messages: request.messages,
                temperature: request.temperature,
                max_tokens: request.maxTokens,
                tools: request.tools,
                tier: request.tier,
                metadata: request.metadata,
            };
            const response = await client.chat.completions.create(payload);
            const message = response.choices[0]?.message;
            if (!message) {
                throw new Error("JoyToken did not return a chat completion message.");
            }
            return {
                message: normalizeMessage(message),
                usage: response.usage,
                raw: response,
            };
        },
    };
}
async function completeAnthropic(client, request, defaultModel) {
    const converted = toAnthropicRequest(request, request.model || defaultModel);
    const response = await client.messages.create(converted);
    return {
        message: normalizeAnthropicMessage(response),
        usage: normalizeAnthropicUsage(response),
        raw: response,
    };
}
function toAnthropicRequest(request, model) {
    const systemBlocks = [];
    const messages = [];
    for (const message of request.messages) {
        if (message.role === "system") {
            const text = textFromContent(message.content);
            if (text)
                systemBlocks.push(text);
            continue;
        }
        if (message.role === "tool") {
            const toolResult = {
                type: "tool_result",
                tool_use_id: message.tool_call_id ?? "unknown",
                content: textFromContent(message.content),
            };
            appendAnthropicMessage(messages, { role: "user", content: [toolResult] });
            continue;
        }
        if (message.role === "assistant" && message.tool_calls?.length) {
            const content = [];
            const text = textFromContent(message.content);
            if (text)
                content.push({ type: "text", text });
            content.push(...message.tool_calls.map((toolCall) => ({
                type: "tool_use",
                id: toolCall.id,
                name: toolCall.function.name,
                input: parseToolInput(toolCall.function.arguments),
            })));
            appendAnthropicMessage(messages, { role: "assistant", content });
            continue;
        }
        appendAnthropicMessage(messages, {
            role: message.role === "assistant" ? "assistant" : "user",
            content: contentForAnthropic(message.content),
        });
    }
    const payload = {
        model,
        max_tokens: request.maxTokens ?? 1024,
        messages,
        system: systemBlocks.length ? systemBlocks.join("\n\n") : undefined,
        temperature: request.temperature,
        tools: request.tools?.map(toAnthropicTool),
        tier: request.tier,
        metadata: request.metadata,
    };
    return payload;
}
function appendAnthropicMessage(messages, message) {
    const previous = messages[messages.length - 1];
    if (previous?.role === message.role && Array.isArray(previous.content) && Array.isArray(message.content)) {
        previous.content.push(...message.content);
        return;
    }
    messages.push(message);
}
function contentForAnthropic(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content))
        return content;
    return "";
}
function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content
        .filter((part) => part.type === "text" || typeof part.text === "string")
        .map((part) => String(part.text ?? ""))
        .join("");
}
function parseToolInput(argumentsText) {
    if (!argumentsText)
        return {};
    try {
        const parsed = JSON.parse(argumentsText);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function toAnthropicTool(tool) {
    return {
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters ?? { type: "object", properties: {} },
    };
}
function normalizeAnthropicMessage(response) {
    const text = response.content
        .filter((block) => block.type === "text" && typeof block.text === "string")
        .map((block) => block.text ?? "")
        .join("");
    const toolCalls = response.content
        .filter((block) => block.type === "tool_use" && block.id && block.name)
        .map((block) => ({
        id: block.id,
        type: "function",
        function: {
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
        },
    }));
    return {
        role: "assistant",
        content: text || null,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
}
function normalizeAnthropicUsage(response) {
    const promptTokens = response.usage?.input_tokens;
    const completionTokens = response.usage?.output_tokens;
    return {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens === undefined && completionTokens === undefined
            ? undefined
            : (promptTokens ?? 0) + (completionTokens ?? 0),
    };
}
function normalizeMessage(message) {
    return {
        ...message,
        role: message.role ?? "assistant",
    };
}
//# sourceMappingURL=provider.js.map