import {
  JoyTokenClient,
  type ChatCompletionRequest,
  type ChatMessage,
  type JoyTokenClientOptions,
  type MessageContentBlock,
  type MessageParam,
  type MessageRequest,
  type MessageResponse,
  type MessageTool,
  type Usage,
} from "@joytoken/client-sdk-ts";
import type { ModelProvider, ModelRequest, ModelResponse } from "./types.js";

export type JoyTokenProtocol = "openai" | "anthropic";

export interface JoyTokenProviderOptions extends JoyTokenClientOptions {
  /** Selects the public response shape. Both protocols use the same Chat Completions Gateway endpoint. */
  protocol?: JoyTokenProtocol;
}

export function createJoyTokenProvider(options: JoyTokenProviderOptions = {}): ModelProvider {
  const client = new JoyTokenClient(options);
  const protocol = options.protocol ?? "openai";

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (protocol === "anthropic") return completeAnthropic(client, request);
      const payload: ChatCompletionRequest = {
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

async function completeAnthropic(client: JoyTokenClient, request: ModelRequest): Promise<ModelResponse> {
  const response = await client.messages.create(toAnthropicRequest(request));
  return {
    message: normalizeAnthropicMessage(response),
    usage: normalizeAnthropicUsage(response),
    raw: response,
  };
}

function toAnthropicRequest(request: ModelRequest): MessageRequest {
  const systemBlocks: string[] = [];
  const messages: MessageParam[] = [];

  for (const message of request.messages) {
    if (message.role === "system" || message.role === "developer") {
      const text = textFromContent(message.content);
      if (text) systemBlocks.push(text);
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
      const content: MessageContentBlock[] = [];
      const text = textFromContent(message.content);
      if (text) content.push({ type: "text", text });
      content.push(
        ...message.tool_calls.map((call) => ({
          type: "tool_use",
          id: call.id,
          name: call.function.name,
          input: parseObject(call.function.arguments),
        })),
      );
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

function appendAnthropicMessage(messages: MessageParam[], message: MessageParam): void {
  const previous = messages[messages.length - 1];
  if (previous?.role === message.role && Array.isArray(previous.content) && Array.isArray(message.content)) {
    previous.content.push(...message.content);
  } else {
    messages.push(message);
  }
}

function toAnthropicTool(tool: NonNullable<ModelRequest["tools"]>[number]): MessageTool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters ?? { type: "object", properties: {} },
  };
}

function normalizeAnthropicMessage(response: MessageResponse): ChatMessage {
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  const toolCalls = response.content
    .filter((block) => block.type === "tool_use" && block.id && block.name)
    .map((block) => ({
      id: block.id!,
      type: "function" as const,
      function: { name: block.name!, arguments: JSON.stringify(block.input ?? {}) },
    }));
  return { role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

function normalizeAnthropicUsage(response: MessageResponse): Usage {
  const prompt = response.usage.input_tokens;
  const completion = response.usage.output_tokens;
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt === undefined && completion === undefined ? undefined : (prompt ?? 0) + (completion ?? 0),
  };
}

function textFromContent(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => ("text" in part ? String(part.text ?? "") : "")).join("");
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function normalizeMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    role: message.role ?? "assistant",
  };
}
