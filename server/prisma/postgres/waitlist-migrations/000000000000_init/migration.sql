-- CreateTable
CREATE TABLE "BetaWaitlistApplicant" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "institutionName" TEXT,
    "institutionRorId" TEXT,
    "role" TEXT,
    "customRole" TEXT,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "primaryField" TEXT,
    "institutionType" TEXT,
    "covidenceLicense" TEXT,
    "priorReviewCount" TEXT,
    "lastReviewTool" TEXT,
    "researchExperienceLevel" TEXT,
    "annualReviewVolume" TEXT,
    "workingStyle" TEXT,
    "teamSize" TEXT,
    "areasOfInterest" TEXT NOT NULL DEFAULT '[]',
    "primaryUse" TEXT,
    "referralSource" TEXT,
    "referralOther" TEXT,
    "message" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT,
    "consentAt" TIMESTAMP(3),
    "researchConsent" BOOLEAN NOT NULL DEFAULT false,
    "researchConsentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'WAITLISTED',
    "submissionSource" TEXT NOT NULL DEFAULT 'public_web',
    "confirmationEmailStatus" TEXT NOT NULL DEFAULT 'pending',
    "confirmationEmailSentAt" TIMESTAMP(3),
    "lastConfirmationEmailError" TEXT,
    "confirmationEmailAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastConfirmationAttemptAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "invitedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaWaitlistApplicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaWaitlistStatusEvent" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "changedBy" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaWaitlistStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaWaitlistApplicant_normalizedEmail_key" ON "BetaWaitlistApplicant"("normalizedEmail");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_status_idx" ON "BetaWaitlistApplicant"("status");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_createdAt_idx" ON "BetaWaitlistApplicant"("createdAt");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_countryCode_idx" ON "BetaWaitlistApplicant"("countryCode");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_role_idx" ON "BetaWaitlistApplicant"("role");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_confirmationEmailStatus_idx" ON "BetaWaitlistApplicant"("confirmationEmailStatus");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_institutionType_idx" ON "BetaWaitlistApplicant"("institutionType");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_primaryField_idx" ON "BetaWaitlistApplicant"("primaryField");

-- CreateIndex
CREATE INDEX "BetaWaitlistApplicant_covidenceLicense_idx" ON "BetaWaitlistApplicant"("covidenceLicense");

-- CreateIndex
CREATE INDEX "BetaWaitlistStatusEvent_applicantId_idx" ON "BetaWaitlistStatusEvent"("applicantId");

-- AddForeignKey
ALTER TABLE "BetaWaitlistStatusEvent" ADD CONSTRAINT "BetaWaitlistStatusEvent_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "BetaWaitlistApplicant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

