---
inclusion: always
---

# 移动端 UI 设计规范（H5 · v2 · 2026-11-12）

本规范约束 `apps/h5` 的所有页面。数值以代码为准：`apps/h5/src/ui/ui.css` 的 `:root` 变量和组件类就是 Design Tokens 的实现；本文与代码不一致时，先改代码或本文使二者一致，不要各写一套。

## 0. 现状与依据

**技术栈（继承，不新增框架）**：React 18 + Vite + antd-mobile 5 + 纯 CSS（无 Tailwind、无 CSS-in-JS）。设计系统已经存在：

| 文件 | 内容 |
|---|---|
| `src/ui/ui.css` | 变量 `--ui-*`、全部组件类 `ui-*`（页面骨架、按钮、标签、顶栏、区块、表单、选择块、提示条、操作栏、弹层、图片块、故事线、故事板、进度、作品、登录、分享、首页、导航、骨架） |
| `src/ui/theme.css` | 把 antd-mobile 保留组件（Input、TextArea、Dialog、ActionSheet、Toast）的外观统一成本规范 |
| `src/ui/kit.tsx` | `Btn`、`IconButton`、`Pill`、`Field`、`ChoiceGroup`、`CheckRow`、`Notice`、`Sheet`、`cx` |
| `src/ui/icons.tsx` | 全部图标 |
| `src/components.tsx` | `PageHeader`（返回 + 标题 + 五步进度）、`FlowPage`、`Section`、`BottomBar`、`Loading`、`AiBadge`、`EmptyHint`、`UploadButton`、`AssetImage`、`ChatBox` |

**迁移状态（2026-11-12）**：全部 10 个页面（首页、登录、分享、发布表单，以及商品、故事线、故事板、确认、进度、作品 6 个流程页）已按本规范实现。首页是五格导航（主页、广场、发布、作品、我的），广场目前是占位页。商品页是“确认卖点”页（D-56）：每屏只要求商家做一件事，选填内容默认收起；新页面也按“必填项尽量少、选填收进‘更多’”设计。页面里只使用 §5.2 白名单内的 antd-mobile 组件；`styles.css` 只剩全局基础样式，旧类名（`.section`、`.shot-card`、`.fact`、`.asset-*`、`.storyline-card` 等）已删除。迁移后端到端测试通过，截图见 `apps/h5/e2e/screenshots/`（iPhone 13 尺寸）；§8 要求的其他 3 个尺寸还没有逐页截图验收。

**仍需注意的问题**：

1. 卡片里的操作按钮仍偏多：故事板镜头卡有“编辑 + 上移 + 下移 + 删除”（已改成一个文字按钮加三个图标按钮），作品页每个镜头有“播放 + 重新生成”。新增操作时按 §5.3 收进“更多”。
2. 镜头卡仍是“画面：… 运镜：… 口播：… 字幕：…”的字段清单（字段名已改成灰色，但还带全角冒号，违反 §5.3），信息密度偏高。下次改故事板页时去掉冒号。
3. 代码里有不在刻度表内的圆角（24、15、13、11、10）和写死的颜色（`#217a45`、`#935800`、`#7d4c00`、`#a8262e`、`#c0313a`、`#cf4321`），只能出现在现有组件里，不能再新增。
4. `main.tsx` 只打包了 Noto Sans SC **700**（给 Remotion 字幕用）。系统没有苹方时，中文会回退到这个字体，500 也显示成粗体。界面字重只能用 400 / 500，并且必须在截图里核对实际效果。
5. 上一版 steering（v1）里的部分数值与代码不符（如圆角 20/14、图标按钮 44、问候语字重 600），以本文为准。

**视觉参考**：Dribbble「AI Video Generator & Creative Studio Mobile App」，依据是 `design-references/image.png` 的三张屏（引导页、首页、AI Studio）。从中提取的是可执行的规律，不复制它的品牌、文案、图片和英文界面：

