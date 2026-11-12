---
inclusion: fileMatch
fileMatchPattern: 'apps/h5/**'
---

# 移动端 UI 设计规范（H5，v2 · 2026-11-12）

视觉参考：Dribbble「AI Video Generator & Creative Studio Mobile App」。只借鉴设计语言（层级、比例、留白、组件形态），不使用其内容、品牌和素材。v2 起所有页面都按本规范实现。

实现位置：
- 设计变量与组件样式：`apps/h5/src/ui/ui.css`（变量 `--ui-*`，类名 `ui-*`）
- antd-mobile 外观：`apps/h5/src/ui/theme.css`（对话框、动作面板、轻提示、输入框）
- 基础组件：`apps/h5/src/ui/kit.tsx`（Btn、IconButton、Pill、Field、ChoiceGroup、CheckRow、Notice、Sheet）
- 流程页组件：`apps/h5/src/components.tsx`（PageHeader、FlowPage、Section、BottomBar、ChatBox、UploadButton、AssetImage、AiBadge、EmptyHint、Loading）
- 图标：`apps/h5/src/ui/icons.tsx`
- 两个样式表在 `main.tsx` 里最后加载；页面里不要再写一套变量，也不要写内联样式（动态数值和第三方组件的尺寸参数除外）。

## 1. 设计原则

1. **作品是主角**：界面只用黑白灰，颜色来自作品画面。每屏只有一个视觉焦点（大预览图或主操作）。
2. **一个主操作**：每屏只有一个黑色主按钮（列表里每张卡片各自的主操作除外）；次要操作用浅灰底按钮或纯文字按钮。
3. **用底色和留白分区**：页面背景近白，内容块用浅灰底色（`--ui-fill`）和大圆角区分，不用白卡片叠灰背景，不用描边和投影划分区块。带投影的只有首页悬浮导航和登录页示意卡片；带描边的只有首页未选中的筛选胶囊。
4. **字号和灰度表达层级**：标题大、字重 500；说明用灰色，不用加粗强调。
5. **不做后台风格**：不用表格式列表、成排小按钮、问号提示、整行描边卡片、步骤条组件。
6. **不遮挡**：悬浮的顶栏、底部操作栏、导航都带渐隐层；首屏的主要内容不能被它们压住，滚到底时最后的内容在它们上方。

## 2. 颜色

| 变量 | 值 | 用途 |
|---|---|---|
| `--ui-bg` | #FAFAFA | 页面背景 |
| `--ui-surface` | #FFFFFF | 浅灰卡片里的按钮和标签、弹层背景、导航选中格 |
| `--ui-fill` | #F1F1F3 | 内容卡片、输入框、次按钮、选择块、分组列表 |
| `--ui-fill-strong` | #E7E7EA | 按下态、进度条底色 |
| `--ui-ink` | #0E0E10 | 主按钮、选中状态、底部导航、标题文字 |
| `--ui-text-2` | #6B6B72 | 副标题、说明、表单项标题 |
| `--ui-text-3` | #A3A3AA | 提示、时间、计数、占位文字 |
| `--ui-hairline` | rgba(14,14,16,.08) | 分组列表行间分隔 |
| `--ui-glass` | rgba(255,255,255,.2) + blur(14px) | 叠在画面上的标签、播放按钮 |
| `--ui-accent` | #FF5A36 | 只用于“生成中”状态；不用于按钮 |
| `--ui-success` / `--ui-danger` / `--ui-warning` | #2F9E5B / #E5484D / #B26B00 | 状态标签、错误、提醒 |

antd-mobile 的主色 `--adm-color-primary` 已改为 `--ui-ink`（theme.css）。

## 3. 字体与文字层级

字体栈 `--ui-font`：`-apple-system, SF Pro Text, PingFang SC, Noto Sans SC, …`。输入框字号 16px，避免 iOS 聚焦时放大页面。

| 用途 | 字号/行高 | 字重 |
|---|---|---|
| 首页问候 `ui-display` | 32/40（≤340px 宽 28） | 500 |
| 页面大标题 `ui-page-title`、登录标题、进度状态、故事板总时长 | 30/38–40（≤340px 宽 26） | 500 |
| 区块标题 `ui-block__title` / `ui-title` | 20/28 | 500 |
| 故事线标题 | 19/26 | 500 |
| 顶栏标题 `ui-header__title`、弹层回复 | 18/24–26 | 500 |
| 卡片和列表标题 | 15–16/21–22 | 500 |
| 正文、输入 | 15–16/22–24 | 400 |
| 说明 `ui-block__desc` / `ui-caption` | 13/18–19 | 400 |
| 表单项标题 `ui-field__label` | 13/18 | 500 |
| 提示 `ui-field__hint`、标签 `ui-pill` | 12/17 | 400 / 500 |

