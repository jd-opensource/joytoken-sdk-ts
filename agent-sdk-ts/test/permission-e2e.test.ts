import { createServer, type Server } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Agent, createJoyTokenProvider } from "../src/index.js";
import {
  Toolkit,
  PermissionMode,
  calculator,
  dateTime,
  type Permission,
  type PermissionRequest,
} from "../src/toolkit/index.js";

/**
 * End-to-end permission tests. Unlike the existing suites — which either drive
 * a mock server without a permission gate, or unit-test permissionMiddleware in
 * isolation — these cross the full seam: a tool_call comes back over HTTP,
 * flows through the agent loop, and hits the toolkit permission gate.
 *
 * The client's own default-tool auto-execution loop is turned off with
 * defaultLocalTools: false so the tool_call is passed through to the agent
 * (where the permission gate lives) instead of being executed inside the
 * client (which has no permission gate).
 */

interface Gateway {
  baseUrl: string;
  calls: () => number;
  close: () => Promise<void>;
}

// startToolCallGateway builds a mock JoyToken Gateway. It returns a tool_call
// for calculator on the first `toolTurns` completions and plain finalText
// afterwards, counting how many completions were requested.
async function startToolCallGateway(finalText: string, toolTurns = 1): Promise<Gateway> {
  let count = 0;
  const server: Server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer test-key");
    await readBody(req);
    count += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (count <= toolTurns) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: `call_${count}`,
                    type: "function",
                    function: { name: "calculator", arguments: '{"expression":"1+1"}' },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        }),
      );
      return;
    }
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: finalText } }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");
  const baseUrl = `http://${address.address}:${address.port}`;
  return {
    baseUrl,
    calls: () => count,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

// makeAgent wires a real provider (default-tool auto-loop disabled) to an agent
// whose tools carry the toolkit permission gate.
function makeAgent(permission: Permission, baseUrl: string): Agent {
  const provider = createJoyTokenProvider({
    apiKey: "test-key",
    apiBaseUrl: baseUrl,
    openAIBaseUrl: `${baseUrl}/openai/v1`,
    protocol: "openai",
    defaultLocalTools: false,
  });
  const tools = new Toolkit({ permission }).register(calculator()).tools();
  return new Agent({ model: provider, tools });
}

test("Deny policy blocks the tool over the full loop and feeds the error back", async () => {
  const gateway = await startToolCallGateway("done");
  try {
    const agent = makeAgent({ mode: PermissionMode.Deny }, gateway.baseUrl);
    const result = await agent.run("compute");

    assert.equal(result.finalText, "done");
    const first = result.steps[0]?.toolResults[0];
    assert.ok(first?.isError, "expected tool result to be an error");
    assert.match(first!.content, /denied by permission policy/);
  } finally {
    await gateway.close();
  }
});

test("Ask handler returning false rejects the tool and feeds the error back", async () => {
  const gateway = await startToolCallGateway("done");
  try {
    let askCalls = 0;
    const ask = (_req: PermissionRequest) => {
      askCalls += 1;
      return false;
    };
    const agent = makeAgent({ mode: PermissionMode.Ask, ask }, gateway.baseUrl);
    const result = await agent.run("compute");

    assert.equal(askCalls, 1);
    const first = result.steps[0]?.toolResults[0];
    assert.ok(first?.isError, "expected tool result to be an error");
    assert.match(first!.content, /rejected by permission handler/);
  } finally {
    await gateway.close();
  }
});

test("Ask handler returning true lets the tool run and the run finishes", async () => {
  const gateway = await startToolCallGateway("final");
  try {
    let askCalls = 0;
    const ask = (_req: PermissionRequest) => {
      askCalls += 1;
      return true;
    };
    const agent = makeAgent({ mode: PermissionMode.Ask, ask }, gateway.baseUrl);
    const result = await agent.run("compute");

    assert.equal(askCalls, 1);
    const first = result.steps[0]?.toolResults[0];
    assert.equal(first?.isError, undefined, "expected approved tool to succeed");
    assert.equal(result.finalText, "final");
  } finally {
    await gateway.close();
  }
});

test("Ask mode with no handler fails safe and feeds the error back", async () => {
  const gateway = await startToolCallGateway("done");
  try {
    const agent = makeAgent({ mode: PermissionMode.Ask }, gateway.baseUrl);
    const result = await agent.run("compute");

    const first = result.steps[0]?.toolResults[0];
    assert.ok(first?.isError, "expected tool result to be an error");
    assert.match(first!.content, /no permission handler is configured/);
  } finally {
    await gateway.close();
  }
});

test("Ask handler is consulted on every tool call across multiple turns", async () => {
  const gateway = await startToolCallGateway("done", 2);
  try {
    let askCalls = 0;
    const ask = (_req: PermissionRequest) => {
      askCalls += 1;
      return true;
    };
    const agent = makeAgent({ mode: PermissionMode.Ask, ask }, gateway.baseUrl);
    const result = await agent.run("compute");

    assert.equal(askCalls, 2);
    assert.equal(result.steps.length, 3);
    assert.equal(result.finalText, "done");
  } finally {
    await gateway.close();
  }
});

test("calculator's real output is computed and fed back into the model context", async () => {
  let count = 0;
  let secondTurnBody = "";
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    count += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (count === 1) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: { name: "calculator", arguments: '{"expression":"1+1"}' },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }
    secondTurnBody = body;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "the answer is 2" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const agent = makeAgent({ mode: PermissionMode.Auto }, baseUrl);
    const result = await agent.run("compute 1+1");

    // 1. The tool actually computed the right value (not just "no error").
    const first = result.steps[0]?.toolResults[0];
    assert.equal(first?.isError, undefined, "expected calculator to succeed");
    assert.match(first!.content, /2/, "expected calculator output to contain 2");

    // 2. That real output was fed back into the model's context on turn two.
    assert.match(secondTurnBody, /"role":"tool"/, "expected a tool observation in the second-turn request");
    assert.match(secondTurnBody, /2/, "expected the computed value 2 fed back into the second-turn request");
    assert.equal(result.finalText, "the answer is 2");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test("datetime tool runs through the full permission + agent loop with real output", async () => {
  let count = 0;
  let secondTurnBody = "";
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    count += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (count === 1) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_dt",
                    type: "function",
                    function: { name: "datetime", arguments: '{"timezone":"Asia/Shanghai"}' },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }
    secondTurnBody = body;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "reported" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const provider = createJoyTokenProvider({
      apiKey: "test-key",
      apiBaseUrl: baseUrl,
      openAIBaseUrl: `${baseUrl}/openai/v1`,
      protocol: "openai",
      defaultLocalTools: false,
    });
    const tools = new Toolkit({ permission: { mode: PermissionMode.Auto } }).register(dateTime()).tools();
    const agent = new Agent({ model: provider, tools });
    const result = await agent.run("what time is it in Shanghai");

    const first = result.steps[0]?.toolResults[0];
    assert.equal(first?.isError, undefined, "expected datetime to succeed");
    // datetime carries the resolved timezone into its output; assert the real
    // value, not just absence of error.
    assert.match(first!.content, /Asia\/Shanghai/, "expected datetime output to carry the resolved timezone");
    assert.match(secondTurnBody, /Asia\/Shanghai/, "expected datetime output fed back into the second-turn request");
    assert.equal(result.finalText, "reported");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

// Every other suite returns exactly one tool_call per turn, so nothing proves
// the agent handles a single assistant message that requests *several* tools at
// once — the shape a model really emits to run tools in parallel. Here the
// gateway returns two tool_calls (calculator + datetime) in the first turn. The
// agent must execute both, consult the Ask gate once per call (twice), feed
// both observations back before the second turn, and preserve call order.
test("multiple tool_calls in one turn are all executed in order through the permission gate", async () => {
  let count = 0;
  let secondTurnBody = "";
  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    count += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    if (count === 1) {
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                tool_calls: [
                  {
                    id: "call_calc",
                    type: "function",
                    function: { name: "calculator", arguments: '{"expression":"1+1"}' },
                  },
                  {
                    id: "call_dt",
                    type: "function",
                    function: { name: "datetime", arguments: '{"timezone":"Asia/Shanghai"}' },
                  },
                ],
              },
            },
          ],
        }),
      );
      return;
    }
    secondTurnBody = body;
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "both done" } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const provider = createJoyTokenProvider({
      apiKey: "test-key",
      apiBaseUrl: baseUrl,
      openAIBaseUrl: `${baseUrl}/openai/v1`,
      protocol: "openai",
      defaultLocalTools: false,
    });
    const askOrder: string[] = [];
    const ask = (req2: PermissionRequest) => {
      askOrder.push(req2.toolName);
      return true;
    };
    const tools = new Toolkit({ permission: { mode: PermissionMode.Ask, ask } })
      .register(calculator())
      .register(dateTime())
      .tools();
    const agent = new Agent({ model: provider, tools });
    const result = await agent.run("compute and report time");

    // Both tool_calls in the single first turn must be executed, in order.
    const tr = result.steps[0]?.toolResults ?? [];
    assert.equal(tr.length, 2, "expected 2 tool results from one turn");
    assert.equal(tr[0]?.toolName, "calculator");
    assert.equal(tr[1]?.toolName, "datetime");
    assert.equal(tr[0]?.toolCallId, "call_calc");
    assert.equal(tr[1]?.toolCallId, "call_dt");
    assert.equal(tr[0]?.isError, undefined, "expected calculator to succeed");
    assert.equal(tr[1]?.isError, undefined, "expected datetime to succeed");
    assert.match(tr[0]!.content, /2/, "expected calculator result 2");
    assert.match(tr[1]!.content, /Asia\/Shanghai/, "expected datetime to resolve timezone");
    // The Ask gate must be consulted once per call, in the same order.
    assert.deepEqual(askOrder, ["calculator", "datetime"], "expected ask gate consulted per call in order");
    // Both observations must be fed back before the model's final answer.
    assert.match(secondTurnBody, /call_calc/, "expected calculator result fed back into second turn");
    assert.match(secondTurnBody, /call_dt/, "expected datetime result fed back into second turn");
    assert.equal(result.finalText, "both done");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

function readBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}