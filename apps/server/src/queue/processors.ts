import type { INestApplicationContext } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { GenerationService } from '../generation/generation.service';
import { OutputsService } from '../generation/outputs.service';
import type { ProcessorMap } from './bullmq.queue';

/** 后台任务名 → 处理函数（BullMQ 进程与测试共用） */
export function buildProcessors(app: INestApplicationContext): ProcessorMap {
  const generation = app.get(GenerationService);
  const outputs = app.get(OutputsService);
  const assets = app.get(AssetsService);
  return {
    tick: () => generation.tick(),
    transfer: (data, ctx) => generation.transfer(data.clipId, ctx),
    compose: (data, ctx) => outputs.compose(data.outputId, ctx),
    qc: (data) => outputs.qc(data.outputId),
    image: (data, ctx) => assets.processImage(data.assetId, ctx),
    inspect: (data, ctx) => assets.processInspect(data.assetId, ctx),
  };
}