- 整个界面只有黑、白、浅灰；颜色只来自作品画面。
- 每屏一个大标题（中等字重、字距略收紧）+ 一行灰色副标题。
- 主入口是浅灰大圆角的输入条，右端嵌一个黑色方块按钮，里面是星形。
- 作品用大面积竖向卡片展示，圆角很大；卡片上只叠毛玻璃元素：左上角标签、正中播放按钮、左下角白色标题。
- 筛选用胶囊：选中黑底白字，未选中白底加发丝线。
- 图标按钮是浅灰圆角方块；返回按钮和页面标题在同一行，标题左对齐。
- 参数选择是带图标的浅灰块，横向排列、自动换行。
- 底部是悬浮的黑色胶囊导航，选中格反白，中间是更大的星形。
- 全屏主按钮是黑底白字，圆角约为高度的三分之一。

本项目与参考的差异是有意的：导航五格都带文字标签（参考图只有图标）；作品画面是 9:16；头像用昵称首字，不用照片；轮播两侧的卡片只缩小、不倾斜，倾斜只用于登录页的扇形插图。

## 1. 产品 UI 设计目标

1. 面向普通电商卖家的消费级创作 App。新用户第一次打开，3 秒内能找到“新建一条视频”的入口。
2. 作品是主角：有成片时，成片画面占首屏面积的 40% 以上；界面本身不抢颜色。
3. 流程页（商品 → 故事线 → 故事板 → 确认 → 进度 → 作品）每一屏只回答一个问题，并且只有一个下一步。
4. 看起来像 App Store 上的原生 App，不像网页表单，也不像后台管理系统。
5. 所有 AI 生成的成片都清楚标明“AI生成”（AGENTS 约束 6）。

## 2. 视觉设计原则（可检查）

1. **黑白灰**：界面元素只用 §3.1 的中性色。状态色只出现在 6px 状态点、`ui-pill--*` 和 `ui-notice--*` 里；按钮、标题、背景块都不能用彩色。
2. **一屏一个主操作**：每屏最多一个 `ui-btn--primary`（黑色）。流程页的主操作固定放在底部操作栏，首页的主入口是创作入口条。其他操作用 `secondary`、`surface`、`ghost` 或 `IconButton`。
3. **用底色和留白分区**：区块之间用间距分隔（28px），卡片用 `--ui-fill` 浅灰底加大圆角。整块描边、虚线、分组标题栏都不允许。描边只用于未选中的胶囊和分析说明框（1px `--ui-hairline`）、选中的版本（2px 黑色内描边）。
4. **用字号和灰度分层级，不靠加粗**：标题 500，正文 400；次要信息改成 `--ui-text-2` 或 `--ui-text-3`，而不是缩小到 11px 以下。
5. **大圆角、外圆角大于内圆角**：嵌套时内层圆角 = 外层圆角 − 内边距（如 24 的卡片里、内边距 10 的图片用 14–16）。
6. **选中态用反色**：选择块、胶囊、故事线卡片选中后都是黑底白字（`.is-on` / `.is-active` / `.is-selected`），不用彩色边框或勾选角标。

## 3. Design Tokens

新代码只能使用下面的变量。需要新值时，先加到 `ui.css` 的 `:root`，再同步更新本节。

### 3.1 颜色

| 变量 | 值 | 用途 |
|---|---|---|
| `--ui-bg` | #FAFAFA | 页面背景、顶栏背景 |
| `--ui-surface` | #FFFFFF | 弹层、胶囊默认底、浅灰卡片里的次按钮 / 图片底、导航选中格 |
| `--ui-fill` | #F1F1F3 | 卡片、输入框、输入条、图标按钮、选择块、分组列表、图片占位 |
| `--ui-fill-strong` | #E7E7EA | 按下态、进度条底、步骤条未完成段 |
| `--ui-ink` / `--ui-text` | #0E0E10 | 主按钮、选中态、导航、标题与正文 |
| `--ui-ink-soft` | #1F1F23 | 没有封面时的媒体底 |
| `--ui-text-2` | #6B6B72 | 副标题、说明、字段名（对 #FAFAFA 约 5:1，可放必要信息） |
| `--ui-text-3` | #A3A3AA | 时间、计数、箭头、占位文字（约 2.4:1，**只能放可有可无的信息**，不能放按钮文字、错误、必填说明） |
| `--ui-hairline` | rgba(14,14,16,.08) | 发丝线 |
| `--ui-on-media` / `--ui-on-media-2` | #FFF / rgba(255,255,255,.78) | 画面上和黑底上的文字 |
| `--ui-glass` | rgba(255,255,255,.2) + `blur(14px) saturate(160%)` | 叠在画面上的标签、播放按钮 |
| `--ui-accent` | #FF5A36 | 只用于“进行中”状态点和 `ui-pill--accent`；从项目原主色继承，**不再用于按钮** |
| `--ui-success` / `--ui-warning` / `--ui-danger` | #2F9E5B / #B26B00 / #E5484D | 状态点、提示文字、退出登录等危险操作 |

