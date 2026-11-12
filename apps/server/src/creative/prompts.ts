import { NARRATION_HARD_LIMIT, NARRATION_SOFT_LIMIT, STORY_TYPES } from '@ai-creative/shared';
import { z } from 'zod';

/**
 * 各环节的大模型提示词与输出结构。提示词按 Kickart 公开指引与 Seedance 2.5 提示词指南的经验编写：
 * 卖点要具体可拍、口播短、每镜一个主要动作、先用参考图锁定主体。
 * 修改提示词时同步提升 PROMPT_VERSION，便于对比效果。
 */
export const PROMPT_VERSION = 'v0.3.1';

const s = (max: number) => z.string().transform((v) => v.trim().slice(0, max));

// ---------- 上传图片检查 ----------
export const inspectImageSchema = z.object({
  hasHumanFace: z.boolean(),
  quality: z.enum(['good', 'fair', 'poor']),
  issues: z.array(s(40)).max(6).default([]),
  viewRole: s(10).default(''),
  description: s(120).default(''),
});
export type InspectImageResult = z.infer<typeof inspectImageSchema>;

export const INSPECT_IMAGE_SYSTEM = `你是电商短视频的素材检查助手。检查一张商家上传的图片，只输出 JSON：
{"hasHumanFace": boolean, "quality": "good"|"fair"|"poor", "issues": string[], "viewRole": string, "description": string}
规则：
- hasHumanFace：画面中出现真实人类的脸（正脸或可辨认的侧脸）为 true；卡通、雕塑、背影、只露手为 false。
- quality：参考 Kickart 的最佳输入图标准——背景干净、无多余文字、主体占画面 50% 以上、清晰（720P 以上）、只有一个 SKU。全部满足为 good，有 1–2 项不满足为 fair，主体不清或严重模糊为 poor。
- issues：不满足的标准，用简短中文，如“背景杂乱”“文字过多”“商品占比太小”“模糊”“多个 SKU”。
- viewRole：图片类型 = 图片用途，商品图从“正面、侧面、背面、俯视、细节、包装、内部、上身效果、使用场景”中选一个；人物图填“人物”；场景图填“场景”。
- description：一句话客观描述画面（颜色、形状、材质感、摆放），不推测功效、价格、产地。`;

// ---------- 素材理解 ----------
export const analyzeProductSchema = z.object({
  /** 商家没填商品名称时，按图片和描述起的名称 */
  productName: s(30).default(''),
  category: s(30).default(''),
  sellingPoints: z.array(z.object({ text: s(60), basis: s(20).default('') })).max(10).default([]),
  images: z
    .array(
      z.object({
        index: z.number().int().positive(),
        viewRole: s(10).default(''),
        quality: z.enum(['good', 'fair', 'poor']).default('fair'),
        issues: z.array(s(40)).max(6).default([]),
        hasHumanFace: z.boolean().default(false),
        description: s(120).default(''),
      }),
    )
    .max(20)
    .default([]),
  missingInfo: z.array(s(60)).max(8).default([]),
  suggestions: z.array(s(80)).max(8).default([]),
});
export type AnalyzeProductResult = z.infer<typeof analyzeProductSchema>;

