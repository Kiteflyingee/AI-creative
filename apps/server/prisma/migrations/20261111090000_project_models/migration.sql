-- 项目记录自己的模型组合（D-46）。已有项目都是在 Seedance 2.5 + Seedream 5.0 pro 下创建的
ALTER TABLE "Project" ADD COLUMN "videoModel" TEXT NOT NULL DEFAULT 'seedance-2.5';
ALTER TABLE "Project" ADD COLUMN "imageModel" TEXT NOT NULL DEFAULT 'seedream-5.0-pro';
ALTER TABLE "Project" ALTER COLUMN "videoModel" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "imageModel" DROP DEFAULT;
