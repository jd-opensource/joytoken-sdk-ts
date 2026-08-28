import type { ChatCompletionChunk, ChatCompletionRequest, ChatCompletionResponse, ChatTool, MessageRequest, MessageResponse, MessageStreamEvent, MessageStreamRequest, MessageTool } from "./types.js";
export type ChatWireTool = ChatTool | Record<string, unknown>;
export declare function messageToolToChat(tool: MessageTool): ChatTool;
export declare function messageRequestToChat(request: MessageRequest | MessageStreamRequest, tools: ChatTool[] | undefined): ChatCompletionRequest;
export declare function chatResponseToMessage(response: ChatCompletionResponse): MessageResponse;
export declare function chatStreamToMessages(chunks: AsyncIterable<ChatCompletionChunk>): AsyncIterable<MessageStreamEvent>;
//# sourceMappingURL=compat.d.ts.map