画面上压暗只用 `linear-gradient(to top, rgba(0,0,0,.5) 0%, transparent 40%)`，目的只是保证白字可读。

### 3.2 字体

- 字体栈 `--ui-font`：`-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Noto Sans SC', 'Hiragino Sans GB', 'Helvetica Neue', sans-serif`。不引入新的网络字体。
- 字重只用 400、500。不要用 600、700 和 `<b>` 做强调（`ui-analysis b` 已经设为 500）。
- 数字（时长、计数、百分比、步骤编号）加 `font-variant-numeric: tabular-nums`。
- 输入框字号固定 16px，防止 iOS 聚焦时放大页面。

| 角色 | 字号/行高 | 字重 | 类 |
|---|---|---|---|
| 首页问候 | 32/40，字距 -0.01em，单行省略 | 500 | `ui-display` |
| 一级页标题、状态大字 | 30/40（状态、汇总数字 30/38） | 500 | `ui-page-title`、`ui-status__title`、`ui-summary__big`、`ui-login__title` |
| 区块标题、弹层标题 | 20/28 | 500 | `ui-title`、`ui-block__title`、`ui-sheet__title` |
| 卡片大标题 | 19/26 | 500 | `ui-story__title` |
| 流程页顶栏标题、对话框标题 | 18/24（对话框 18/26） | 500 | `ui-header__title` |
| 列表行标题、按钮（大） | 16/22 | 500 | `ui-row__title`、`ui-btn` |
| 正文、副标题、卡片内容 | 15/22 | 400 | `ui-lead`、`ui-fact__text`、`ui-story__hook` |
| 次要正文、镜头字段 | 14/20–21 | 400 | `ui-shot__fields`、`ui-timeline` |
| 说明、状态、字段名 | 13/18–19 | 400（字段名 500） | `ui-caption`、`ui-block__desc`、`ui-field__label` |
| 提示、时间 | 12/16–17 | 400 | `ui-field__hint`、`ui-work__time` |
| 标签、步骤名 | 11–12 | 500 | `ui-pill`、`ui-ai-badge`、`ui-steps-bar__name` |

11px 是下限（插图里的装饰文字除外）。

### 3.3 间距

- 刻度（4 的倍数）：`--ui-s1` 4 · `s2` 8 · `s3` 12 · `s4` 16 · `s5` 20 · `s6` 24 · `s7` 28 · `s8` 32 · `s10` 40。
- 页面左右边距 `--ui-gutter` = 16px，全站统一；横向滚动区用负边距铺满屏幕宽，再用 `scroll-padding-inline: var(--ui-gutter)` 对齐。
- 区块之间 28px（`ui-block` / `ui-section`）；区块标题到内容 12px；卡片内边距 16（故事线卡 18）；同组卡片之间 10–12。
- 组件内部的紧凑间隙允许 4 / 6 / 8 / 10 / 14（已在现有组件中使用），不再引入其他值。

### 3.4 圆角

| 变量 / 值 | 用途 |
|---|---|
| `--ui-r-xl` 28 | 首页大卡片、空状态、弹层顶部、登录扇形卡 |
| 24 | 故事线卡、流程步骤卡、播放器（新代码写成 `var(--ui-r-xl)` 或补一个变量后再用，不要再写字面量） |
| `--ui-r-lg` 22 | 作品封面、镜头卡、分组列表、提示词框 |
| `--ui-r-md` 16 | 输入框、卖点卡、图片块、提示条、图标按钮 48 |
| `--ui-r-sm` 12 | 缩略图、小图标按钮 36 |
| `--ui-r-pill` | 胶囊、标签、AI 标识 |
| 控件 | 按钮按高度取：54→18、46→16、38→13、30→10；选择块 46→15、38→13；入口条 56→18（右侧按钮 46→14） |

### 3.5 阴影

