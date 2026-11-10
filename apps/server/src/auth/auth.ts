import {
  Body,
  CanActivate,
  Controller,
  createParamDecorator,
  ExecutionContext,
  Get,
  HttpStatus,
  Injectable,
  Module,
  Post,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { z } from 'zod';
import { getEnv } from '../config/env';
import { AppError } from '../common/errors';
import { randomToken, sha256 } from '../common/util';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  id: string;
  name: string;
}

const IS_PUBLIC = 'isPublic';
/** 不需要登录的接口（如分享页） */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  if (!req.user) throw new AppError('UNAUTHORIZED', '请先登录', HttpStatus.UNAUTHORIZED);
  return req.user;
});

const SESSION_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  /** 开发用简易登录：按昵称找到或创建用户（D-15） */
  async devLogin(name: string) {
    if (!getEnv().DEV_LOGIN_ENABLED) {
      throw new AppError('DEV_LOGIN_DISABLED', '简易登录未开启', HttpStatus.FORBIDDEN);
    }
    const user =
      (await this.prisma.user.findFirst({ where: { name } })) ?? (await this.prisma.user.create({ data: { name } }));
    const token = randomToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
      },
    });
    return { token, user: { id: user.id, name: user.name } };
  }

  async resolve(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date()) return null;
    return { id: session.user.id, name: session.user.name };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  return null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = bearer(req);
    const user = token ? await this.auth.resolve(token) : null;
    if (!user) throw new AppError('UNAUTHORIZED', '请先登录', HttpStatus.UNAUTHORIZED);
    req.user = user;
    return true;
  }
}

const devLoginSchema = z.object({ name: z.string().trim().min(1).max(30) });

@Controller('app/v1')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('auth/dev-login')
  devLogin(@Body(new ZodPipe(devLoginSchema)) body: z.infer<typeof devLoginSchema>) {
    return this.auth.devLogin(body.name);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
