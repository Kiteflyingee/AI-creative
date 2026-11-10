# MVP 页面与数据流（AGENTS.md 第一轮交付 ②）

> 版本：v0.2 · 2026-11-10。页面名与 [02](02-产品PRD与移动端交互.md) §7 一致，实体与状态名与 [04](04-技术架构与数据模型.md) 一致。

## 1. 页面流程

```mermaid
flowchart TD
  subgraph Tabs[底部 Tab]
    Insp[灵感首页]
    Create[创作首页]
    Works[作品列表]
    Me[我的]
  end

  Login[登录] --> Insp
  Insp --> Case[案例详情]
  Case -->|用我的商品创作| Import[商品导入]
  Create -->|新建商品视频| Import
  Create -->|选择已有商品| Confirm[商品确认]
  Import --> Confirm
  Confirm --> Story[创意选择]
  Story --> Board[故事板]
  Board -->|去生成| Gen[生成确认]
  Gen -->|修改故事板或总时长| Board
  Gen -->|确认并扣积分| Progress[任务进度]
  Gen -->|余额不足| Credits[积分明细]
  Progress -->|已完成| Detail[作品详情]
  Progress -->|失败或已取消，已退积分| Board
  Works --> Progress
  Works --> Detail
  Detail -->|修改故事板后重新生成| Board
  Me --> Credits
```

说明：

- 从“创作首页 → 选择已有商品”进入时，如果商品事实都已确认，商品确认页只做一次快速核对。
- “生成确认”是唯一会扣积分的页面；其他页面的操作都不扣积分。
- 重新生成一定回到故事板，再经生成确认重新报价、扣积分（D-10）。

## 2. 数据流

```mermaid
flowchart LR
  App[商家 App] -->|内部接口| API[NestJS 内部服务]
  Ops[运营后台] -->|运营接口| API
  App -->|签名 URL 直传商品图| OSS[(云对象存储)]
  API --> PG[(PostgreSQL)]
  API --> BQ[(Redis / BullMQ)]

  BQ --> Plan[planning 任务]
  BQ --> Render[render 任务]
  BQ --> Transfer[transfer 任务]
  BQ --> QC[qc 任务]

  Plan -->|商品图 + 事实| DS[DeepSeek]
  DS -->|属性建议 / Storyline / Storyboard JSON| Plan
  Plan --> PG

  Render -->|RenderPlan 编译的请求| SD[Seedance 2.5]
  SD -->|拉取参考图| OSS
  SD -->|任务 ID / 状态 / usage| Render
  Render --> PG

  Transfer -->|下载 video_url| SD
  Transfer -->|成片 + 封面| OSS
  Transfer --> FF[FFmpeg / ffprobe]
  Transfer --> PG

  QC --> FF
  QC -->|抽帧 + 参考图| DS
  QC -->|QcRecord| PG

  API -->|签名下载链接| App
  API -->|推送通知| App
```

| 数据 | 产生方 | 存放位置 | 使用方 |
|---|---|---|---|
| 商品图（ProductAsset） | App 上传 | 对象存储 + PostgreSQL 元数据 | DeepSeek 看图、Seedance 参考图、质检比对 |
| 商品事实（ProductFact） | DeepSeek 建议 + 商家确认 | PostgreSQL | Storyline、Storyboard、提示词编译器 |
| Storyline / Storyboard | DeepSeek 生成 + 商家编辑 | PostgreSQL（带版本） | 报价、提示词编译器 |
| Quote / CreditLedger / CreditAccount | NestJS | PostgreSQL | 生成确认、积分明细、运营成本报表 |
| RenderJob / RenderPlan / RenderSegment / ProviderTask | NestJS / render 任务 | PostgreSQL | 任务进度、对账、成本 |
| 成片与封面（VideoOutput） | transfer 任务 | 对象存储 + PostgreSQL 元数据 | 作品详情、下载、分享、质检 |
| 质检记录（QcRecord） | qc 任务 | PostgreSQL + 对象存储（证据帧） | 运营后台 |

## 3. 生成时序