全站只有这三种，不允许新增：

| 位置 | 值 |
|---|---|
| 悬浮底部导航 `ui-dock` | `0 10px 30px rgba(14,14,16,.18)` |
| 登录页扇形插图正面卡 | `0 24px 48px rgba(14,14,16,.22)` |
| 内描边（不算投影） | 未选中胶囊 `inset 0 0 0 1px var(--ui-hairline)`；选中版本 `inset 0 0 0 2px var(--ui-ink)`；勾选圈 `inset 0 0 0 1.6px var(--ui-text-3)` |

卡片、按钮、弹层都不加投影。

### 3.6 尺寸与动效

- 点击区域不小于 44×44。按钮高度：`lg` 54、`md` 46、`sm` 38、`xs` 30（`xs` 只用于卡片内的次要操作，并保证周围留白使点击区达到 44）。图标按钮 48 / 36。胶囊 36。选择块 46 / 38。
- 动效变量：`--ui-ease: cubic-bezier(.2,.8,.2,1)`，`--ui-dur: 180ms`。

## 4. 页面布局规范

只有三种页面骨架，新页面必须选其中一种：

**A. 一级页（首页的主页 / 广场 / 作品 / 我的）**：`ui-page ui-page--dock`

1. `ui-topbar`：高 56，只有左边的品牌星形（30）。
2. 问候：`ui-display` 加一行 `ui-lead`，上方间距 12。
3. 主入口：`ui-create-bar`，上方间距 20。
4. 内容区块：`ui-section-head`（左边标题，右边 `ui-link`“全部”），下面是大卡轮播、列表或网格。
5. 悬浮导航 `ui-dock` 加遮挡层 `ui-dock-scrim`。

**B. 流程页（商品 → 作品）**：`FlowPage`（`ui-page ui-page--flow`，有底部操作栏时传 `bar`）

1. `PageHeader`：吸顶，返回按钮 48 + 左对齐标题 + 五步进度条（4px 线段 + 11px 步骤名）。
2. 需要提醒时在顶栏下方放 `ui-notice-wrap` + `Notice`。
3. 内容用若干 `Section`（`ui-block`）：标题 20，必要时加一行说明，区块之间 28。
4. `BottomBar`（`ui-actionbar`）：固定在底部，上方 32px 渐隐。里面最多两个按钮：右边是 `lg` 主按钮并且 `block`，左边可选一个 `secondary` 次按钮。
5. 对话修改（`ChatBox`）放在最后一个区块之后、操作栏之前。

**C. 独立页（登录、分享）**：`ui-login` / `ui-share`，内容垂直居中，主按钮贴底并且通栏。

**弹层**：用 `Sheet`：顶部圆角 28、拖动条 36×5、标题 20、底部按钮吸底。确认类对话框用 antd `Dialog`（外观已在 theme.css 统一）。一个弹层只做一件事，不在弹层里再开弹层。

**通用布局规则**：

- 内容最大宽度 560px（`#root`），固定定位元素同样限制在 560 内并水平居中。
- 首屏顺序固定：标题 → 主入口或关键信息 → 内容。不要把说明文字放在主入口之前。
- 列表超过 6 项时用横向滑动或“全部”入口收起，首页不铺长列表。
- 长文本：标题单行省略；正文最多显示 3 行，超出时放到详情或弹层里看。

## 5. 导航栏及通用组件规范

### 5.1 导航

- **底部导航 `ui-dock`**：只在一级页显示。黑色胶囊，高 68，内边距 6，圆角 26，距底 12 + 安全区；宽度 = 屏幕宽 − 2 × 16（最大 528），五格等分，格间距 4。
  - 五格依次是：主页（`IconHome`）、广场（`IconCompass`）、发布（`IconSparkle` 26，实心）、作品（`IconFilm`）、我的（`IconUser`）。其余图标 22。
  - 每格是图标加文字：图标放在高 26 的 `ui-dock__icon` 里，下方 11/13 的文字标签，字重 500。
  - 选中格白底黑字，圆角 20；未选中格透明底、`--ui-on-media-2` 的白色。
  - “发布”是动作不是页签：永远不显示选中态，文字为纯白；点了直接进入发布表单 `/publish`。
  - 当前页签加 `aria-current="page"`。320 宽时每格 52×56，仍满足 44 的点击区。
