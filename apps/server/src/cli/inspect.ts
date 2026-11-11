/**
 * 命令行查看任务与质检记录（第一版不做运营后台，D-20）。
 *   npm run inspect                 最近 10 个生成任务
 *   npm run inspect -- <projectId>  某个项目的任务、镜头片段与质检记录
 */
import { PrismaClient } from '@prisma/client';
import { getEnv } from '../config/env';

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: getEnv().DATABASE_URL } } });
  const projectId = process.argv[2];
  try {
    const jobs = await prisma.generationJob.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: projectId ? 50 : 10,
      include: { clips: { orderBy: { queuedAt: 'asc' } }, project: { select: { title: true, videoModel: true, imageModel: true } } },
    });
    for (const job of jobs) {
      console.log(
        `\n任务 ${job.id} · ${job.project.title} · ${job.kind} · ${job.status} · ${job.resolution} · 模型 ${job.clips[0]?.modelKey ?? job.project.videoModel} / ${job.project.imageModel} · ${job.createdAt.toISOString()}`,
      );
      if (job.errorMessage) console.log(`  说明：${job.errorMessage}`);
      for (const c of job.clips) {
        const usage = c.usage ? JSON.stringify(c.usage) : '-';
        const secs = c.submittedAt && c.finishedAt ? `${Math.round((c.finishedAt.getTime() - c.submittedAt.getTime()) / 1000)}s` : '-';
        console.log(
          `  镜头 ${c.shotId} v${c.version} ${c.status} 请求 ${c.durationSec}s 实际 ${c.actualDurationSec?.toFixed(2) ?? '-'}s 耗时 ${secs} 任务 ${c.providerTaskId ?? '-'} 用量 ${usage}`,
        );
        if (c.errorMessage) console.log(`    错误：${c.errorCode} ${c.errorMessage}`);
      }
    }
    if (projectId) {
      const outputs = await prisma.output.findMany({ where: { projectId }, orderBy: { version: 'asc' }, include: { qcRecords: true } });
      for (const o of outputs) {
        console.log(`\n成片 v${o.version} ${o.status} ${o.durationSec?.toFixed(2) ?? '-'}s ${o.note}`);
        for (const q of o.qcRecords) console.log(`  质检 ${q.state}：${JSON.stringify(q.reasons)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
