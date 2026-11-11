# AI 电商营销视频｜第一版

**版本**：v0.3 · 2026-11-10（v0.1 存档于 `交接包/` 与 `设计方案.md`）  
**定位**：面向普通电商卖家的 To C 创作产品，第一版为 H5  
**生成方式**：按 Kickart 的设计，先用文字定好方案（素材理解 → 4 条故事线 → 故事板），再逐镜头调用视频模型生成，最后用 Remotion 拼接并叠加字幕。视频模型通用（第一版接 Seedance 2.5），图片模型接 Seedream 5.0 pro，大模型用 DeepSeek。

> 已定决策见 [`docs/decisions.md`](docs/decisions.md)，实现说明见 [`docs/07-第一版实现说明.md`](docs/07-第一版实现说明.md)，二者优先于 02–05 中的 v0.2 内容。

## 本地开发

需要：Node.js 22、Docker Desktop、FFmpeg（`brew install ffmpeg`）。

```bash
cp .env.example .env          # 填写 DEEPSEEK_API_KEY、ARK_API_KEY（火山方舟，需开通 Seedance 2.5 与 Seedream 5.0 pro）
npm install
npm run infra:up              # PostgreSQL、Redis、MinIO（http://localhost:9001，minioadmin/minioadmin）
npm run build:shared
npm run db:migrate            # 创建数据表
npm run dev:server            # 后端 http://localhost:3001（后台任务在同一进程）
npm run dev:h5                # H5 http://localhost:5173（浏览器切到手机模式；真机调试见 .env 中的局域网地址说明）
```

- 没有 Mock 模式：不填密钥时，素材理解、故事线等会提示“未配置 API Key”。
- 本地开发时发给模型的图片用 Base64（`MODEL_IMAGE_TRANSPORT=base64`），不需要公网存储；上线接阿里云 OSS 后改为 `signed_url`。
- 虚拟人像：在火山控制台开通虚拟人像库后，参照 `config/virtual-portraits.example.json` 写一个 `config/virtual-portraits.json`。
- 第一次合成时 Remotion 会自动下载 Chrome Headless Shell（约 100MB）。

## 检查与测试

```bash
npm run check                                  # ESLint + 类型检查 + 单元/集成测试（假供应商，不产生费用）
npm run test:render -w @ai-creative/server     # 真实 Remotion 渲染测试
npx playwright install chromium                # 首次运行端到端测试前
npm run e2e -w @ai-creative/h5                 # 手机尺寸端到端测试，截图在 apps/h5/e2e/screenshots/
npm run inspect -- <projectId>                 # 命令行查看任务、片段、质检记录
npm run smoke:real -w @ai-creative/server -- --image 商品图.jpg --yes   # 真实调用冒烟（约 8 元，执行前请确认）
```

## 文件导航

1. [`docs/decisions.md`](docs/decisions.md) — 已定决策、v0.2 决策去向、下一版范围、待核对事项。
2. [`docs/07-第一版实现说明.md`](docs/07-第一版实现说明.md) — 原理、代码结构、数据模型、状态、模型调用、合成与标识、接口、测试、已知限制。
3. [`docs/06-模型能力与约束.md`](docs/06-模型能力与约束.md) — Seedance 2.5、Seedream 5.0 pro、DeepSeek 的官方能力、限制、价格、肖像方案与未实测清单。
4. [`docs/01-竞品与设计依据.md`](docs/01-竞品与设计依据.md) — Kickart / Aidge 公开能力与借鉴矩阵。
5. `docs/02`–`05`、[`docs/mvp-flows.md`](docs/mvp-flows.md)、[`docs/first-batch-tasks.md`](docs/first-batch-tasks.md) — v0.2 的产品、工作流、架构与计划（开头有 v0.3 提示）。
6. [`AGENTS.md`](AGENTS.md) — 编码代理需要遵守的项目约束。
7. [`设计方案-v0.3.md`](设计方案-v0.3.md) — 合并版（decisions、07、06、AGENTS 约束）。

## 边界

- 不做公开 API、SDK、开发者平台；内部接口只给 H5 使用。
- 不编造商品属性、功效、销量或测试结果；只有商家确认的卖点进入口播和字幕。
- 含真人脸的原图不发给视频模型（换虚拟人像、AI 相似人物或不用）。
- 第一版不做：积分、运营后台、爆款模仿、真人授权入库、时间轴精修、其他视频模型的具体接入。
