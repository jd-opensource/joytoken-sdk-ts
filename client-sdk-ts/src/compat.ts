import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  ChatTool,
  MessageContentBlock,
  MessageRequest,
  MessageResponse,
  MessageStreamEvent,
  MessageStreamRequest,
  MessageTool,
  ToolCall,
  Usage,
} from "./types.js";
import { mergeOpaqueObject } from "./opaque.js";

export type ChatWireTool = ChatTool | Record<string, unknown>;

export function messageToolToChat(tool: MessageTool): ChatTool {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.input_schema },
  };
}

export function messageRequestToChat(
  request: MessageRequest | MessageStreamRequest,
  tools: ChatTool[] | undefined,
): ChatCompletionRequest {
  const messages: ChatMessage[] = [];
  const system = blockText(request.system);
  if (system) messages.push({ role: "system", content: system });
  for (const message of request.messages) appendAnthropicInput(messages, message.role, message.content);
  const toolChoice = messageToolChoiceToChat(request.tool_choice);
  const {
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    stop_sequences: stopSequences,
    tier,
    metadata,
    messages: _messages,
    system: _system,
    stream: _stream,
    tools: _tools,
    tool_choice: _toolChoice,
    ...extra
  } = request;
  return {
    ...extra,
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
    top_p: topP,
    stop: stopSequences,
    tools,
    tool_choice: toolChoice.choice,
    ...(toolChoice.parallel === undefined ? {} : { parallel_tool_calls: toolChoice.parallel }),
    tier,
    metadata,
  };
}

export function chatResponseToMessage(response: ChatCompletionResponse): MessageResponse {
  const choice = response.choices[0];
  const message = choice?.message ?? { role: "assistant", content: "" };
  const content: MessageContentBlock[] = [];
  const text = contentText(message.content);
  if (text) content.push({ type: "text", text });
  for (const call of messageToolCalls(message)) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: parseObject(call.function.arguments),
      ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
    });
  }
  const metadata = anthropicMetadata(response.metadata, response.usage);
  return {
    id: response.id ?? "",
    type: "message",
    role: "assistant",
    content,
    model: response.model ?? "auto",
    stop_reason: anthropicStopReason(choice?.finish_reason, content),
    stop_sequence: null,
    usage: anthropicUsage(response.usage),
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export async function* chatStreamToMessages(
  chunks: AsyncIterable<ChatCompletionChunk>,
): AsyncIterable<MessageStreamEvent> {
  let id = "";
  let model = "auto";
  let usage: Usage | undefined;
  let metadata: Record<string, unknown> = {};
  let finishReason: string | null | undefined;
  let started = false;
  let nextBlock = 0;
  let textBlock: number | undefined;
  let textBlockOpen = false;
  let deferredText = "";
  const callBlocks = new Map<number, {
    block: number;
    id: string;
    name: string;
    arguments: string;
    extra_content?: Record<string, unknown>;
  }>();

  for await (const chunk of chunks) {
    id = chunk.id ?? id;
    model = chunk.model ?? model;
    usage = chunk.usage ?? usage;
    if (isRecord(chunk.metadata)) metadata = { ...metadata, ...chunk.metadata };
    const hasMessageData =
      chunk.id !== undefined ||
      chunk.model !== undefined ||
      chunk.usage !== undefined ||
      (Array.isArray(chunk.choices) && chunk.choices.length > 0);
    if (!started && !hasMessageData) continue;
    if (!started) {
      started = true;
      yield {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: usage?.prompt_tokens ?? 0, output_tokens: 0 },
          ...(Object.keys(metadata).length > 0 ? { metadata: { ...metadata } } : {}),
        },
      };
    }
    for (const choice of chunk.choices ?? []) {
      finishReason = choice.finish_reason ?? finishReason;
      const delta = choice.delta as Partial<ChatMessage> & { tool_calls?: Array<Record<string, unknown>> };
      const textDelta = contentText(delta.content);
      if (textDelta) {
        if (callBlocks.size > 0) {
          deferredText += textDelta;
        } else {
          if (textBlock === undefined) {
            textBlock = nextBlock++;
            textBlockOpen = true;
            yield { type: "content_block_start", index: textBlock, content_block: { type: "text", text: "" } };
          }
          yield { type: "content_block_delta", index: textBlock, delta: { type: "text_delta", text: textDelta } };
        }
      }
      for (const raw of delta.tool_calls ?? []) {
        if (textBlockOpen && textBlock !== undefined) {
          yield { type: "content_block_stop", index: textBlock };
          textBlockOpen = false;
        }
        const index = typeof raw.index === "number" ? raw.index : 0;
        const fn = (raw.function ?? {}) as Record<string, unknown>;
        let call = callBlocks.get(index);
        if (!call) {
          call = {
            block: nextBlock++,
            id: typeof raw.id === "string" ? raw.id : "",
            name: typeof fn.name === "string" ? fn.name : "",
            arguments: "",
          };
          callBlocks.set(index, call);
        } else if (typeof fn.name === "string") {
          call.name += fn.name;
        }
        if (typeof raw.id === "string" && raw.id) call.id = raw.id;
        const partial = typeof fn.arguments === "string" ? fn.arguments : "";
        if (partial) call.arguments += partial;
        call.extra_content = mergeOpaqueObject(call.extra_content, raw.extra_content);
      }
    }
  }
  if (!started) return;
  if (textBlockOpen && textBlock !== undefined) yield { type: "content_block_stop", index: textBlock };
  for (const call of callBlocks.values()) {
    yield {
      type: "content_block_start",
      index: call.block,
      content_block: {
        type: "tool_use",
        id: call.id,
        name: call.name,
        input: {},
        ...(call.extra_content === undefined ? {} : { extra_content: call.extra_content }),
      },
    };
    if (call.arguments) {
      yield {
        type: "content_block_delta",
        index: call.block,
        delta: { type: "input_json_delta", partial_json: call.arguments },
      };
    }
    yield { type: "content_block_stop", index: call.block };
  }
  if (deferredText) {
    const index = nextBlock++;
    yield { type: "content_block_start", index, content_block: { type: "text", text: "" } };
    yield { type: "content_block_delta", index, delta: { type: "text_delta", text: deferredText } };
    yield { type: "content_block_stop", index };
  }
  const finalMetadata = anthropicMetadata(metadata, usage);
  yield {
    type: "message_delta",
    delta: { stop_reason: anthropicStopReason(finishReason, callBlocks.size ? [{ type: "tool_use" }] : []) },
    usage: anthropicUsage(usage),
    ...(finalMetadata === undefined ? {} : { metadata: finalMetadata }),
  };
  yield { type: "message_stop" };
}

