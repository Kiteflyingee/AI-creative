-- CreateEnum
CREATE TYPE "FactSource" AS ENUM ('MERCHANT_CONFIRMED', 'AI_SUGGESTED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('PRODUCT', 'CHARACTER', 'SCENE');

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('UPLOAD', 'AI_GENERATED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('GENERATING', 'READY', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FaceStatus" AS ENUM ('UNKNOWN', 'NONE', 'DETECTED');

-- CreateEnum
CREATE TYPE "FaceResolution" AS ENUM ('NONE', 'VIRTUAL_PORTRAIT', 'AI_SIMILAR', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('FULL', 'RESHOOT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'GENERATING', 'COMPOSING', 'QC', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'TRANSFERRING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutputStatus" AS ENUM ('COMPOSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatEditStatus" AS ENUM ('PROPOSED', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "targetAudience" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "analysis" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductFact" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "source" "FactSource" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT,
    "projectId" TEXT,
    "kind" "AssetKind" NOT NULL,
    "origin" "AssetOrigin" NOT NULL,
    "status" "AssetStatus" NOT NULL,
    "objectKey" TEXT,
    "mime" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "viewRole" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "quality" JSONB,
    "face" "FaceStatus" NOT NULL DEFAULT 'UNKNOWN',
    "faceResolution" "FaceResolution" NOT NULL DEFAULT 'NONE',
    "virtualPortraitId" TEXT,
    "replacementAssetId" TEXT,
    "generation" JSONB,
    "prompt" TEXT,
    "sourceAssetId" TEXT,
    "providerModelId" TEXT,
    "providerUrl" TEXT,
    "providerUrlExpiresAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "comparison" JSONB,
    "rejectReason" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "currentOutputId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storyline" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "batch" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "direction" TEXT NOT NULL DEFAULT '',
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Storyline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storylineId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "spec" JSONB NOT NULL,
    "videoModel" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Storyboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "resolution" TEXT NOT NULL,
    "shotIds" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "baseOutputId" TEXT,
    "outputId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "GenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "storyboardId" TEXT NOT NULL,
    "shotId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "specHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "providerTaskId" TEXT,
    "status" "ClipStatus" NOT NULL,
    "rawStatus" TEXT,
    "usage" JSONB,
    "seed" BIGINT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "providerVideoUrl" TEXT,
    "rawObjectKey" TEXT,
    "objectKey" TEXT,
    "actualDurationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "submitAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "lastPolledAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Output" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "jobId" TEXT,
    "storyboardId" TEXT NOT NULL,
    "selection" JSONB NOT NULL,
    "captions" JSONB NOT NULL,
    "status" "OutputStatus" NOT NULL,
    "resolution" TEXT NOT NULL,
    "objectKey" TEXT,
    "coverKey" TEXT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "note" TEXT NOT NULL DEFAULT '',
    "shareToken" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Output_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QcRecord" (
    "id" TEXT NOT NULL,
    "outputId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "detail" JSONB NOT NULL,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QcRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEdit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reply" TEXT NOT NULL DEFAULT '',
    "operations" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "status" "ChatEditStatus" NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ChatEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Product_userId_createdAt_idx" ON "Product"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductFact_productId_idx" ON "ProductFact"("productId");

-- CreateIndex
CREATE INDEX "Asset_productId_idx" ON "Asset"("productId");

-- CreateIndex
CREATE INDEX "Asset_projectId_idx" ON "Asset"("projectId");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Storyline_projectId_batch_idx" ON "Storyline"("projectId", "batch");

-- CreateIndex
CREATE UNIQUE INDEX "Storyboard_projectId_version_key" ON "Storyboard"("projectId", "version");

-- CreateIndex
CREATE INDEX "GenerationJob_projectId_createdAt_idx" ON "GenerationJob"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationJob_userId_idempotencyKey_key" ON "GenerationJob"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "Clip_status_queuedAt_idx" ON "Clip"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "Clip_jobId_idx" ON "Clip"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "Clip_projectId_shotId_version_key" ON "Clip"("projectId", "shotId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Output_shareToken_key" ON "Output"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "Output_projectId_version_key" ON "Output"("projectId", "version");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFact" ADD CONSTRAINT "ProductFact_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyline" ADD CONSTRAINT "Storyline_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Storyboard" ADD CONSTRAINT "Storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationJob" ADD CONSTRAINT "GenerationJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "GenerationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Output" ADD CONSTRAINT "Output_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QcRecord" ADD CONSTRAINT "QcRecord_outputId_fkey" FOREIGN KEY ("outputId") REFERENCES "Output"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEdit" ADD CONSTRAINT "ChatEdit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