数字（计数、时间段、百分比）用 `font-variant-numeric: tabular-nums`。长说明用 `text-wrap: pretty`，避免末行只剩一两个字。

## 4. 间距、圆角、尺寸

- 间距用 4 的倍数（`--ui-s1`…`--ui-s10`）。页面左右边距 16（`--ui-gutter`）。区块之间 28（`ui-block`、`ui-section`），区块标题与内容之间 12，卡片之间 10–12。
- 圆角：首页大卡片、空状态 28；故事线卡片、作品播放器 24；内容卡片、分组列表、作品封面 22；输入框、选择块、图片块、提示条 15–16；主按钮 18；小按钮 13；图标按钮 16（小号 12）；标签全圆角。
- 点击区域不小于 44×44（行内的小按钮和标签例外，但不小于 30）。参考尺寸：主按钮 54；中按钮 46；小按钮 38；最小按钮 30；图标按钮 48（小号 36）；输入框 50；选择块 46（小号 38）；首页入口条 56。

## 5. 页面骨架

**首页**（`HomePage.tsx`，`ui-page ui-page--dock`）：顶栏（星形标志 + 头像） → 问候 → 创作入口条 → 最近成片（大卡片轮播）或四步流程卡 → 我的创作（筛选胶囊 + 项目列表） → 悬浮导航。

**流程页**（商品素材、故事线、故事板、确认生成、生成进度、作品；`<FlowPage bar>`）：
- 顶栏 `PageHeader`：浅灰方形返回按钮 + 标题；下面是五段进度条和步骤名（已完成、当前为黑色）。顶栏吸顶，下方 12px 渐隐。
- 内容由 `Section` 组成：标题行（标题 + 右侧操作）→ 整行说明 → 内容。内容块是浅灰卡片或浅灰输入框，直接放在页面背景上。
- 底部操作栏 `BottomBar`：悬浮，上方 32px 渐隐；主按钮黑色 54px，次按钮浅灰，两个按钮平分宽度。有操作栏的页面用 `<FlowPage bar>` 留出底部空间。
- 用一句话修改 `ChatBox`：浅灰输入卡片，右下角黑色方形发送按钮（星形），点发送后在底部弹层里看修改对比。
- 作品页播放器：9:16 居中，高度跟随屏幕（`--ui-player-max-h`），下载、分享按钮在播放器下方，并保持在首屏。

**登录页**：品牌 → 扇形叠放的示意卡片（只用几何图形和真实的产品能力文案） → 居中大标题 + 说明 → 浅灰输入框 + 黑色通栏按钮。

**分享页**：品牌 → 9:16 播放器 → 标题 + “AI生成”标签 → 说明。

## 6. 组件

| 组件 | 用法 |
|---|---|
| `Btn` | `variant`：primary（黑）、secondary（浅灰）、surface（白，用在浅灰卡片里）、ghost（文字）、danger（红色文字）；`size`：lg 54 / md 46 / sm 38 / xs 30；`loading` 时自动禁用 |
| `IconButton` | 只有图标的按钮，必须传 `label`；`tone`：fill / surface / ink |
| `Pill` | 状态和属性标签；`tone`：neutral / ink / success / warning / danger / accent。浅灰卡片里 neutral 为白底，页面背景上加 `on-bg` 为浅灰底 |
| `AiBadge` | 黑底白字“AI生成”，成片封面、作品页、分享页必须显示（AGENTS 约束 6） |
| `Field` | 表单项：标题、输入框、提示直接显示在输入框下方。输入框用 antd `Input` / `TextArea` 加 `className="ui-input"` |
| `ChoiceGroup` | 时长、清晰度、参考图等选择，选中为黑底白字；可以带图标（时钟、清晰度），参照参考图的“16:9 / 2K / 15s” |
| `CheckRow` + `ui-checklist` | 勾选列表（确认生成页的镜头） |
| `Notice` | 提示条：neutral / warning / danger |
| `Sheet` | 底部弹层：顶部圆角 28、拖动条、标题、固定在底部的操作按钮 |
| `ui-list` + `ui-list__row` | 浅灰分组列表，行高 ≥56，行间发丝线从左 16 开始 |
| `ui-tiles` / `ui-tile` | 图片网格（3 列，3:4）；最后一格是黑色加号的“上传”块；删除按钮是右上角的深色毛玻璃圆钮 |
| `ui-hrail` + `ui-ref` | 横向滚动的参考图（9:16，宽 132） |
| `ui-story` | 故事线卡片；选中时整卡反白（黑底白字），按钮和标签跟着反色 |
| `ui-shot` | 镜头卡片：编号 + 标签、字段（标签名灰色）、参考图标签、操作（编辑 + 上移 / 下移 / 删除图标按钮） |
| `ui-fact` | 卖点卡片：正文在上，状态标签 + 操作在下 |
| 首页组件 | `ui-create-bar`、`ui-rail` + `ui-feature-card`、`ui-step-rail`、`ui-chips`、`ui-row`、`ui-work-grid`、`ui-group`、`ui-dock` |