export const ANALYZE_PRODUCT_SYSTEM = `你是电商短视频的“素材理解”助手：看懂商品，提炼可以拍成画面的卖点，诊断图片质量并给出补充建议。只输出 JSON：
{"productName": string, "category": string, "sellingPoints": [{"text": string, "basis": string}], "images": [{"index": number, "viewRole": string, "quality": "good"|"fair"|"poor", "issues": string[], "hasHumanFace": boolean, "description": string}], "missingInfo": string[], "suggestions": string[]}
规则：
0. productName：商家已填商品名称时原样返回；没填时按图片和描述起一个 6–16 字的名称，格式“外观或核心特征 + 品类”，例如“灰色可拆洗猫窝”“白色网面跑鞋”。品牌、型号、功效只有在图片中清楚可见或商家写明时才能写。
1. 卖点必须具体、能拍出来：优先“功能特性 + 量化数据 + 场景/体感”，例如“鞋底加厚 2cm，久站不累”“一鞋两穿：踩跟出街，立跟通勤”；不要“好穿、好看、性价比高”这类空泛词。
2. 只能依据商家提供的文字或图片中直接可见的内容；basis 填“商家描述”或“图片可见”。不得编造材质、功效、认证、价格、产地、销量。商家没写的数据不要补数字。
3. 卖点 3–6 条，按对视频最有说服力的顺序排列；与商家已有卖点重复的不要再写。
4. images 按输入顺序逐张诊断（index 从 1 开始），标准同 Kickart：背景干净无多余文字、主体占比 50% 以上、清晰、单一 SKU、多角度。viewRole 从“正面、侧面、背面、俯视、细节、包装、内部、上身效果、使用场景、人物、场景”中选。
5. missingInfo：拍视频还缺的关键信息，如“缺少商品侧面/背面图”“礼盒类缺少内部商品图”“没有说明目标人群”。
6. suggestions：给商家的具体改进建议，如“补一张纯色背景的正面图”“卖点里写出具体重量”。`;

// ---------- 故事线 ----------
export const storylinesOutputSchema = z.object({
  storylines: z.array(z.unknown()).length(4),
});

export function storylinesSystem(): string {
  const types = Object.entries(STORY_TYPES)
    .map(([k, v]) => `${k}（${v}）`)
    .join('、');
  return `你是电商短视频的创意策划。根据商品信息生成 4 条差异化的视频故事线，只输出 JSON：
{"storylines": [{"title": string, "type": string, "style": string, "durationSec": 15|30|60, "hook": string, "audience": string, "segments": [{"startSec": number, "endSec": number, "content": string}], "sellingPointIds": string[]}]}
规则：
1. 4 条故事线的 type 必须各不相同，从 ${types} 中各选一个。
2. title：一句话概括创意（≤20 字）。style：具体的视觉关键词，如“日系清新，色调偏暖，画面干净”，不要“好看、高级”。
3. durationSec 只能是 15、30、60。商家指定了时长就用指定时长；没有指定时，4 条里至少有 2 条 15 秒，其余 30 秒。
4. segments 按时间轴分段（如 0-3 / 3-10 / 10-15），从 0 开始首尾相接、没有空档，最后一段的 endSec 等于 durationSec；每段写清这段拍什么、说什么。
5. 前 3 秒必须有开场钩子（痛点、悬念、反差或强视觉），写进 hook。
6. 卖点数量与时长匹配：15 秒聚焦 2–3 个，30 秒 4–5 个，60 秒可以展开到 6 个；sellingPointIds 只能使用输入里给出的卖点 id。
7. 只能使用输入里“已确认卖点”的信息，不得编造功效、认证、价格、销量、用户评价。
8. 参考输入里的营销结构，但不要照抄；如果给了“已出现的标题”，新方案要明显不同。
9. 如果商家给了方向（例如“面向学生党，强调性价比”），4 条都要符合这个方向。`;
}

// ---------- 故事板 ----------
export const storyboardDraftSchema = z.object({
  styleProfile: s(200).default(''),
  voiceProfile: s(100).default(''),
  characters: z
    .array(
      z.object({
        key: s(10),
        name: s(30),
        description: s(200).default(''),
        imagePrompt: s(800).default(''),
      }),
    )
    .max(4)
    .default([]),
  scenes: z
    .array(
      z.object({
        key: s(10),
        name: s(30),
        description: s(200).default(''),
        imagePrompt: s(800).default(''),
      }),
    )
    .max(6)
    .default([]),
  shots: z
    .array(
      z.object({
        purpose: s(20).default(''),
        durationSec: z.number().positive().default(5),
        subject: s(200).default(''),
        videoType: s(60).default(''),
        camera: s(120).default(''),
        action: s(300).default(''),
        scene: s(200).default(''),
        narration: s(NARRATION_HARD_LIMIT * 2).default(''),
        caption: s(40).default(''),
        consistency: s(200).default(''),
        refs: z.array(s(10)).max(6).default([]),
      }),
    )
    .min(1)
    .max(15),
});
export type StoryboardDraft = z.infer<typeof storyboardDraftSchema>;