- **页签地址**：主页是 `/`，其余用 `?tab=plaza|works|me`。
- **流程页顶栏**：不用 antd `NavBar`；返回按钮用 `IconButton` + `IconBack`（22），右侧最多一个 `extra` 图标按钮。

### 5.2 组件选用（先复用，再新增）

| 需要 | 用 | 不要用 |
|---|---|---|
| 按钮 | `Btn`（`primary / secondary / surface / ghost / danger`，`lg / md / sm / xs`） | antd `Button`、描边按钮、橙色按钮 |
| 只有图标的按钮 | `IconButton`（必须给 `label`） | 没有 `aria-label` 的 `<button>` |
| 标签 / 状态 | `Pill`（`neutral / ink / success / warning / danger / accent`）、`AiBadge`、`ui-glass-pill`（画面上） | antd `Tag`、`fill="outline"` |
| 单选 / 多选 | `ChoiceGroup`（可带图标，参考图里的参数块） | antd `Selector`、`Radio` |
| 勾选列表 | `ui-checklist` + `CheckRow` | antd `Checkbox` |
| 表单项 | `Field` + antd `Input` / `TextArea`（加 `className="ui-input"`） | antd `Form` / `Form.Item` |
| 提示 | `Notice`（`neutral / warning / danger`） | antd `NoticeBar` |
| 进度 | `ui-bar` + `ui-bar__fill`，配大号百分比 `ui-status__pct` | antd `ProgressBar` |
| 步骤 | `PageHeader` 的 `step` | antd `Steps` |
| 底部弹层 | `Sheet` | 直接用 `Popup` 写样式 |
| 空状态 | `EmptyHint`（浅灰大圆角 + 一句说明 + 最多一个按钮） | antd `Empty`、插画 |
| 加载 | 首次进入流程页用 `Loading`；列表和卡片用骨架 `ui-skel`；按钮用 `Btn loading` | 整页遮罩转圈 |
| 图片 | `ui-tiles` / `ui-tile`（3 列）、`ui-hrail` + `ui-ref`（横滑 9:16）、`AssetImage` | `.asset-*` 旧类 |
| 可点选并能修改的列表（卖点） | `ui-checklist` 里放 `ui-point`：左边整行是 `ui-check-row`（点选），右边一个 `IconButton` 铅笔（修改，打开 `Sheet`）；最后一行 `ui-point-add`“自己加一条” | 每条下面一排“确认 / 修改 / 删除”按钮 |
| 已有图片的紧凑管理 | `ui-thumbs` 缩略图条（56×72）+ `ui-thumb-add`；需要处理的图右上角 `ui-thumb__flag`，点开用 `ActionSheet` 说明并处理 | 在主流程页放完整的图片网格和质量标签 |
| 选填内容 | `ui-more` 折叠块（默认收起，副标题写清里面有什么），展开内容放 `ui-more-body` | 把选填输入框全部铺在页面上 |
| 等待 AI | `ui-ai-status`（黑底一行说明 + 转圈）加形状一致的骨架 `ui-skel-point`、`ui-skel-line` | 整页遮罩转圈 |
| 一个值 + 修改（如商品名称） | `ui-name-card`：小标签、大号值、来源 `Pill`、铅笔，整块可点 | 常驻输入框 |
| 还没有图时的上传 | `UploadHero`（`ui-upload-hero`：黑色圆形加号 56、标题、说明、角度提示胶囊）；有图后换成 `ui-tiles` + `UploadButton variant="tile"`；批量上传用 `uploadFiles` | 空白的图片网格 |
| 表单项标题旁的标签 | `ui-field__label-row` + `Pill`（“选填”用 `on-bg`，“AI 填写”用 `ink` 加 10 号星形） | 在标题后面写括号说明 |
| 分组信息 | `ui-list` + `ui-list__row` 或 `ui-group` | 表格、灰色分组标题栏 |
| 业务卡片 | 卖点 `ui-fact`，故事线 `ui-story`，镜头 `ui-shot`，版本 `ui-versions` / `ui-version`，播放器 `ui-player` | `styles.css` 中对应的旧类 |

