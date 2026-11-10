import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({ datasources: { db: { url: getEnv().DATABASE_URL } } });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