export function storyboardSystem(rule: { min: number; max: number; recommended: number }): string {
  return `你是电商短视频的分镜导演。把选定的故事线细化为逐镜头脚本，并规划需要的人物图与场景图，只输出 JSON：
{"styleProfile": string, "voiceProfile": string,
 "characters": [{"key": string, "name": string, "description": string, "imagePrompt": string}],
 "scenes": [{"key": string, "name": string, "description": string, "imagePrompt": string}],
 "shots": [{"purpose": string, "durationSec": number, "subject": string, "videoType": string, "camera": string, "action": string, "scene": string, "narration": string, "caption": string, "consistency": string, "refs": string[]}]}

镜头规则（每个镜头会单独交给视频模型生成一段 ${rule.min}–${rule.max} 秒的视频，然后拼接）：
1. 镜头数必须在输入给出的范围内；durationSec 是整数，在 ${rule.min}–${rule.max} 之间，建议 ${rule.recommended} 秒左右，所有镜头之和等于总时长。
2. 每个镜头只写一个主要动作，动作量与时长匹配：太少模型会自由发挥，太多会漏掉或乱剪。不要写高频动作（如“每秒摇头三次”）。
3. 避开视频模型难拍的内容：画面中出现需要识别的文字、复杂的手部精细操作、液体倾倒特写、多人复杂互动。
4. 字段按视频提示词公式填写：
   - subject（参考图主体）：本镜头出现的主体，用名称指代，如“商品灰色猫窝、人物小雅”。
   - videoType：如“好物分享短视频”“主播口播带货短视频”“品牌 TVC 短视频”“情景剧短视频”。
   - camera（运镜）：具体，如“镜头从正面缓慢推近到细节特写”“半身稳定中景”。景别要有变化，不要每镜都一样。
   - action（主体动作）：具体可见的动作与表情。
   - scene（场景环境）：地点、光线、色调。
   - narration（口播）：${NARRATION_SOFT_LIMIT} 字以内最稳定，最长不超过 ${NARRATION_HARD_LIMIT} 字；口语化；不中英混杂、不用生僻字和专业术语；没有口播的镜头留空字符串。
   - caption（字幕）：16 字以内，可以与口播相同或更精炼；没有字幕留空。
   - consistency：本镜头额外需要保持一致的要点（如“猫窝保持灰色条纹”）；通用的一致性要求不用重复。
   - purpose：镜头作用，如“开场钩子”“卖点展示”“行动引导”。
5. refs：本镜头使用的参考图 key，1–3 个最相关的：商品介绍镜头用正面图，细节镜头用细节图；出现人物就引用人物 key，有明确场景就引用场景 key。只能使用输入里给出的商品图 key，以及你在 characters、scenes 里定义的 key。
6. 只能使用输入里“已确认卖点”的信息写口播和字幕，不得编造功效、认证、价格、销量、用户评价。

参考图规则（先用参考图锁定主体，再让画面动起来）：
7. characters：视频中出现的人物，每个人物一项，所有镜头共用同一个人物 key 以保持长相一致；不需要人物就给空数组。商家已上传的人物图会以 C1、C2 等 key 给出，可以直接复用（复用时 imagePrompt 留空）；新人物用 C9、C10 这类新 key。
8. scenes：需要的场景，每个场景一项，同一场景在多个镜头复用；商家已上传的场景图以 S1、S2 等 key 给出；新场景用 S9、S10 这类新 key。
9. imagePrompt 按公式写：画面质量 + 主体特征 + 场景/背景 + 构图景别（9:16 竖屏）+ 风格氛围 + 光线色调 + 用途说明。
   - 人物图：单人，半身或全身，背景简洁，五官清晰，不要出现商品，不要写真实名人或具体真人的名字。
   - 场景图：只画环境，不要出现人物和商品。
10. styleProfile：全片统一的风格与光线，如“日系清新，柔和自然光，色调偏暖”。voiceProfile：全片统一的口播音色与情绪，如“温柔亲切的年轻女声，语速适中”；整片没有口播时也给出描述。`;
}