antd-mobile 只允许在页面里使用：`Input`、`TextArea`、`Dialog`、`Popup`（仅在 `Sheet` 内部）、`ActionSheet`、`Toast`、`SpinLoading`、`ConfigProvider`。

### 5.3 组件规则

- **按钮文案**：2–6 个字，动词开头（“生成视频”“用这条”“重新生成”）。同一行最多 2 个按钮。
- **卡片里的多个操作**：最多露出 2 个按钮（一个 `surface` 加一个 `primary` 或 `ghost`），其余收进 `IconButton`（“更多”）+ `ActionSheet`。镜头卡的上移、下移、删除按这个规则改：排序用图标按钮，删除放进动作面板并二次确认。
- **字段展示**：字段名用 `.k`（`--ui-text-3`），值用正文色，字段名与值同行；不写全角冒号。
- **选中**：用反色表示（§2.6），不要同时再加勾选角标或彩色边框。
- **危险操作**（删除、退出登录）：`Btn variant="danger"` 或 `ui-group__row--danger`，并且必须经过 `Dialog.confirm`。
- **Toast**：只给结果反馈（“已应用修改”），不超过 2 行、1.5–3 秒。需要用户处理的错误放进 `Notice` 或字段下方的 `ui-error`，不要只弹 Toast。

## 6. 图标、插画、图片使用规范

- **图标**：只能用 `src/ui/icons.tsx` 里的图标。规格：24×24 视图，描边 1.6（加号、关闭、对勾 2–2.2），圆角端点，颜色跟随 `currentColor`。品牌星形和播放按钮是实心。不混用 antd-mobile-icons、emoji 或其他图标库。需要新图标时，按同样规格画好加到 icons.tsx。
- **图标尺寸**：顶栏和导航 22；品牌 30；导航中间的星形 26；按钮内和小图标按钮 18；勾选 14；AI 标识里的星形 10。
- **插画**：不用插画和装饰图片。流程示意只用 `ui-art`（灰色、黑色几何块）；登录页只用 `ui-fan` 扇形卡。
- **图片比例**：

| 内容 | 比例 / 尺寸 | 裁切 |
|---|---|---|
| 商家上传图、AI 生成图（网格） | 3:4，3 列，间距 10，圆角 16 | `cover` |
| 参考图（横滑） | 9:16，宽 132 | `cover` |
| 成片封面（首页大卡） | 高度 `--ui-hero-h`，宽约为高的 0.8，圆角 28 | `cover`，`object-position: 50% 25%`，避开烧录在下部的字幕 |
| 作品网格 | 9:16，2 列，列间距 12、行间距 20，圆角 22 | `cover` |
| 列表缩略图 | 54×72，圆角 12 | `cover`，没有图时显示浅灰底加商品名首字 |
| 播放器 | 9:16，最大高 72svh，圆角 24 | `contain`，黑底 |

- **画面上的元素**：只用毛玻璃（`ui-glass-pill`、`ui-play`）和白字。标签放左上角（距边 14，网格里 10），播放按钮放正中（56），标题和时间放左下角。
- **AI 标识**：每个成片封面、播放器、分享页都要显示“AI生成”（画面上用 `ui-glass-pill`，白底区域用 `AiBadge`）。
- **真实性**：不用示例图冒充作品，也不用库存照片。没有成片时显示流程引导，不显示假数据（AGENTS 约束 9）。
- 图片都要有 `alt`（纯装饰图写 `alt=""`），列表里的图片加 `loading="lazy"`。

## 7. 页面交互与动画规范

