# AI 电商营销视频｜第一版

**版本**：v0.4 · 2026-11-11（v0.1 至 v0.3 的旧文档已删除，可在 git 历史中查看）  
**定位**：面向普通电商卖家的 To C 创作产品，首发海外，第一版为 H5  
**生成方式**：按 Kickart 的设计，先用文字定好方案（素材理解与确认卖点/时长 → 4 条同一时长的故事线 → 故事板），再逐镜头生成视频，最后用 Remotion 拼接并叠加字幕。模型调用统一走 `H5 → NestJS / ModelHub → AI SDK / 原生适配器 → Vertex AI、火山及其他供应商`。默认使用 Vertex Gemini 大模型、Nano Banana 图片和 Gemini Omni 视频；NestJS 负责模型能力登记、项目绑定、确认、幂等、镜头版本、任务调度和合成。

> 已定决策见 [`docs/decisions.md`](docs/decisions.md)，实现说明见 [`docs/07-第一版实现说明.md`](docs/07-第一版实现说明.md)，二者优先于 02–05 中的 v0.2 内容。

## 本地开发

需要：Node.js 22、Docker Desktop、FFmpeg（`brew install ffmpeg`）。

```bash
cp .env.example .env          # 填写 Vertex 项目 ID，并配置 ADC（见下方）
npm install
npm run infra:up              # PostgreSQL、Redis、MinIO（http://localhost:9001，minioadmin/minioadmin）
npm run build:shared
npm run db:migrate            # 创建数据表
npm run dev:server            # 后端 http://localhost:3001（后台任务在同一进程）
npm run dev:h5                # H5 http://localhost:5173（浏览器切到手机模式；真机调试见 .env 中的局域网地址说明）
```

- 模型组合：`.env` 的 `VIDEO_MODEL` / `IMAGE_MODEL`（可选值见 `.env.example`）。组合在新建项目时记录到项目上，改配置并重启后只影响之后新建的项目。
- 没有 Mock 模式：缺少所选供应商配置时明确失败，不自动换供应商。
- 本地开发时发给模型的图片用 Base64（`MODEL_IMAGE_TRANSPORT=base64`），不需要公网存储；上线接阿里云 OSS 后改为 `signed_url`。
- 虚拟人像（只用于 Seedance 项目）：在火山控制台开通虚拟人像库后，参照 `config/virtual-portraits.example.json` 写一个 `config/virtual-portraits.json`。
- 第一次合成时 Remotion 会自动下载 Chrome Headless Shell（约 100MB）。

### 配置模型供应商

所有配置在仓库根目录 `.env`，只由服务端读取。Demo 默认全流程使用 Vertex：

```dotenv
LLM_PROVIDER=vertex
VERTEX_PROJECT_ID=你的GoogleCloud项目ID
VERTEX_LOCATION=global
VERTEX_LLM_MODEL=gemini-4-hydrogen
VIDEO_MODEL=vertex-gemini-omni-1.2-flash
IMAGE_MODEL=vertex-nano-banana-2.1
```

本地配置 Google 应用默认凭据：

```bash
gcloud auth application-default login
gcloud auth application-default set-quota-project 你的GoogleCloud项目ID
```

项目需启用 Vertex AI API，并给运行身份 Vertex AI 调用权限。部署时使用服务账号身份 / Workload Identity；凭据文件方式见 [08](docs/08-Vertex-AI接入.md)。模型权限、地区可用性和额度抵扣须在你的账号核实。

文字与看图使用 Vercel AI SDK 的显式供应商 Provider；图片和异步视频复用原生适配器，保留任务 ID、取消、结果转存和 Vertex interaction 清理。无需部署 New API，也无需 Vercel 账号或 Gateway Key。火山、DeepSeek、其他兼容接口配置和扩展方式见 [09](docs/09-模型供应商直连.md)。修改 `.env` 后重启后端及独立 worker；视频/图片组合只影响之后新建的项目。

## 检查与测试

```bash
npm run check                                  # ESLint + 类型检查 + 单元/集成测试（假供应商，不产生费用）
npm run test:render -w @ai-creative/server     # 真实 Remotion 渲染测试
npx playwright install chromium                # 首次运行端到端测试前
npm run e2e -w @ai-creative/h5                 # 手机尺寸端到端测试，截图在 apps/h5/e2e/screenshots/
npm run inspect -- <projectId>                 # 命令行查看任务、片段、质检记录
npm run smoke:real -w @ai-creative/server -- --image 商品图.jpg --yes   # 真实调用冒烟（会产生费用，执行前核对账号价格和预算）
```

## 文件导航

1. [`docs/decisions.md`](docs/decisions.md) — 已定决策、v0.2 决策去向、下一版范围、待核对事项。
2. [`docs/07-第一版实现说明.md`](docs/07-第一版实现说明.md) — 原理、代码结构、数据模型、状态、模型调用、合成与标识、接口、测试、已知限制。
3. [`docs/06-模型能力与约束.md`](docs/06-模型能力与约束.md) — Seedance 2.5、Seedream 5.0 pro、Gemini Omni 1.2 Flash、Nano Banana 2.1、DeepSeek 的官方能力、限制、价格、肖像方案与未实测清单；Veo 3.1 暂不接入的原因。
4. [`docs/01-竞品与设计依据.md`](docs/01-竞品与设计依据.md) — Kickart / Aidge 公开能力与借鉴矩阵。
5. `docs/02`–`05`、[`docs/mvp-flows.md`](docs/mvp-flows.md)、[`docs/first-batch-tasks.md`](docs/first-batch-tasks.md) — v0.2 的产品、工作流、架构与计划（开头有 v0.3 提示）。
6. [`AGENTS.md`](AGENTS.md) — 编码代理需要遵守的项目约束。
7. [`.kiro/steering/mobile-ui.md`](.kiro/steering/mobile-ui.md) — H5 移动端 UI 设计规范与截图验收标准。
8. [`docs/08-Vertex-AI接入.md`](docs/08-Vertex-AI接入.md) — 配置 Vertex AI 项目、ADC、模型和联调。
9. [`docs/09-模型供应商直连.md`](docs/09-模型供应商直连.md) — AI SDK、原生适配器、国内模型配置与后续扩展。

## 边界

- 不做公开 API、SDK、开发者平台；内部接口只给 H5 使用。
- 不编造商品属性、功效、销量或测试结果；只有商家确认的卖点进入口播和字幕。
- 含真人脸的原图不发给视频模型（换 AI 相似人物、不用，或在 Seedance 项目里换虚拟人像）。
- 第一版不做：积分、运营后台、爆款模仿、真人授权入库、时间轴精修、多语言、Veo 3.1 与其他视频模型的具体接入。
