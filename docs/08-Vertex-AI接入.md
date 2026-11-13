# Google Cloud Vertex AI 接入

当前按 D-60 直接访问 Google Cloud，默认文字、图片、视频均使用 Vertex；不经过 New API、AI Studio 或 Vercel Gateway。`global` 指全局 API 端点，实际模型权限和访问地区以 Google 账号为准。

## 1. 项目与身份

选择绑定额度/结算账号的 Google Cloud 项目，启用 Vertex AI API，给运行身份授予适当的 Vertex AI 调用权限（通常为 `roles/aiplatform.user`）。本地开发使用 ADC：

```bash
gcloud services enable aiplatform.googleapis.com --project=你的项目ID
gcloud auth application-default login
gcloud auth application-default set-quota-project 你的项目ID
```

部署优先使用附加服务账号身份或 Workload Identity。若使用服务账号 JSON 文件，只在服务端设置绝对路径 `GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/account.json`；不把 JSON、私钥或 token 发到聊天、前端或日志，也不提交仓库。SDK / google-auth-library 自动刷新 token。

## 2. 根目录 .env

```dotenv
LLM_PROVIDER=vertex
VERTEX_PROJECT_ID=你的项目ID
VERTEX_LOCATION=global
VERTEX_LLM_MODEL=gemini-4-hydrogen
VIDEO_MODEL=vertex-gemini-omni-1.2-flash
IMAGE_MODEL=vertex-nano-banana-2.1
VERTEX_OMNI_MODEL_ID=gemini-omni-1.2-flash
VERTEX_IMAGE_MODEL_ID=gemini-nano-banana-2.1
VERTEX_API_REVISION=2026-05-20
VERTEX_VIDEO_MAX_CONCURRENCY=3
VERTEX_VIDEO_RPM=30
MODEL_IMAGE_TRANSPORT=base64
```

模型 ID 和额度限制按账号可用能力核对。配置后重启后端和独立 worker；新建项目记录视频/图片组合，旧项目不自动换模型。不要原地把已有登记键的模型 ID 改成不同模型版本；新版本新增登记键。

## 3. 实际调用

- 文字/看图：`@ai-sdk/google-vertex` 显式创建 Vertex Provider，使用配置项目、ADC、全局 `generateContent`，请求 JSON；结果继续经 LlmService 的 zod 与业务校验。不使用 SDK 默认模型字符串路由。
- 图片：原生 Vertex `generateContent`，请求 TEXT / IMAGE、9:16、登记的图片档位，支持参考图编辑，原样转存产物。
- 视频：全局 `v1beta1/.../interactions`；后台创建、按 ID 查询、尝试取消，视频转存后尝试删除 interaction。多参考图明确使用 `reference_to_video`，不会把两张商品图当成首尾帧。
- 请求携带项目配额头；SDK/原生鉴权请求禁止跟随重定向。Google 结果下载只允许受支持的 Cloud 地址。

本地图片 Base64 传入，不要求 MinIO 公网开放。缺项目、ADC 或模型权限时明确失败，不切换到其他 Google 入口或供应商。模型输出不会被执行。

## 4. 验证与限制

`npm run check` 使用假供应商 / 假 HTTP 返回，不产生模型费用。真实模型调用需要已配置的项目、身份和模型权限；免费试用、促销额度能否抵扣由账号和 Google 当前政策决定，代码不能改变资格。

已有 `smoke:real` 会生成图片、视频并产生费用，须核对预算后显式加 `--yes`。当前改造未执行付费冒烟，不把协议测试当作真实账号联调通过。

参考：[Vertex AI 认证](https://cloud.google.com/vertex-ai/docs/authentication)、[ADC 本地配置](https://cloud.google.com/docs/authentication/set-up-adc-local-dev-environment)、[AI SDK Vertex Provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex)。

## 5. 临时失败的处理

真实调用已观察到大模型 HTTP 429。Google 的 429 可以表示请求频率或可用容量受限，不据此判断试用额度已经耗尽。大模型会按 D-62 有界退避，持续受限时页面明确提示稍后重试；网络中断和超时分别提示，不再合并成模型未配置。SDK 原始错误体、请求素材、密钥和 token 不写入日志。若持续出现 429，需要在 Google Cloud 核对该项目和模型的配额/用量，应用侧重试不能保证获得上游容量。

参考：[Google 官方 429 处理说明](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/deploy/error-code-429)。