function appendAnthropicInput(
  messages: ChatMessage[],
  role: "user" | "assistant",
  content: string | MessageContentBlock[],
): void {
  if (typeof content === "string") {
    messages.push({ role, content });
    return;
  }
  if (role === "assistant") {
    const text = blockText(content);
    const toolCalls = content
      .filter((block) => block.type === "tool_use")
      .map(
        (block): ToolCall => ({
          id: block.id ?? "",
          type: "function",
          function: { name: block.name ?? "", arguments: JSON.stringify(block.input ?? {}) },
          ...(block.extra_content === undefined ? {} : { extra_content: block.extra_content }),
        }),
      );
    messages.push({ role: "assistant", content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    return;
  }
  let text = "";
  for (const block of content) {
    if (block.type === "tool_result") {
      if (text) {
        messages.push({ role: "user", content: text });
        text = "";
      }
      messages.push({ role: "tool", tool_call_id: block.tool_use_id ?? "", content: blockText(block.content) });
    } else if (block.type === "text") {
      text += block.text ?? "";
    }
  }
  if (text) messages.push({ role: "user", content: text });
}

function messageToolChoiceToChat(value: MessageRequest["tool_choice"] | MessageStreamRequest["tool_choice"]): {
  choice: ChatCompletionRequest["tool_choice"];
  parallel?: boolean;
} {
  if (!value) return { choice: undefined };
  const parallel = "disable_parallel_tool_use" in value ? !value.disable_parallel_tool_use : undefined;
  if (value.type === "any") return { choice: "required", parallel };
  if (value.type === "tool") return { choice: { type: "function", function: { name: value.name } }, parallel };
  return { choice: value.type, parallel };
}

function messageToolCalls(message: ChatMessage): ToolCall[] {
  if (message.tool_calls?.length) return message.tool_calls;
  const legacy = message.function_call as { name?: string; arguments?: string } | undefined;
  return legacy
    ? [{ id: String(message.id ?? "function_call"), type: "function", function: { name: legacy.name ?? "", arguments: legacy.arguments ?? "" } }]
    : [];
}

function contentText(content: ChatMessage["content"] | unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (isRecord(part) && "text" in part ? String(part.text ?? "") : "")).join("");
}

function blockText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((block) => {
      if (!isRecord(block)) return "";
      if ("text" in block) return String(block.text ?? "");
      if ("content" in block) return blockText(block.content);
      return "";
    })
    .join("");
}

function anthropicUsage(usage?: Usage): MessageResponse["usage"] {
  const details = usage?.prompt_tokens_details as { cached_tokens?: number } | undefined;
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    ...(details?.cached_tokens === undefined ? {} : { cache_read_input_tokens: details.cached_tokens }),
  };
}

function anthropicMetadata(
  value: unknown,
  usage: Usage | undefined,
): Record<string, unknown> | undefined {
  const metadata = isRecord(value) ? { ...value } : {};
  if (!hasCompleteTokenUsage(usage)) {
    metadata.joytoken = {
      ...(isRecord(metadata.joytoken) ? metadata.joytoken : {}),
      usage_status: "unavailable",
      usage_source: "gateway",
    };
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function hasCompleteTokenUsage(usage?: Usage): boolean {
  return typeof usage?.prompt_tokens === "number" && typeof usage.completion_tokens === "number";
}

function anthropicStopReason(reason: string | null | undefined, content: MessageContentBlock[]): string | null {
  if (content.some((block) => block.type === "tool_use") || reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "content_filter") return "refusal";
  return reason ?? null;
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = value ? JSON.parse(value) : {};
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
