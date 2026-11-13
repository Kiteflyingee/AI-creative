BEGIN;
ALTER TABLE "Project" ADD COLUMN "targetDurationSec" INTEGER NOT NULL DEFAULT 15;

-- 老项目沿用既有故事板/故事线的时长，不把已创作的 30/60 秒项目改成 15 秒。
UPDATE "Project" p SET "targetDurationSec" = COALESCE(
  (SELECT (b.spec->>'durationSec')::integer FROM "Storyboard" b
   WHERE b."projectId" = p.id AND b.spec->>'durationSec' IN ('15', '30', '60')
   ORDER BY b.version DESC LIMIT 1),
  (SELECT (s.content->>'durationSec')::integer FROM "Storyline" s
   WHERE s."projectId" = p.id AND s.content->>'durationSec' IN ('15', '30', '60')
   ORDER BY s.selected DESC, s.batch DESC, s.position ASC LIMIT 1),
  15
);
ALTER TABLE "Project" ADD CONSTRAINT "Project_targetDurationSec_check" CHECK ("targetDurationSec" IN (15, 30, 60));
COMMIT;
