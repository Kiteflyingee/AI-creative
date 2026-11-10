import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CAPTION_MAX } from '@ai-creative/shared';
import { z } from 'zod';
import { CurrentUser, Public, type AuthUser } from '../auth/auth';
import { ZodPipe } from '../common/zod.pipe';
import { GenerationService } from '../generation/generation.service';
import { OutputsService } from '../generation/outputs.service';

const captionsSchema = z.object({
  captions: z.array(z.object({ shotId: z.string(), text: z.string().trim().max(CAPTION_MAX) })).min(1).max(15),
});
const selectClipSchema = z.object({ clipId: z.string().min(1) });

@Controller('app/v1')
export class OutputsController {
  constructor(
    private readonly generation: GenerationService,
    private readonly outputs: OutputsService,
  ) {}

  @Get('jobs/:jobId')
  async job(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    await this.generation.requireJob(user.id, jobId);
    return this.generation.jobView(jobId);
  }

  @Post('jobs/:jobId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('jobId') jobId: string) {
    return this.generation.cancel(user.id, jobId);
  }

  @Post('projects/:id/captions')
  captions(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(captionsSchema)) body: z.infer<typeof captionsSchema>) {
    return this.outputs.updateCaptions(user.id, id, body.captions);
  }

  @Post('projects/:id/shots/:shotId/select-clip')
  selectClip(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('shotId') shotId: string,
    @Body(new ZodPipe(selectClipSchema)) body: z.infer<typeof selectClipSchema>,
  ) {
    return this.outputs.selectClip(user.id, id, shotId, body.clipId);
  }

  @Post('outputs/:outputId/make-current')
  makeCurrent(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.makeCurrent(user.id, outputId);
  }

  @Post('outputs/:outputId/retry-compose')
  retryCompose(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.retryCompose(user.id, outputId);
  }

  @Get('outputs/:outputId/download-url')
  download(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.downloadUrl(user.id, outputId);
  }

  @Get('outputs/:outputId/qc')
  qc(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.qcRecords(user.id, outputId);
  }

  @Post('outputs/:outputId/share')
  share(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.share(user.id, outputId);
  }

  @Delete('outputs/:outputId/share')
  unshare(@CurrentUser() user: AuthUser, @Param('outputId') outputId: string) {
    return this.outputs.unshare(user.id, outputId);
  }

  @Public()
  @Get('share/:token')
  publicShare(@Param('token') token: string) {
    return this.outputs.publicShare(token);
  }
}