| 场景 | 规则 |
|---|---|
| 按下反馈 | 卡片和大块用 `ui-pressable`，缩放到 0.97；图标按钮和导航格缩放到 0.94；列表行透明度降到 0.6；`--ui-dur` 180ms + `--ui-ease` |
| 状态切换 | 只过渡 `background`、`color`、`transform`、`opacity`，时长 180ms。不对 `width`、`height`、`top` 做动画（进度条宽度例外，500ms） |
| 轮播 | 横向滑动并按卡片吸附（`scroll-snap`），居中卡片 1.0，两侧 0.9（`animation-timeline: view()`，不支持的浏览器不缩放）；隐藏滚动条；`overscroll-behavior-x: contain` |
| 加载 | 骨架的形状和尺寸与真实内容相同，1.4s 扫光；轮询刷新时保持布局高度不变，不能闪成骨架 |
| 进行中 | 状态点 `ui-dot--running` 1.6s 闪烁；进度页显示大号百分比和 `ui-bar` |
| 提交 | 点击后按钮进入 `loading` 并禁用，防止重复提交（生成接口还有幂等键） |
| 弹层 | 用 antd 自带的进出场动画，不另加；点遮罩关闭；有未保存内容时先确认 |
| 页面切换 | 不加转场动画；返回按钮回到明确的上一步（`PageHeader` 的 `back`） |
| 减少动效 | `prefers-reduced-motion: reduce` 时关闭骨架扫光、状态点闪烁、所有过渡和轮播缩放（`ui.css` 底部已有，新增动画必须加进去） |
| 焦点 | 键盘聚焦显示 2px 黑色外框，偏移 2px |
| 防误触 | 按钮加 `touch-action: manipulation`、禁止选中文字（已在 `.ui-page :where(button)` 中设置） |

## 8. 响应式布局及安全区域规范

- **支持宽度**：320–560px。大于 560 时内容居中，两侧显示 `--ui-bg`。不做横屏专门布局。
- **必须截图验证的尺寸**：320×568（最小屏）、390×664（矮屏，浏览器工具栏展开）、390×844（主流）、430×932 并模拟安全区（顶 47、底 34）。
- **安全区**：`index.html` 已设置 `viewport-fit=cover`。顶部用 `--ui-safe-top`（`ui-page`、`ui-header` 已处理），底部用 `--ui-safe-bottom`。固定在底部的元素一律写成 `calc(间距 + var(--ui-safe-bottom))`。
- **底部留白**：一级页 = 导航 68 + 间距 12 + 安全区 + 40；有操作栏的流程页 = 操作栏 54 + 安全区 + 64。新增固定元素时同步调整，内容最后一行不能被挡住。
- **高度**：用 `100svh` / `100dvh`，并保留 `100vh` 作为兜底。首页大卡高度由 `--ui-hero-h` 按屏幕高度计算；改了首屏上方元素的尺寸，必须同步改 `--ui-fold`。
- **窄屏（≤340px，`ui.css` 末尾的媒体查询）**：问候语 28；状态与汇总大字 26/34；入口条文字 14；步骤卡宽 140；参考图宽 120；图片网格间距 8，仍为 3 列。新组件需要窄屏调整时加进这个媒体查询。不要通过缩小字号到 11px 以下来硬塞内容。
- **不允许横向溢出**：页面 `scrollWidth` 不能大于 `clientWidth`；只允许 `ui-rail`、`ui-hrail`、`ui-chips`、`ui-step-rail`、`ui-versions` 横向滚动。
- **键盘**：输入框 16px 字号；底部操作栏在键盘弹起时不能盖住正在输入的框（输入多行内容时放进 `Sheet`）。

## 9. UI 禁止事项

1. 在页面里使用 §5.2 白名单以外的 antd-mobile 组件，或使用 `color="primary"`、`fill="outline"`。
2. 在 `ui.css` 的 `:root` 以外写新的十六进制颜色或 `rgba` 颜色；写不在 §3.4 表里的圆角；新增阴影。
3. 新的 `style={{…}}` 内联样式（只允许传 CSS 变量，如 `style={{ '--size': '28px' }}`）；在页面文件里定义新的全局类名。新的样式写进 `ui.css` 对应的分节。
4. 一屏出现两个及以上黑色主按钮；彩色按钮；描边按钮。
5. 后台风格：表格、整行描边卡片、灰色分组标题栏、虚线分隔、一排 3 个以上的小按钮、“字段名：值”的冒号清单。
6. 字重 600 / 700、全大写英文标签、11px 以下的文字、用 `--ui-text-3` 写重要信息。
7. 插画、emoji、库存图片、示例作品；其他图标库。
8. 成片画面上出现非毛玻璃的实色块（AI 标识除外），或封面上缺少“AI生成”。
9. 卡片里再嵌套卡片超过两层；弹层里再开弹层。
10. 改动或删除 e2e 依赖的 `data-testid`（导航用 `tab-home / tab-plaza / nav-publish / tab-works / tab-me`，入口条 `new-project`，上传区 `upload-PRODUCT`，发布表单 `publish-intro`，确认卖点页 `product-name-value / fact-confirm / fact-edit / fact-input / fact-save / add-fact / more-toggle / analyze / to-storylines`）。
11. 只看代码、类型检查或测试通过就认为 UI 完成（见 §10）。

