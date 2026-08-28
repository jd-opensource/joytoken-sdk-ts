# JoyToken TypeScript SDK

[English](README.md) | 简体中文

本仓库包含 JoyToken 官方 TypeScript SDK。

这些包使用标准 `fetch` API，可运行于 Node.js 18+ 和现代浏览器。除非明确需要在浏览器中暴露 API Key，否则应始终将 API Key 保存在可信的服务端环境中。

## 安装

SDK 直接从 GitHub 安装，不发布到 npm Registry。请在项目的 `package.json` 中添加 Client SDK 所在的 GitHub 子目录：

```json
{
  "type": "module",
  "dependencies": {
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

然后安装依赖：

```bash
pnpm install
```

如果使用 Agent SDK，请将两个 GitHub 子目录都声明为项目的直接依赖。Client SDK 是 Agent SDK 的 peer dependency。

```json
{
  "type": "module",
  "dependencies": {
    "@joytoken/agent-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/agent-sdk-ts",
    "@joytoken/client-sdk-ts": "git+https://github.com/jd-opensource/joytoken-sdk-ts.git#path:/client-sdk-ts"
  }
}
```

上述地址默认跟随仓库默认分支。用于生产环境时，应固定到 Release Tag 或 Commit，例如 `#v0.2.0&path:/client-sdk-ts`，以保证构建可复现。

## 快速开始

```bash
export JOY_TOKEN_API_KEY="..."
```

创建 `index.mjs`：

```js
import { JoyTokenClient } from "@joytoken/client-sdk-ts";

const client = new JoyTokenClient({
  apiKey: process.env.JOY_TOKEN_API_KEY,
});

const completion = await client.chat.completions.create({
  model: "auto",
  messages: [{ role: "user", content: "Say hello" }],
});

console.log(completion.choices[0]?.message.content);
```

运行：

```bash
node index.mjs
```

## 包结构

- [`client-sdk-ts`](client-sdk-ts/README.md)：支持 JoyToken OpenAI Chat Completions、Responses、Anthropic Messages、流式调用和模型发现的 TypeScript 客户端。
- [`agent-sdk-ts`](agent-sdk-ts/README.md)：基于 `client-sdk-ts` 构建的 TypeScript Agent 辅助包。
- `example`：使用本地 JoyToken 模拟服务器的离线冒烟测试，以及需要显式启用的真实 JoyToken API 在线示例。

## 支持的 API

Gateway 只有一个 Base URL，并正式提供两个 OpenAI 协议入口；Anthropic Messages 由 SDK 在本地适配到 Chat Completions：

- `POST /openai/v1/chat/completions`
- `POST /openai/v1/responses`
- `POST /openai/v1/images/generations`
- `GET /api/v1/models`
- `GET /api/v1/models/meta`
- `GET /api/v1/pricing`

在网关发布稳定契约之前，本 SDK 暂不提供 Embeddings 和公共管理 API。

## 配置

默认服务地址为 `https://api.joytokens.ai`。请求默认超时时间为 60 秒；传入 `timeoutMs: 0` 可禁用该限制。如需使用其他环境，可以设置 `JOY_TOKEN_API_BASE_URL` 或兼容保留的 `JOY_TOKEN_OPENAI_BASE_URL`。Anthropic 专用 Base URL 仅为源码兼容保留，不会选择独立模型接口。

调用需要鉴权的模型接口、模型元数据和价格接口时，如果未配置 API Key，SDK 会在发送网络请求前直接给出明确错误。只有 `models.list()` 是无需鉴权的模型目录接口。

所有模型请求都必须使用 `model: "auto"`；传入具体模型 ID 时，SDK 会在本地直接拒绝。

模型描述语言按 `models.list()` 调用设置，不是客户端全局配置。传入 `{ locale: "zh" }` 或 `{ locale: "en" }`；不传时接口默认返回英文描述。SDK 保留接口原始响应层级，模型目录项位于 `response.data.models`。

## 仓库开发

以下命令用于从源码 checkout 后参与仓库开发。仓库已经包含根目录 `package.json`、workspace 配置和锁文件：

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

## 分发

本项目通过 GitHub 而非 npm 分发。编译后的 `dist/` 文件会提交到仓库，因此用户安装某个 Git 版本时不需要运行 TypeScript 工具链。创建发布 Tag 前，请重新构建并提交生成文件：

```bash
pnpm build
git diff --exit-code -- client-sdk-ts/dist agent-sdk-ts/dist
```

## 在线示例

在线示例会调用 JoyToken，需要真实 API Key：

```bash
cd example
export JOY_TOKEN_API_KEY="..."
pnpm live
```

## 参与贡献

请参阅 [CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY.md](SECURITY.md) 和 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
