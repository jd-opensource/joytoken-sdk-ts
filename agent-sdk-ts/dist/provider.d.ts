import { type JoyTokenClientOptions } from "@joytoken/client-sdk-ts";
import type { ModelProvider } from "./types.js";
export type JoyTokenProtocol = "openai" | "anthropic";
export interface JoyTokenProviderOptions extends JoyTokenClientOptions {
    protocol?: JoyTokenProtocol;
}
export declare function createJoyTokenProvider(options?: JoyTokenProviderOptions): ModelProvider;
//# sourceMappingURL=provider.d.ts.map