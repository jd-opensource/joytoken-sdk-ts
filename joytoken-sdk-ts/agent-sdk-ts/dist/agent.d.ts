import type { AgentOptions, AgentResult, AgentRunOptions } from "./types.js";
export declare class Agent {
    private readonly options;
    private readonly toolsByName;
    constructor(options: AgentOptions);
    run(inputOrOptions: string | AgentRunOptions): Promise<AgentResult>;
    private initialMessages;
    private executeToolCalls;
}
//# sourceMappingURL=agent.d.ts.map