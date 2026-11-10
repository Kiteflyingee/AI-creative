/**
 * 内置营销结构（CreativePattern）：只描述营销目的和镜头作用的顺序，不包含任何具体视频的台词或画面。
 * 生成故事线时作为参考，帮助模型给出节奏合理、彼此不同的方案。
 */
export interface CreativePattern {
  id: string;
  name: string;
  fitTypes: string[];
  beats: Array<{ intent: string; share: number; goal: string }>;
}

export const CREATIVE_PATTERNS: CreativePattern[] = [
  {
    id: 'pain_solution',
    name: '痛点切入—解决方案—效果展示—引导',
    fitTypes: ['product_share', 'host_talk'],
    beats: [
      { intent: '开场钩子', share: 0.2, goal: '前 3 秒提出目标人群熟悉的真实困扰' },
      { intent: '商品登场', share: 0.2, goal: '商品出现，说明它解决什么问题' },
      { intent: '卖点展示', share: 0.4, goal: '逐个展示可以拍出来的卖点' },
      { intent: '行动引导', share: 0.2, goal: '商品定格，引导了解或下单' },
    ],
  },
  {
    id: 'unboxing',
    name: '开箱—细节—上手体验—引导',
    fitTypes: ['product_share'],
    beats: [
      { intent: '开场钩子', share: 0.15, goal: '包装或商品局部特写制造好奇' },
      { intent: '细节展示', share: 0.35, goal: '材质、结构、做工的特写' },
      { intent: '上手体验', share: 0.35, goal: '真实使用场景中的动作' },
      { intent: '行动引导', share: 0.15, goal: '全貌展示与引导' },
    ],
  },
  {
    id: 'before_after',
    name: '对比反转—揭晓商品—卖点—引导',
    fitTypes: ['drama', 'product_share'],
    beats: [
      { intent: '冲突开场', share: 0.25, goal: '人物遇到问题，情绪明显' },
      { intent: '反转揭晓', share: 0.25, goal: '用上商品后情况改变' },
      { intent: '卖点展示', share: 0.3, goal: '解释为什么有效' },
      { intent: '行动引导', share: 0.2, goal: '人物推荐，商品定格' },
    ],
  },
  {
    id: 'lifestyle',
    name: '生活场景种草',
    fitTypes: ['drama', 'brand_film'],
    beats: [
      { intent: '氛围开场', share: 0.25, goal: '有代入感的生活场景' },
      { intent: '自然出现', share: 0.25, goal: '商品自然融入场景' },
      { intent: '使用片段', share: 0.3, goal: '人物使用商品的舒适瞬间' },
      { intent: '定格收尾', share: 0.2, goal: '商品与场景同框定格' },
    ],
  },
  {
    id: 'host_points',
    name: '主播口播逐条讲卖点',
    fitTypes: ['host_talk'],
    beats: [
      { intent: '开场钩子', share: 0.2, goal: '主播举起商品，一句话抓住注意' },
      { intent: '卖点一', share: 0.25, goal: '边说边展示第一个卖点' },
      { intent: '卖点二', share: 0.25, goal: '边说边展示第二个卖点' },
      { intent: '行动引导', share: 0.3, goal: '总结并引导下单' },
    ],
  },
  {
    id: 'brand_film',
    name: '质感广告：运镜与氛围',
    fitTypes: ['brand_film'],
    beats: [
      { intent: '质感开场', share: 0.3, goal: '电影感运镜，光影突出商品轮廓' },
      { intent: '细节特写', share: 0.4, goal: '材质、纹理、结构的微距特写' },
      { intent: '定格收尾', share: 0.3, goal: '商品全貌定格，留出品牌感' },
    ],
  },
];
