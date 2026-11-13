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
import { realProviderFactory } from './providers/factory';
import { LlmService } from './providers/llm/llm.service';
import { ModelHub } from './providers/model-hub';
import { createLlmAdapter } from './providers/llm/factory';
import { COMPOSER, LLM_PROVIDER, PROVIDER_FACTORY } from './providers/types';
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
    ModelHub,
    { provide: LLM_PROVIDER, useFactory: createLlmAdapter },
    { provide: PROVIDER_FACTORY, useValue: realProviderFactory },
    { provide: COMPOSER, useFactory: () => new RemotionComposer() },
    { provide: JOB_QUEUE, useFactory: () => (getEnv().JOB_QUEUE_MODE === 'inline' ? new InlineJobQueue() : new BullJobQueue()) },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
})
export class AppModule {}