```mermaid
sequenceDiagram
  autonumber
  participant App as 商家 App
  participant API as NestJS 内部服务
  participant DB as PostgreSQL
  participant Q as BullMQ
  participant W as 后台任务
  participant S as Seedance 2.5
  participant O as 对象存储
  participant L as DeepSeek

  App->>API: POST render-quote（分辨率、总时长）
  API->>DB: 写入 Quote（积分、价目版本、过期时间）
  API-->>App: 所需积分、当前余额、过期时间
  App->>API: POST render（quoteId、idempotencyKey）
  API->>DB: 事务：校验报价与余额，创建 RenderJob（QUEUED），写 DEBIT，扣余额
  API->>Q: 入队 render
  API-->>App: renderJobId

  alt 排队中取消
    App->>API: POST jobs/:id/cancel
    API->>DB: RenderJob 改为 CANCELLED，写 REFUND
    API-->>App: 已取消（已退积分）
  else 正常执行
    Q->>W: 取出任务（并发 ≤ 3）
    W->>DB: 生成 RenderPlan（1 段）
    W->>S: 创建任务（提示词 + 参考图签名 URL）
    S->>O: 拉取参考图
    S-->>W: providerTaskId
    W->>DB: RenderJob 改为 SUBMITTED
    loop 每 10–15 秒轮询
      W->>S: 查询任务
      S-->>W: queued / running / succeeded / failed
    end
    alt 失败、审核拦截或超时
      W->>DB: RenderJob 改为 FAILED，写 REFUND
      W-->>App: 推送：失败（已退积分）
    else 生成成功
      W->>DB: GENERATING 后改为 TRANSFERRING，记录 usage 与成本
      W->>S: 下载 video_url（24 小时内）
      W->>O: 保存成片与封面
      W->>DB: RenderJob 改为 QC_RECORDING
      W->>L: 抽帧与参考图比对、字幕比对
      W->>DB: 写入 QcRecord，RenderJob 改为 COMPLETED
      W-->>App: 推送：成片已完成
    end
  end
  App->>API: GET jobs/:id（打开页面或收到推送后刷新）
```

时序中省略的分支（规则见 04 §4.2）：

- **SUBMITTED 时取消**：API 调用供应商 `DELETE`，只有供应商仍在排队时成功，成功后 `CANCELLED` 并退积分；否则提示“生成中无法取消”。
- **转存失败**：在 24 小时、100 次下载上限内重试，用尽后 `FAILED` 并退积分。
- **超时后迟到成功**：任务已 `FAILED` 并退积分，之后供应商仍生成成功并计费的，记为平台损失，视频不交付。
- **质检出错**：写 `QcRecord(state=ERROR)`，任务照常 `COMPLETED`。

## 4. 原型阶段 mock 与真实接口的界线

M0 原型全部使用假数据。**界面上凡是 mock 的内容必须标注“mock”**，占位视频画面上写明“MOCK 占位视频，非 AI 生成”，模拟进度写明“模拟进度”（AGENTS.md 工作方式）。

| 页面 / 功能 | M0 原型（mock） | M2 真实接口 |
|---|---|---|
| 登录 | 本地假用户 | `POST /app/v1/auth/dev-login` |
| 灵感首页、案例详情 | 本地 JSON 假案例（原创示意素材） | `GET /app/v1/inspirations`、`/inspirations/:id` |
| 商品导入 | 本地相册图片，只在本机显示，不上传 | 签名 URL 直传 + `POST /products/:id/assets` |
| 商品确认 | 固定的假属性建议 | `POST /products/:id/analyze`（DeepSeek）+ `PATCH /products/:id/facts` |
| 创意选择 | 固定 3 条假 Storyline | `POST /projects/:id/storylines`（DeepSeek） |
| 故事板 | 固定假故事板，可本地编辑，时长调整算法用真实实现 | `POST /projects/:id/storyboards`、`PATCH /storyboards/:id` |
| 生成确认 | 本地按假价目表计算积分，假余额 | `POST /projects/:id/render-quote`、`/render` |
| 任务进度 | 定时器模拟状态变化（标注“模拟进度”） | `GET /jobs/:id`、`POST /jobs/:id/cancel` |
| 作品详情 | 占位视频（标注“MOCK 占位视频，非 AI 生成”） | `GET /projects/:id/outputs`、`/outputs/:id/download-url` |
| 我的、积分明细 | 假流水 | `GET /me/credits`、`/me/credits/ledger` |
| 运营后台 | 不做 | `/ops/v1/*` |
