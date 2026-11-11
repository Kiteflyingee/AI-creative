import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
  Module,
  PayloadTooLargeException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import type { Response } from 'express';
import { CreativeController } from './api/creative.controller';
import { OutputsController } from './api/outputs.controller';
import { ProjectsController } from './api/projects.controller';
import { AssetsService } from './assets/assets.service';
import { AuthGuard, AuthModule } from './auth/auth';
import { ChatService } from './chat/chat.service';
import { RemotionComposer } from './compose/remotion.composer';
import { getEnv } from './config/env';
import { StoryboardService } from './creative/storyboard.service';
import { StorylinesService } from './creative/storylines.service';
import { GenerationService } from './generation/generation.service';
import { OutputsService } from './generation/outputs.service';
import { PrismaModule } from './prisma/prisma.module';
import { ProductsService } from './products/products.service';
import { ProjectsService } from './projects/projects.service';
import { SeedreamProvider } from './providers/image/seedream';
import { LlmService } from './providers/llm/llm.service';
import { OpenAiCompatibleLlm } from './providers/llm/openai-compatible';
import { selectedImageModel, selectedVideoModel } from './providers/registry';
import { COMPOSER, IMAGE_PROVIDER, LLM_PROVIDER, VIDEO_PROVIDER } from './providers/types';
import { SeedanceProvider } from './providers/video/seedance';
import { BullJobQueue } from './queue/bullmq.queue';
import { InlineJobQueue } from './queue/inline.queue';
import { JOB_QUEUE } from './queue/job-queue';
import { StorageService } from './storage/storage.service';

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof PayloadTooLargeException) {
      res.status(413).json({ code: 'TOO_LARGE', message: '文件太大，图片请小于 30MB' });
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === 'object' && body && 'code' in body) {
        res.status(status).json(body);
      } else {
        const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? exception.message);
        res.status(status).json({ code: `HTTP_${status}`, message: Array.isArray(message) ? message.join('；') : String(message) });
      }
      return;
    }
    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(500).json({ code: 'INTERNAL', message: '服务器出错了，请稍后重试' });
  }
}

function createLlm() {
  const env = getEnv();
  return env.LLM_PROVIDER === 'ark'
    ? new OpenAiCompatibleLlm({ provider: 'ark-deepseek', baseUrl: env.ARK_BASE_URL, apiKey: env.ARK_API_KEY, modelId: env.ARK_LLM_MODEL })
    : new OpenAiCompatibleLlm({ provider: 'deepseek', baseUrl: env.DEEPSEEK_BASE_URL, apiKey: env.DEEPSEEK_API_KEY, modelId: env.DEEPSEEK_MODEL });
}

/** 按能力登记表中的 provider 选择适配器；新增模型时在这里登记 */
function createVideoProvider() {
  const cap = selectedVideoModel();
  switch (cap.provider) {
    case 'volcengine-ark':
      return new SeedanceProvider(cap);
    default:
      throw new Error(`视频模型 ${cap.key} 还没有实现适配器`);
  }
}

function createImageProvider() {
  const cap = selectedImageModel();
  switch (cap.provider) {
    case 'volcengine-ark':
      return new SeedreamProvider(cap);
    default:
      throw new Error(`图片模型 ${cap.key} 还没有实现适配器`);
  }
}

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ProjectsController, CreativeController, OutputsController],
  providers: [
    StorageService,
    ProjectsService,
    AssetsService,
    ProductsService,
    StorylinesService,
    StoryboardService,
    ChatService,
    GenerationService,
    OutputsService,
    LlmService,
    { provide: LLM_PROVIDER, useFactory: createLlm },
    { provide: VIDEO_PROVIDER, useFactory: createVideoProvider },
    { provide: IMAGE_PROVIDER, useFactory: createImageProvider },
    { provide: COMPOSER, useFactory: () => new RemotionComposer() },
    { provide: JOB_QUEUE, useFactory: () => (getEnv().JOB_QUEUE_MODE === 'inline' ? new InlineJobQueue() : new BullJobQueue()) },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
