import { addUsage, emptyUsage, shouldStop, stepCountIs } from "./stop.js";
import { stringifyToolResult, toChatTool } from "./tools.js";
export class Agent {
    options;
    toolsByName;
    constructor(options) {
        this.options = options;
        this.toolsByName = new Map((options.tools ?? []).map((tool) => [tool.name, tool]));
    }
    async run(inputOrOptions) {
        const runOptions = typeof inputOrOptions === "string" ? { input: inputOrOptions } : inputOrOptions;
        const messages = this.initialMessages(runOptions);
        const steps = [];
        const stopWhen = [...(this.options.stopWhen ?? []), stepCountIs(runOptions.maxSteps ?? 8)];
        let usage = emptyUsage();
        let toolCalls = 0;
        for (let step = 1;; step++) {
            const stoppedBy = shouldStop(stopWhen, { step: step - 1, toolCalls, usage, messages });
            if (stoppedBy) {
                return {
                    finalText: lastAssistantText(messages),
                    messages,
                    steps,
                    usage,
                    stoppedBy,
                };
            }
            const response = await this.options.model.complete({
                model: this.options.modelName ?? "auto",
                messages,
                tools: [...this.toolsByName.values()].map(toChatTool),
                temperature: this.options.temperature,
                maxTokens: this.options.maxTokens,
                tier: this.options.tier,
                metadata: { ...this.options.metadata, ...runOptions.metadata },
            });
            usage = addUsage(usage, response.usage);
            const assistantMessage = response.message;
            messages.push(assistantMessage);
            const toolResults = await this.executeToolCalls(step, assistantMessage.tool_calls ?? [], messages);
            toolCalls += toolResults.length;
            messages.push(...toolResults.map((result) => ({
                role: "tool",
                tool_call_id: result.toolCallId,
                content: result.content,
            })));
            steps.push({ index: step, assistantMessage, toolResults, usage: response.usage });
            if (toolResults.length === 0) {
                return {
                    finalText: textContent(assistantMessage.content),
                    messages,
                    steps,
                    usage,
                };
            }
        }
    }
    initialMessages(runOptions) {
        const messages = [];
        if (this.options.system) {
            messages.push({ role: "system", content: this.options.system });
        }
        if (runOptions.messages?.length) {
            messages.push(...runOptions.messages);
        }
        if (runOptions.input) {
            messages.push({ role: "user", content: runOptions.input });
        }
        return messages;
    }
    async executeToolCalls(step, toolCalls, messages) {
        const results = [];
        for (const toolCall of toolCalls) {
            const tool = this.toolsByName.get(toolCall.function.name);
            if (!tool) {
                results.push({
                    toolCallId: toolCall.id,
                    toolName: toolCall.function.name,
                    content: `Tool not found: ${toolCall.function.name}`,
                });
                continue;
            }
            const input = parseToolArguments(toolCall.function.arguments);
            const output = await tool.execute(input, { step, toolCall, messages });
            results.push({
                toolCallId: toolCall.id,
                toolName: tool.name,
                content: stringifyToolResult(output),
            });
        }
        return results;
    }
}
function parseToolArguments(value) {
    if (!value)
        return {};
    try {
        return JSON.parse(value);
    }
    catch {
        return { raw: value };
    }
}
function lastAssistantText(messages) {
    for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message?.role === "assistant")
            return textContent(message.content);
    }
    return "";
}
function textContent(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content))
        return content.map((part) => ("text" in part ? String(part.text) : "")).join("");
    return "";
}
//# sourceMappingURL=agent.js.map