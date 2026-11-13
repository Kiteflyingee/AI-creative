import { Body, Controller, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RESOLUTIONS, storyDurationSchema } from '@ai-creative/shared';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { CHAT_PAGES, ChatService } from '../chat/chat.service';
import { ZodPipe } from '../common/zod.pipe';
import { StoryboardService } from '../creative/storyboard.service';
import { StorylinesService } from '../creative/storylines.service';
import { GenerationService } from '../generation/generation.service';
import { streamCreative } from './creative-stream';

const directionSchema = z.object({ direction: z.string().trim().max(200).default(''), durationSec: storyDurationSchema.optional() });
const storylinePatchSchema = z.object({
  title: z.string().trim().max(40).optional(),
  style: z.string().trim().max(60).optional(),
  hook: z.string().trim().max(80).optional(),
  durationSec: storyDurationSchema.optional(),
  segments: z
    .array(z.object({ startSec: z.number().int().min(0), endSec: z.number().int().positive(), content: z.string().trim().min(1).max(200) }))
    .optional(),
});
const storyboardPatchSchema = z.object({ expectedVersion: z.number().int().positive(), spec: z.unknown() });
const durationSchema = z.object({ durationSec: storyDurationSchema, expectedVersion: z.number().int().positive().optional() });
const regenerateRefSchema = z.object({ instruction: z.string().trim().max(200).default('') });
const replaceRefSchema = z.object({ assetId: z.string().min(1) });
const chatSchema = z.object({ page: z.enum(CHAT_PAGES), message: z.string().trim().min(1).max(500) });
const generateSchema = z.object({
  resolution: z.enum(RESOLUTIONS),
  shotIds: z.array(z.string()).max(15).optional(),
  idempotencyKey: z.string().min(8).max(100),
  storyboardVersion: z.number().int().positive().optional(),
});

@Controller('app/v1')
export class CreativeController {
  constructor(
    private readonly storylines: StorylinesService,
    private readonly storyboards: StoryboardService,
    private readonly chat: ChatService,
    private readonly generation: GenerationService,
  ) {}

  @Post('projects/:id/storylines')
  generateStorylines(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(directionSchema)) body: z.infer<typeof directionSchema>) {
    return this.storylines.generate(user.id, id, body.direction, body.durationSec);
  }

  @Post('projects/:id/storylines/stream')
  streamStorylines(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(directionSchema)) body: z.infer<typeof directionSchema>, @Res() res: Response) {
    return streamCreative(res, (report) => this.storylines.generate(user.id, id, body.direction, body.durationSec, report));
  }

  @Patch('storylines/:storylineId')
  updateStoryline(
    @CurrentUser() user: AuthUser,
    @Param('storylineId') storylineId: string,
    @Body(new ZodPipe(storylinePatchSchema)) body: z.infer<typeof storylinePatchSchema>,
  ) {
    return this.storylines.update(user.id, storylineId, body);
  }

  @Post('storylines/:storylineId/select')
  selectStoryline(@CurrentUser() user: AuthUser, @Param('storylineId') storylineId: string) {
    return this.storyboards.generateFromStoryline(user.id, storylineId);
  }

  @Post('storylines/:storylineId/select/stream')
  streamStoryboard(@CurrentUser() user: AuthUser, @Param('storylineId') storylineId: string, @Res() res: Response) {
    return streamCreative(res, (report) => this.storyboards.generateFromStoryline(user.id, storylineId, report));
  }

  @Patch('projects/:id/storyboard')
  saveStoryboard(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(storyboardPatchSchema)) body: z.infer<typeof storyboardPatchSchema>) {
    return this.storyboards.saveVersion(user.id, id, body.spec, { expectedVersion: body.expectedVersion, note: '手动编辑' });
  }

  @Post('projects/:id/storyboard/duration')
  setDuration(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(durationSchema)) body: z.infer<typeof durationSchema>) {
    return this.storyboards.setTotalDuration(user.id, id, body.durationSec, body.expectedVersion);
  }

  @Post('projects/:id/references/:refId/regenerate')
  regenerateReference(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Body(new ZodPipe(regenerateRefSchema)) body: z.infer<typeof regenerateRefSchema>,
  ) {
    return this.storyboards.regenerateReference(user.id, id, refId, body.instruction);
  }

  @Post('projects/:id/references/:refId/replace')
  replaceReference(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('refId') refId: string,
    @Body(new ZodPipe(replaceRefSchema)) body: z.infer<typeof replaceRefSchema>,
  ) {
    return this.storyboards.replaceReferenceImage(user.id, id, refId, body.assetId === 'original' ? 'original' : body.assetId);
  }

  @Post('projects/:id/readiness')
  async readiness(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(z.object({ shotIds: z.array(z.string()).optional() }))) body: { shotIds?: string[] }) {
    const { spec, row } = await this.storyboards.requireLatest(user.id, id);
    const shotIds = body.shotIds?.length ? body.shotIds : spec.shots.map((s) => s.shotId);
    return { version: row.version, problems: await this.storyboards.checkReadiness(user.id, spec, shotIds, row.videoModel) };
  }

  @Post('projects/:id/chat')
  proposeChat(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(chatSchema)) body: z.infer<typeof chatSchema>) {
    return this.chat.propose(user.id, id, body.page, body.message);
  }

  @Post('chat-edits/:editId/apply')
  applyChat(@CurrentUser() user: AuthUser, @Param('editId') editId: string) {
    return this.chat.apply(user.id, editId);
  }

  @Post('chat-edits/:editId/discard')
  discardChat(@CurrentUser() user: AuthUser, @Param('editId') editId: string) {
    return this.chat.discard(user.id, editId);
  }

  @Post('projects/:id/generate')
  generate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(generateSchema)) body: z.infer<typeof generateSchema>) {
    return this.generation.create(user.id, id, body);
  }
}
