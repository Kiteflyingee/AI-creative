import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { AssetsService } from '../assets/assets.service';
import { CurrentUser, type AuthUser } from '../auth/auth';
import { ZodPipe } from '../common/zod.pipe';
import { ProductsService } from '../products/products.service';
import { ProjectsService } from '../projects/projects.service';

const createProjectSchema = z.object({ name: z.string().trim().max(60).default('') });
const productPatchSchema = z.object({
  name: z.string().trim().max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  targetAudience: z.string().trim().max(200).optional(),
});
const factSchema = z.object({ text: z.string().trim().min(1).max(80) });
const factPatchSchema = z.object({ text: z.string().trim().min(1).max(80).optional(), confirm: z.boolean().optional() });
const assetKindSchema = z.object({ kind: z.enum(['PRODUCT', 'CHARACTER', 'SCENE']) });
const assetPatchSchema = z.object({ label: z.string().trim().max(30) });
const faceSchema = z.object({
  resolution: z.enum(['VIRTUAL_PORTRAIT', 'AI_SIMILAR', 'EXCLUDED']),
  virtualPortraitId: z.string().optional(),
});

/** 上传大小上限与模型参考图上限一致（30MB） */
const MAX_UPLOAD = 30 * 1024 * 1024;

@Controller('app/v1')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly products: ProductsService,
    private readonly assets: AssetsService,
  ) {}

  @Post('projects')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(createProjectSchema)) body: z.infer<typeof createProjectSchema>) {
    return this.projects.create(user.id, body.name);
  }

  @Get('projects')
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.id);
  }

  @Get('projects/:id')
  view(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.projects.view(user.id, id);
  }

  @Patch('projects/:id/product')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(productPatchSchema)) body: z.infer<typeof productPatchSchema>,
  ) {
    return this.products.update(user.id, id, body);
  }

  @Post('projects/:id/facts')
  addFact(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(factSchema)) body: z.infer<typeof factSchema>) {
    return this.products.addFact(user.id, id, body.text);
  }

  @Patch('facts/:factId')
  updateFact(
    @CurrentUser() user: AuthUser,
    @Param('factId') factId: string,
    @Body(new ZodPipe(factPatchSchema)) body: z.infer<typeof factPatchSchema>,
  ) {
    return this.products.updateFact(user.id, factId, body);
  }

  @Delete('facts/:factId')
  removeFact(@CurrentUser() user: AuthUser, @Param('factId') factId: string) {
    return this.products.removeFact(user.id, factId);
  }

  @Post('projects/:id/analyze')
  analyze(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.analyze(user.id, id);
  }

  @Post('projects/:id/assets')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodPipe(assetKindSchema)) body: z.infer<typeof assetKindSchema>,
    @UploadedFile() file: { buffer: Buffer; size: number } | undefined,
  ) {
    return this.assets.upload(user.id, id, body.kind, file);
  }

  @Patch('assets/:assetId')
  updateAsset(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body(new ZodPipe(assetPatchSchema)) body: z.infer<typeof assetPatchSchema>,
  ) {
    return this.assets.updateLabel(user.id, assetId, body.label);
  }

  @Post('assets/:assetId/face')
  setFace(
    @CurrentUser() user: AuthUser,
    @Param('assetId') assetId: string,
    @Body(new ZodPipe(faceSchema)) body: z.infer<typeof faceSchema>,
  ) {
    return this.assets.setFaceResolution(user.id, assetId, body);
  }

  @Delete('assets/:assetId')
  removeAsset(@CurrentUser() user: AuthUser, @Param('assetId') assetId: string) {
    return this.assets.remove(user.id, assetId);
  }
}