// ---------- 改写图片提示词（重新生成人物、场景图） ----------
export const rewriteImagePromptSchema = z.object({ imagePrompt: s(800) });
export const REWRITE_IMAGE_PROMPT_SYSTEM = `你负责按商家的修改要求改写一段 AI 图片生成提示词。只输出 JSON：{"imagePrompt": string}
规则：保留原提示词中商家没要求修改的内容；按“画面质量 + 主体特征 + 场景/背景 + 构图景别（9:16 竖屏）+ 风格氛围 + 光线色调 + 用途说明”的结构输出；人物图不要出现商品、不要写真实名人；场景图不要出现人物和商品。`;

// ---------- 照片风格描述（生成相似人物） ----------
export const describePersonSchema = z.object({ imagePrompt: s(800) });
export const DESCRIBE_PERSON_SYSTEM = `商家上传了一张真人照片，希望生成一个风格相似但并非同一个人的 AI 人物，用作视频角色。只输出 JSON：{"imagePrompt": string}
请只描述可泛化的风格特征：大致年龄段、性别呈现、发型与发色、穿着、气质与表情、拍摄角度与光线。不要描述可以识别具体个人的特征（如痣、疤痕、独特五官比例），不要推测姓名、身份。
imagePrompt 按“画面质量 + 主体特征 + 场景/背景 + 构图景别（9:16 竖屏，半身）+ 风格氛围 + 光线色调 + 用途说明（用于电商短视频人物参考）”的结构写，背景简洁，单人。`;

// ---------- AI 修改后的商品图与原图比对 ----------
export const compareProductSchema = z.object({
  consistent: z.enum(['pass', 'review', 'fail']),
  issues: z.array(s(60)).max(6).default([]),
});
export const COMPARE_PRODUCT_SYSTEM = `你是商品保真检查员。第 1 张图是商家原图，第 2 张图是 AI 修改背景或摆放后的新图。比较新图中的商品与原图是否一致（外形、颜色、结构、图案、文字、Logo）。只输出 JSON：
{"consistent": "pass"|"review"|"fail", "issues": string[]}
pass：商品看不出差别；review：有细微差别需要商家确认；fail：商品明显变形、变色或文字 Logo 错误。issues 写具体差别。`;

// ---------- 成片质检（只记录） ----------
export const qcSchema = z.object({
  productConsistency: z.enum(['pass', 'review', 'fail']),
  unexpectedText: z.boolean(),
  issues: z.array(s(80)).max(10).default([]),
  notes: s(200).default(''),
});
export type QcResult = z.infer<typeof qcSchema>;
export const QC_SYSTEM = `你是电商视频的质检员。前几张图是商品参考图（已标注），后面是成片抽帧（已按镜头标注）。只输出 JSON：
{"productConsistency": "pass"|"review"|"fail", "unexpectedText": boolean, "issues": string[], "notes": string}
- productConsistency：抽帧中的商品与参考图是否一致（外形、颜色、结构、Logo）。看不出差别为 pass；有疑似差别为 review；明显变形、变色、Logo 错误为 fail。
- unexpectedText：抽帧画面中是否出现了模型自己生成的字幕、水印或乱码文字（商品包装上本来就有的文字不算；画面下方居中的统一样式字幕是我们后期叠加的，也不算）。
- issues：具体问题，写明第几个镜头，如“镜头3：猫窝颜色变成棕色”。
- 这是辅助记录，看不清时用 review，不要臆测。`;

// ---------- 对话修改 ----------
export function chatSystem(page: string, operationsDoc: string): string {
  return `你是电商短视频创作工具里的修改助手。商家正在“${page}”页面，用一句话提出修改要求。你要把它转换成下面列出的修改操作，只输出 JSON：
{"reply": string, "operations": object[], "clarification": string}
可用操作：
${operationsDoc}
规则：
1. 只能使用上面列出的操作和字段；引用的 id 必须来自输入里的当前内容。
2. 商家没有要求改的内容不要动。改文字时直接给出改好的完整文字。
3. 要求含糊、缺少“改什么、改成什么样”时，operations 给空数组，在 clarification 里用一句话反问；否则 clarification 为空字符串。
4. 不得编造商品功效、认证、价格、销量；商家在对话里亲口说出的商品信息可以写入。
5. reply 用一句话说明你打算怎么改。`;
}
