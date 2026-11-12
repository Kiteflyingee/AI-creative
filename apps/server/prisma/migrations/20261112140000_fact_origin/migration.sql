-- 卖点记录谁写的和 AI 的依据（D-56）。已有的未确认卖点都是 AI 建议
CREATE TYPE "FactOrigin" AS ENUM ('AI', 'MERCHANT');
ALTER TABLE "ProductFact" ADD COLUMN "origin" "FactOrigin" NOT NULL DEFAULT 'MERCHANT';
ALTER TABLE "ProductFact" ADD COLUMN "basis" TEXT NOT NULL DEFAULT '';
UPDATE "ProductFact" SET "origin" = 'AI' WHERE "source" = 'AI_SUGGESTED';
