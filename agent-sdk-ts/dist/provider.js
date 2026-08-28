import { JoyTokenClient, } from "@joytoken/client-sdk-ts";
export function createJoyTokenProvider(options = {}) {
    const client = new JoyTokenClient(options);
    const protocol = options.protocol ?? "openai";
    return {
        async complete(request) {
            if (protocol === "anthropic")
                return completeAnthropic(client, request);
            const payload = {
                model: "auto",
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
async function completeAnthropic(client, request) {
    const response = await client.messages.create(toAnthropicRequest(request));
    return {
        message: normalizeAnthropicMessage(response),
        usage: normalizeAnthropicUsage(response),
        raw: response,
    };
}
function toAnthropicRequest(request) {
    const systemBlocks = [];
    const messages = [];
    for (const message of request.messages) {
        if (message.role === "system" || message.role === "developer") {
            const text = textFromContent(message.content);
            if (text)
                systemBlocks.push(text);
            continue;
        }
        if (message.role === "tool") {
            appendAnthropicMessage(messages, {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: textFromContent(message.content) }],
            });
            continue;
        }
        if (message.role === "assistant" && message.tool_calls?.length) {
            const content = [];
            const text = textFromContent(message.content);
            if (text)
                content.push({ type: "text", text });
            content.push(...message.tool_calls.map((call) => ({
                type: "tool_use",
                id: call.id,
                name: call.function.name,
                input: parseObject(call.function.arguments),
            })));
            appendAnthropicMessage(messages, { role: "assistant", content });
            continue;
        }
        appendAnthropicMessage(messages, {
            role: message.role === "assistant" ? "assistant" : "user",
            content: typeof message.content === "string" ? message.content : textFromContent(message.content),
        });
    }
    return {
        model: "auto",
        max_tokens: request.maxTokens ?? 1024,
        messages,
        system: systemBlocks.length ? systemBlocks.join("\n\n") : undefined,
        temperature: request.temperature,
        tools: request.tools?.map(toAnthropicTool),
        tier: request.tier,
        metadata: request.metadata,
    };
}
function appendAnthropicMessage(messages, message) {
    const previous = messages[messages.length - 1];
    if (previous?.role === message.role && Array.isArray(previous.content) && Array.isArray(message.content)) {
        previous.content.push(...message.content);
    }
    else {
        messages.push(message);
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
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
    const toolCalls = response.content
        .filter((block) => block.type === "tool_use" && block.id && block.name)
        .map((block) => ({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
    }));
    return { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}
function normalizeAnthropicUsage(response) {
    const prompt = response.usage.input_tokens;
    const completion = response.usage.output_tokens;
    return {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt === undefined && completion === undefined ? undefined : (prompt ?? 0) + (completion ?? 0),
    };
}
function textFromContent(content) {
    if (typeof content === "string")
        return content;
    if (!Array.isArray(content))
        return "";
    return content.map((part) => ("text" in part ? String(part.text ?? "") : "")).join("");
}
function parseObject(value) {
    try {
        const parsed = value ? JSON.parse(value) : {};
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    }
    catch {
        return {};
    }
}
function normalizeMessage(message) {
    return {
        ...message,
        role: message.role ?? "assistant",
    };
}
//# sourceMappingURL=provider.js.map