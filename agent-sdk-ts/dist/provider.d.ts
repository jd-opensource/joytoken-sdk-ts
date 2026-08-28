import { type JoyTokenClientOptions } from "@joytoken/client-sdk-ts";
import type { ModelProvider } from "./types.js";
export type JoyTokenProtocol = "openai" | "anthropic";
export interface JoyTokenProviderOptions extends JoyTokenClientOptions {
    /** Selects the public response shape. Both protocols use the same Chat Completions Gateway endpoint. */
    protocol?: JoyTokenProtocol;
}
export declare function createJoyTokenProvider(options?: JoyTokenProviderOptions): ModelProvider;
//# sourceMappingURL=provider.d.ts.map