不要在页面里直接使用 antd-mobile 的 Button、Tag、Selector、Checkbox、NoticeBar、ProgressBar、Steps、NavBar、List、Form、Empty；Dialog、ActionSheet、Toast 的外观已在 theme.css 统一（对话框按钮为浅灰 / 黑色胶囊，动作面板顶部大圆角）。

## 7. 图片与作品预览

- 首页大卡片约 4:5，宽为可视宽度的 78%，居中吸附，前后两张从两侧露出；支持滚动驱动动画的浏览器里两侧卡片缩小到 0.9。只有一张时占满宽度。卡片高度 `--ui-hero-h` 按屏幕高度计算，首屏不被导航挡住（改首页上方元素的尺寸时同步改 `--ui-fold`）。
- 封面是 9:16 成片帧，字幕烧录在画面下部，裁切时偏上取景（`object-position: 50% 25%`），避免字幕和卡片上的作品名重叠。
- 画面上的元素用毛玻璃：左上角标签、正中播放按钮、左下角白色标题和时间；底部 40% 压暗只为文字可读。
- 不用示例图冒充作品。没有成片时首页显示四步流程卡，登录页的示意卡片只用几何图形。

## 8. 底部导航（首页）

- 黑色悬浮胶囊，距底 12px 加安全区，圆角 26；三格：创作 · 新建（中间，30px 星形，无底色）· 作品，只有图标，读屏用 `aria-label`。选中格白底黑图标。
- 导航后面有遮挡层：导航所在高度内不透明，往上 20px 渐隐。
- “我的”从顶栏头像进入（`?tab=me`），进入后头像按钮变黑。

## 9. 图标

- 24×24 视图，描边 1.6，圆角端点，颜色跟随 `currentColor`；星形和播放为实心。新增图标放到 `src/ui/icons.tsx`，不混用 antd-mobile-icons。
- 尺寸：导航 24，返回 22，入口条 22，按钮内 14–18，标签内 10–12。

## 10. 交互与适配

- 按下反馈：按钮和选择块缩放到 0.97，图标按钮 0.94（180ms）；列表行降低透明度。系统设置“减少动效”时关闭骨架闪烁、状态点闪烁、过渡动画和轮播缩放。
- 切换页面时回到顶部（`main.tsx` 的 `ScrollToTop`）。
- 安全区：顶部留 `env(safe-area-inset-top)`，底部的导航和操作栏加 `env(safe-area-inset-bottom)`；`index.html` 已设置 `viewport-fit=cover`。
- 宽度：`#root` 最大 560px 并居中。≤340px 宽的屏幕缩小大标题；≤620px 高的屏幕缩小首页播放按钮和流程示意图。
- 横向滚动区隐藏滚动条，滚到尽头不带动页面（`overscroll-behavior-x: contain`）。
- 可访问性：只有图标的按钮写 `aria-label`；当前页签 `aria-current="page"`，当前步骤 `aria-current="step"`；选择块用 `role="radio"` / `role="checkbox"` + `aria-checked`；进度条用 `role="progressbar"`；键盘聚焦显示 2px 黑色外框。

## 11. 文案与测试

- 标题用口语化短句；说明只写真实的产品能力，不写销量、效果之类的承诺（AGENTS 约束 12）。
- 端到端测试用按钮名“开始”定位新建对话框的确认按钮，首页其他按钮的文案不要包含“开始”。
- 测试依赖的 `data-testid` 和文案（如“口播：…”“要生成的镜头（n 个”“当前版本 vN”“vN · 备注”“480p 标清”）在改版时保留；分享页上“AI生成”只能出现一次。
- 改完界面运行 `npm run e2e -w @ai-creative/h5`，截图在 `apps/h5/e2e/screenshots/`。
