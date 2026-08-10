# @joytoken/agent-sdk-ts

TypeScript helpers for building agent loops on top of JoyToken. Requires Node.js 18+ or a modern runtime with `fetch`.

Install directly from GitHub by adding both the Agent SDK and its client peer dependency to your project's `package.json`:

```json
{
  "dependencies": {
    "@joytoken/agent-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/agent-sdk-ts",
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

```bash
pnpm install
```

```ts
import { Agent, createJoyTokenProvider, defineTool, maxToolCalls, stepCountIs } from "@joytoken/agent-sdk-ts";

const agent = new Agent({
  model: createJoyTokenProvider({ apiKey: process.env.JOY_TOKEN_API_KEY }),
  stopWhen: [stepCountIs(6), maxToolCalls(4)],
  tools: [
    defineTool({
      name: "lookup",
      description: "Look up internal data",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      execute: async ({ id }) => `record:${id}`,
    }),
  ],
});

const result = await agent.run("Summarize record 42");
console.log(result.finalText);
```

JoyToken Agent SDK always sends `model: "auto"`; model IDs cannot be selected through the Agent SDK. Tool execution, state, and approval logic remain in your application.

Every run has a hard eight-step limit by default. Set `maxSteps` per run or add `stopWhen` conditions for tool-call or cost budgets, and handle provider and tool errors in your application.

```ts
const result = await agent.run({ input: "Summarize record 42", maxSteps: 6 });
console.log(result.stoppedBy, result.usage);
```
