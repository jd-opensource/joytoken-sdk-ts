import { createServer, type IncomingMessage, type Server } from "node:http";

export interface MockJoyTokenServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function createMockJoyTokenServer(): Promise<MockJoyTokenServer> {
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer example-key") {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "missing api key" } }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "joy/mock", name: "Joy Mock" }] }));
      return;
    }

    if (req.method === "POST" && req.url === "/openai/v1/chat/completions") {
      const body = JSON.parse(await readBody(req)) as { messages?: Array<{ role: string; content?: string }>; stream?: boolean };
      if (body.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write('data: {"choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\n');
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const hasToolResult = body.messages?.some((message) => message.role === "tool");
      const content = hasToolResult ? "tool result accepted" : "pong";
      res.writeHead(200, {
        "Content-Type": "application/json",
        "X-DAOE-Used-Model": "joy/mock",
        "X-DAOE-Used-Provider": "mock-provider",
      });
      res.end(
        JSON.stringify({
          id: "chatcmpl_example",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4, cost: 0.01 },
        }),
      );
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected server address");

  return {
    baseUrl: `http://${address.address}:${address.port}`,
    close: () => close(server),
  };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

function readBody(req: IncomingMessage): Promise<string> {
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