## 10. 视觉验收标准

UI 改动完成的标准是**截图验收通过**，编译通过和测试通过不算完成。

**10.1 怎么截图**

- 不想手动启动服务时：运行 `npm run e2e -w @ai-creative/h5`，用假模型供应商走完整流程，截图输出到 `apps/h5/e2e/screenshots/`（iPhone 13 尺寸）。新增页面或状态时，在 `apps/h5/e2e/flow.spec.ts` 里补一张 `shot()`。
- 需要交互式查看时：
  1. 在 `apps/server` 运行 `node -r ts-node/register/transpile-only test/e2e-server.ts`（假供应商，端口 3101；会清空测试库）。
  2. 在 `apps/h5` 运行 `VITE_API_BASE=http://localhost:3101 npx vite --port 5174`。
  3. 用 Playwright MCP（全局配置在 `~/.kiro/settings/mcp.json`）打开 `http://localhost:5174`，按 §8 的尺寸调整视口，截图（整页加首屏）。
- 用完即停掉后台进程。截图不提交到 git（`e2e/screenshots/` 与 `e2e/review/` 已忽略）。

**10.2 必须逐项通过的检查**

| # | 检查 | 方法 |
|---|---|---|
| 1 | 按 §8 的 4 个尺寸截图，改动涉及的每个状态（空、加载、正常、错误、进行中、选中）都有截图 | 截图 |
| 2 | 每屏只有一个黑色主按钮；没有橙色或彩色按钮 | 截图 |
| 3 | 首屏有明确的视觉焦点；标题、正文、说明三级能一眼分清 | 截图 |
| 4 | 中文标题没有回退成粗体；字重符合 §3.2 | 截图（必要时用 `getComputedStyle` 查 `font-family` 和 `font-weight`） |
| 5 | 内容最后一行没有被底部导航、操作栏或安全区挡住；顶栏没有盖住内容 | 滚到底截图 |
| 6 | 没有横向滚动条；`document.scrollingElement.scrollWidth <= clientWidth` | 浏览器执行脚本 |
| 7 | 可点击元素不小于 44×44；只有图标的按钮有 `aria-label` | 快照（accessibility snapshot） |
| 8 | 成片封面、播放器、分享页有“AI生成” | 截图 |
| 9 | 图片比例和裁切符合 §6，烧录字幕没有和卡片标题重叠 | 截图 |
| 10 | 页面文件里没有白名单外的 antd 组件 | `grep -nE "from 'antd-mobile'" apps/h5/src/pages/*.tsx` |
| 11 | `:root` 以外没有新增颜色、圆角、阴影字面量；没有新增内联样式 | `git diff` 中检查 `#`、`rgba(`、`border-radius:`、`box-shadow:`、`style={{` |
| 12 | `npm run typecheck -w @ai-creative/h5` 和 `npm run e2e -w @ai-creative/h5` 通过 | 命令 |

**10.3 与参考设计对照**：把截图和 `design-references/image.png` 并排比较，逐项说明：留白和层级是否接近、是否只用黑白灰、圆角是否统一、是否还有后台式布局。发现问题要修改后重新截图，直到通过。

**10.4 汇报**：列出截图路径、覆盖的尺寸和状态、第 10.2 节每一项的结果；有没通过的项目要说明原因，不能写“已完成”。

## 11. 维护本规范

- 新增组件：先确认 `kit.tsx`、`components.tsx`、`ui.css` 里没有可用的；需要新增时，样式写进 `ui.css` 对应分节（类名 `ui-<组件>__<部分>`、状态 `.is-*`），React 封装写进 `kit.tsx`，再把组件补到本文 §5.2 的表里。
- 迁移旧页面：一次迁移一个页面，按 §5.2 替换组件，删除不再使用的 `styles.css` 旧类；保留所有 `data-testid`；完成后按 §10 截图验收，再更新 §0 的迁移状态。
- 修改 Token：同时修改 `ui.css` 的 `:root`、`theme.css` 中对应的 antd 变量，以及本文 §3。
