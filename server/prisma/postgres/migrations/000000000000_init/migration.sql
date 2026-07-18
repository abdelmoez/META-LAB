-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "userNumber" INTEGER,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "suspended" BOOLEAN NOT NULL DEFAULT false,
    "sessionEpoch" INTEGER NOT NULL DEFAULT 0,
    "suspendedAt" TIMESTAMP(3),
    "tierId" TEXT,
    "tierAssignedAt" TIMESTAMP(3),
    "tierAssignedBy" TEXT,
    "tierOverrideReason" TEXT,
    "passwordChangedAt" TIMESTAMP(3),
    "welcomeEmailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActive" TIMESTAMP(3),
    "themePreference" TEXT,
    "dashboardPreferences" TEXT,
    "screeningShortcuts" TEXT,
    "workflowMenuMode" TEXT,
    "projectSidebarPinned" BOOLEAN,
    "uiDesignMode" TEXT,
    "registrationCountryCode" TEXT,
    "registrationCountryName" TEXT,
    "registrationIpCountrySource" TEXT,
    "registrationIpHash" TEXT,
    "registrationCountryDetectedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "emailVerificationTokenHash" TEXT,
    "emailVerificationExpiresAt" TIMESTAMP(3),
    "termsAcceptedAt" TIMESTAMP(3),
    "primaryRole" TEXT,
    "researchField" TEXT,
    "mainUseCase" TEXT,
    "institutionOriginal" TEXT,
    "institutionNormalized" TEXT,
    "institutionRorId" TEXT,
    "institutionCanonicalName" TEXT,
    "institutionCity" TEXT,
    "institutionCountryName" TEXT,
    "institutionCountryCode" TEXT,
    "institutionSource" TEXT,
    "institutionMatchConfidence" DOUBLE PRECISION,
    "institutionNeedsReview" BOOLEAN NOT NULL DEFAULT false,
    "institutionId" TEXT,
    "country" TEXT,
    "onboardingCompletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSequence" (
    "name" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSequence_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "rorId" TEXT,
    "openAlexId" TEXT,
    "countryName" TEXT,
    "countryCode" TEXT,
    "city" TEXT,
    "website" TEXT,
    "aliases" TEXT,
    "source" TEXT NOT NULL DEFAULT 'local',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingQuestion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'single_select',
    "options" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "allowSkip" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "audience" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserOnboardingResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "answer" TEXT,
    "status" TEXT NOT NULL DEFAULT 'answered',
    "answeredAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserOnboardingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "requestedByUserId" TEXT,
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedSource" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "lastSavedAt" TIMESTAMP(3),
    "autosaveRev" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "doi" TEXT,
    "pmid" TEXT,
    "decision" TEXT,
    "mergedIntoId" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewStudy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "author" TEXT,
    "year" TEXT,
    "esType" TEXT,
    "data" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessage" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "origin" TEXT NOT NULL DEFAULT 'contact_form',
    "replied" BOOLEAN NOT NULL DEFAULT false,
    "repliedAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "readByUserId" TEXT,
    "readByName" TEXT,
    "reference" TEXT,
    "severity" TEXT,
    "triageStatus" TEXT NOT NULL DEFAULT 'new',
    "triagedAt" TIMESTAMP(3),
    "triageNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactMessageRead" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactReply" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "repliedById" TEXT NOT NULL,
    "repliedByName" TEXT NOT NULL DEFAULT '',
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "app" TEXT NOT NULL DEFAULT '',
    "relatedScreenProjectId" TEXT,
    "relatedMetaLabProjectId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorEmail" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT '',
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "ip" TEXT NOT NULL DEFAULT '',
    "userAgent" TEXT NOT NULL DEFAULT '',
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenProjectStatusEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "previousStatus" TEXT NOT NULL DEFAULT '',
    "changedById" TEXT NOT NULL DEFAULT '',
    "changedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenProjectStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "linkedMetaLabProjectId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "reviewQuestion" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "blindMode" BOOLEAN NOT NULL DEFAULT false,
    "requiredScreeningReviewers" INTEGER NOT NULL DEFAULT 2,
    "progressStatus" TEXT NOT NULL DEFAULT 'not_started',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "inclusionKeywords" TEXT NOT NULL DEFAULT '[]',
    "exclusionKeywords" TEXT NOT NULL DEFAULT '[]',
    "studyTypeFilter" TEXT NOT NULL DEFAULT '[]',
    "picoSnapshot" TEXT NOT NULL DEFAULT '{}',
    "chatRestricted" BOOLEAN NOT NULL DEFAULT false,
    "aiSettings" TEXT NOT NULL DEFAULT '{}',
    "deletedAt" TIMESTAMP(3),
    "deletedSource" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "duplicateGroupId" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL DEFAULT '',
    "authors" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "journal" TEXT NOT NULL DEFAULT '',
    "doi" TEXT NOT NULL DEFAULT '',
    "pmid" TEXT NOT NULL DEFAULT '',
    "abstract" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "sourceDb" TEXT NOT NULL DEFAULT '',
    "rawData" TEXT NOT NULL DEFAULT '{}',
    "currentStage" TEXT NOT NULL DEFAULT 'title_abstract',
    "finalStatus" TEXT NOT NULL DEFAULT '',
    "promotedAt" TIMESTAMP(3),
    "promotedVia" TEXT NOT NULL DEFAULT '',
    "acceptedAt" TIMESTAMP(3),
    "rejectedReason" TEXT NOT NULL DEFAULT '',
    "handoffStatus" TEXT NOT NULL DEFAULT '',
    "handoffAt" TIMESTAMP(3),
    "handoffStudyId" TEXT NOT NULL DEFAULT '',
    "handoffError" TEXT NOT NULL DEFAULT '',
    "revertedExtractionSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenDecision" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "decision" TEXT NOT NULL DEFAULT 'undecided',
    "exclusionReason" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "rating" INTEGER,
    "labels" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5b9cf6',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenExclusionReason" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenExclusionReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenDuplicateGroup" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "primaryId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenDuplicateGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenDuplicateLabel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordIdA" TEXT NOT NULL,
    "recordIdB" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "predictedType" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "reviewerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenDuplicateLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenConflict" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "reviewerDecisions" TEXT NOT NULL DEFAULT '{}',
    "finalDecision" TEXT NOT NULL DEFAULT '',
    "resolvedBy" TEXT NOT NULL DEFAULT '',
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenImportBatch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "filename" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "preDedupCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'file',
    "fileHash" TEXT,
    "fileSize" INTEGER,
    "importedById" TEXT,
    "importedByName" TEXT NOT NULL DEFAULT '',
    "parser" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenImportJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "filename" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT '',
    "detectedFormat" TEXT NOT NULL DEFAULT '',
    "fileHash" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "force" BOOLEAN NOT NULL DEFAULT false,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "importedRecords" INTEGER NOT NULL DEFAULT 0,
    "duplicateRecords" INTEGER NOT NULL DEFAULT 0,
    "rejectedRecords" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "errorReport" TEXT NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenDuplicateJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "comparisonsTotal" INTEGER NOT NULL DEFAULT 0,
    "comparisonsDone" INTEGER NOT NULL DEFAULT 0,
    "groupsFound" INTEGER NOT NULL DEFAULT 0,
    "savedGroups" INTEGER NOT NULL DEFAULT 0,
    "groupsCreated" INTEGER NOT NULL DEFAULT 0,
    "groupsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsFlagged" INTEGER NOT NULL DEFAULT 0,
    "exactMatches" INTEGER NOT NULL DEFAULT 0,
    "fuzzyMatches" INTEGER NOT NULL DEFAULT 0,
    "statsJson" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenDuplicateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'reviewer',
    "status" TEXT NOT NULL DEFAULT 'active',
    "canScreen" BOOLEAN NOT NULL DEFAULT true,
    "canChat" BOOLEAN NOT NULL DEFAULT true,
    "canResolveConflicts" BOOLEAN NOT NULL DEFAULT false,
    "permissionPreset" TEXT NOT NULL DEFAULT 'reviewer',
    "canViewMetaSift" BOOLEAN NOT NULL DEFAULT true,
    "canSecondReview" BOOLEAN NOT NULL DEFAULT true,
    "canManageDuplicates" BOOLEAN NOT NULL DEFAULT false,
    "canImportRecords" BOOLEAN NOT NULL DEFAULT false,
    "canExportRecords" BOOLEAN NOT NULL DEFAULT false,
    "readOnlyMetaSift" BOOLEAN NOT NULL DEFAULT false,
    "canViewMetaLab" BOOLEAN NOT NULL DEFAULT true,
    "canEditMetaLab" BOOLEAN NOT NULL DEFAULT false,
    "canManageExtraction" BOOLEAN NOT NULL DEFAULT false,
    "canRunAnalysis" BOOLEAN NOT NULL DEFAULT false,
    "canExport" BOOLEAN NOT NULL DEFAULT false,
    "canAssessRiskOfBias" BOOLEAN NOT NULL DEFAULT false,
    "readOnlyMetaLab" BOOLEAN NOT NULL DEFAULT false,
    "canManageMembers" BOOLEAN NOT NULL DEFAULT false,
    "canManageSettings" BOOLEAN NOT NULL DEFAULT false,
    "invitedByUserId" TEXT,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "inviteAcceptedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenChatMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ScreenChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenPdfAttachment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'manual_upload',
    "oaStatus" TEXT,
    "sourceUrl" TEXT,
    "resolvedDoi" TEXT,
    "matchedBy" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "retrievalAttemptedAt" TIMESTAMP(3),
    "retrievalError" TEXT,
    "fileHash" TEXT,

    CONSTRAINT "ScreenPdfAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenRecordOpenState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenRecordOpenState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenChatRead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenChatRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "screenProjectId" TEXT,
    "metaLabProjectId" TEXT,
    "format" TEXT,
    "meta" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobAssessment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "outcomeId" TEXT,
    "resultLabel" TEXT,
    "instrumentId" TEXT NOT NULL DEFAULT 'RoB2',
    "instrumentVersion" TEXT NOT NULL DEFAULT '2019-08-22',
    "variant" TEXT NOT NULL DEFAULT 'assignment',
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobAnswer" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "response" TEXT NOT NULL DEFAULT '',
    "rationale" TEXT,
    "evidenceQuote" TEXT,
    "evidenceLocator" TEXT,
    "aiSuggested" BOOLEAN,
    "aiModel" TEXT,
    "aiModelVersion" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobDomainJudgment" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "proposedJudgment" TEXT NOT NULL DEFAULT '',
    "finalJudgment" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideJustification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobDomainJudgment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobOverall" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "proposedOverall" TEXT NOT NULL DEFAULT '',
    "finalOverall" TEXT,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideJustification" TEXT,
    "multiSomeConcernsFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobOverall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobAuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionAuditLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobManualStudy" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "authors" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "doi" TEXT,
    "pmid" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "RobManualStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowModuleState" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL,
    "stateJson" TEXT NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowModuleState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowStateAudit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "moduleKey" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL,
    "revision" INTEGER,
    "userId" TEXT,
    "userName" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowStateAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAiRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "mode" TEXT NOT NULL DEFAULT 'cold_start',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "engineVersion" TEXT NOT NULL DEFAULT '1.0',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "nRecords" INTEGER NOT NULL DEFAULT 0,
    "nScored" INTEGER NOT NULL DEFAULT 0,
    "nFeatures" INTEGER NOT NULL DEFAULT 0,
    "labelCountsJson" TEXT NOT NULL DEFAULT '{}',
    "modelInfoJson" TEXT NOT NULL DEFAULT '{}',
    "configJson" TEXT NOT NULL DEFAULT '{}',
    "metricsJson" TEXT NOT NULL DEFAULT '{}',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "triggeredById" TEXT,
    "triggeredByName" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "supersededAt" TIMESTAMP(3),
    "parentRunId" TEXT,
    "rollbackFromRunId" TEXT,
    "snapshotHash" TEXT NOT NULL DEFAULT '',
    "featureVersion" TEXT NOT NULL DEFAULT '',
    "driftJson" TEXT NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenAiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAiScore" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "proba" DOUBLE PRECISION,
    "calibratedProba" DOUBLE PRECISION,
    "coldStartScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "uncertainty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "prediction" TEXT NOT NULL DEFAULT 'uncertain',
    "band" TEXT NOT NULL DEFAULT 'unscored',
    "mode" TEXT NOT NULL DEFAULT 'cold_start',
    "lowConfidence" BOOLEAN NOT NULL DEFAULT false,
    "missingAbstract" BOOLEAN NOT NULL DEFAULT false,
    "picoMean" DOUBLE PRECISION,
    "subScoresJson" TEXT NOT NULL DEFAULT '{}',
    "signalsJson" TEXT NOT NULL DEFAULT '{}',
    "explanationJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenAiScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAiFeedback" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "aiPrediction" TEXT NOT NULL DEFAULT '',
    "aiScore" DOUBLE PRECISION,
    "humanDecision" TEXT NOT NULL DEFAULT '',
    "agree" BOOLEAN,
    "rating" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "givenById" TEXT,
    "givenByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenAiFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenAiJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "kind" TEXT NOT NULL DEFAULT 'rescore',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'decision',
    "reason" TEXT NOT NULL DEFAULT '',
    "runId" TEXT NOT NULL DEFAULT '',
    "nScored" INTEGER NOT NULL DEFAULT 0,
    "coalesced" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenAiJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenExportJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "format" TEXT NOT NULL DEFAULT 'csv',
    "filter" TEXT NOT NULL DEFAULT 'all',
    "includeAiCv" BOOLEAN NOT NULL DEFAULT true,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "processedRecords" INTEGER NOT NULL DEFAULT 0,
    "cvStatus" TEXT NOT NULL DEFAULT '',
    "resultPath" TEXT NOT NULL DEFAULT '',
    "resultBytes" INTEGER NOT NULL DEFAULT 0,
    "filename" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PecanSearchRun" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "screenProjectId" TEXT NOT NULL DEFAULT '',
    "initiatedById" TEXT NOT NULL DEFAULT '',
    "initiatedByName" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'queued',
    "canonicalQuery" TEXT NOT NULL DEFAULT '{}',
    "canonicalText" TEXT NOT NULL DEFAULT '',
    "config" TEXT NOT NULL DEFAULT '{}',
    "counts" TEXT NOT NULL DEFAULT '{}',
    "warningSummary" TEXT NOT NULL DEFAULT '[]',
    "errorSummary" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT,
    "jobId" TEXT NOT NULL DEFAULT '',
    "softwareVersion" TEXT NOT NULL DEFAULT '',
    "engineVersion" TEXT NOT NULL DEFAULT '',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PecanSearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PecanSearchSource" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerVersion" TEXT NOT NULL DEFAULT '',
    "generatedQuery" TEXT NOT NULL DEFAULT '',
    "finalQuery" TEXT NOT NULL DEFAULT '',
    "queryHash" TEXT NOT NULL DEFAULT '',
    "translationWarnings" TEXT NOT NULL DEFAULT '[]',
    "overrideById" TEXT NOT NULL DEFAULT '',
    "overrideReason" TEXT NOT NULL DEFAULT '',
    "filters" TEXT NOT NULL DEFAULT '{}',
    "previewCount" INTEGER,
    "previewKind" TEXT NOT NULL DEFAULT '',
    "previewAt" TIMESTAMP(3),
    "rawCount" INTEGER NOT NULL DEFAULT 0,
    "normalizedCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "existingMatchCount" INTEGER NOT NULL DEFAULT 0,
    "exactDupCount" INTEGER NOT NULL DEFAULT 0,
    "fuzzyDupCount" INTEGER NOT NULL DEFAULT 0,
    "ambiguousDupCount" INTEGER NOT NULL DEFAULT 0,
    "failedRecordCount" INTEGER NOT NULL DEFAULT 0,
    "cursor" TEXT NOT NULL DEFAULT '',
    "lastCompletedPage" INTEGER NOT NULL DEFAULT 0,
    "cap" INTEGER NOT NULL DEFAULT 0,
    "capReached" BOOLEAN NOT NULL DEFAULT false,
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "state" TEXT NOT NULL DEFAULT 'pending',
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "rateLimitMeta" TEXT NOT NULL DEFAULT '{}',
    "errorClass" TEXT NOT NULL DEFAULT '',
    "errorDetail" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PecanSearchSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PecanSourceRecord" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL DEFAULT '',
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "providerRecordId" TEXT NOT NULL DEFAULT '',
    "screenRecordId" TEXT NOT NULL DEFAULT '',
    "doi" TEXT NOT NULL DEFAULT '',
    "pmid" TEXT NOT NULL DEFAULT '',
    "pmcid" TEXT NOT NULL DEFAULT '',
    "nctId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "abstract" TEXT NOT NULL DEFAULT '',
    "authors" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "journal" TEXT NOT NULL DEFAULT '',
    "volume" TEXT NOT NULL DEFAULT '',
    "issue" TEXT NOT NULL DEFAULT '',
    "pages" TEXT NOT NULL DEFAULT '',
    "pubType" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '[]',
    "meshTerms" TEXT NOT NULL DEFAULT '[]',
    "retracted" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" TEXT NOT NULL DEFAULT '{}',
    "normalized" TEXT NOT NULL DEFAULT '{}',
    "normalizationVersion" TEXT NOT NULL DEFAULT '',
    "dedupOutcome" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PecanSourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PecanDedupDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "sourceRecordId" TEXT NOT NULL DEFAULT '',
    "matchedScreenRecordId" TEXT NOT NULL DEFAULT '',
    "matchedSourceRecordId" TEXT NOT NULL DEFAULT '',
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreComponents" TEXT NOT NULL DEFAULT '{}',
    "ruleVersion" TEXT NOT NULL DEFAULT '',
    "matchType" TEXT NOT NULL DEFAULT '',
    "decision" TEXT NOT NULL DEFAULT 'pending',
    "decisionSource" TEXT NOT NULL DEFAULT '',
    "decidedById" TEXT NOT NULL DEFAULT '',
    "decidedByName" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "reasons" TEXT NOT NULL DEFAULT '[]',
    "conflicts" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PecanDedupDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PecanSearchJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL DEFAULT '',
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT -1,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedBy" TEXT NOT NULL DEFAULT '',
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "payload" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PecanSearchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineRegistry" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "major" INTEGER NOT NULL DEFAULT 0,
    "minor" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastChangeType" TEXT,
    "lastChangeSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EngineRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngineVersionHistory" (
    "id" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "previousMajor" INTEGER NOT NULL,
    "previousMinor" INTEGER NOT NULL,
    "newMajor" INTEGER NOT NULL,
    "newMinor" INTEGER NOT NULL,
    "changeType" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "classificationReason" TEXT,
    "commitSha" TEXT,
    "branch" TEXT,
    "actor" TEXT,
    "pullRequest" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngineVersionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEngineChange" (
    "id" TEXT NOT NULL,
    "changeKey" TEXT NOT NULL,
    "engineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessedEngineChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationMetadata" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "workId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'openalex',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "CitationMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmbeddingCacheEntry" (
    "id" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "vector" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbeddingCacheEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenValidationSample" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "seed" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'uniform_random',
    "size" INTEGER NOT NULL,
    "recordIds" TEXT NOT NULL DEFAULT '[]',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenValidationSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionForm" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Extraction form',
    "templateKey" TEXT,
    "elements" TEXT NOT NULL DEFAULT '[]',
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionValue" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "armKey" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "value" TEXT NOT NULL DEFAULT '{}',
    "provenance" TEXT NOT NULL DEFAULT '{}',
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "suggestionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "extractor1Id" TEXT,
    "extractor2Id" TEXT,
    "adjudicatorId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'single',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractionConsensus" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "armKey" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'agreement',
    "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "provenance" TEXT NOT NULL DEFAULT '{}',
    "resolvedById" TEXT,
    "resolvedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtractionConsensus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiExtractionSuggestion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'heuristic',
    "model" TEXT,
    "payload" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiExtractionSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParsedTable" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "studyId" TEXT,
    "name" TEXT,
    "source" TEXT NOT NULL DEFAULT 'paste',
    "page" INTEGER,
    "data" TEXT NOT NULL DEFAULT '[]',
    "quality" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParsedTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivingSavedSearch" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Living search',
    "providerIds" TEXT NOT NULL DEFAULT '[]',
    "canonicalQuery" TEXT NOT NULL DEFAULT '{}',
    "canonicalText" TEXT NOT NULL DEFAULT '',
    "cadence" TEXT NOT NULL DEFAULT 'manual',
    "scheduleDayOfWeek" INTEGER,
    "scheduleHourUtc" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3),
    "lastRunAt" TIMESTAMP(3),
    "lastRunId" TEXT,
    "lastRunState" TEXT,
    "lastResultCount" INTEGER,
    "lastNewCount" INTEGER,
    "lastError" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LivingSavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSnapshot" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "label" TEXT,
    "runId" TEXT,
    "appVersion" TEXT,
    "summary" TEXT NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceShiftAlert" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "prevSnapshotId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "shifts" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'open',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceShiftAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "entitlements" TEXT NOT NULL DEFAULT '{}',
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "publiclyAvailable" BOOLEAN NOT NULL DEFAULT true,
    "manualAssignAllowed" BOOLEAN NOT NULL DEFAULT true,
    "priceMonthlyCents" INTEGER,
    "priceAnnualCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "gracePeriodDays" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectExportUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "exportType" TEXT NOT NULL,
    "format" TEXT,
    "tierId" TEXT,
    "period" TEXT NOT NULL,
    "counted" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'started',
    "failureReason" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "ProjectExportUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSynthesis" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "shareToken" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "embedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "settings" TEXT NOT NULL DEFAULT '{}',
    "currentVersionId" TEXT,
    "publishedById" TEXT,
    "publishedByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PublicSynthesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicSynthesisVersion" (
    "id" TEXT NOT NULL,
    "publicSynthesisId" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "appVersion" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicSynthesisVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main synthesis dashboard',
    "cards" TEXT NOT NULL DEFAULT '[]',
    "isDefault" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FullTextRetrievalJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'included',
    "recordIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "counts" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FullTextRetrievalJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FullTextCandidate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'found',
    "oaStatus" TEXT,
    "license" TEXT,
    "pdfUrl" TEXT,
    "landingUrl" TEXT,
    "version" TEXT,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FullTextCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FullTextRequest" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "note" TEXT,
    "updatedById" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FullTextRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchStrategyVersion" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "strategy" TEXT NOT NULL DEFAULT '{}',
    "canonicalText" TEXT NOT NULL DEFAULT '',
    "isFinal" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchStrategyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCriterion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "question" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'include',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "polarity" TEXT NOT NULL DEFAULT 'positive',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityCriterionAudit" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "changeType" TEXT NOT NULL DEFAULT 'replace',
    "beforeJson" TEXT NOT NULL DEFAULT '[]',
    "afterJson" TEXT NOT NULL DEFAULT '[]',
    "changedById" TEXT,
    "changedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibilityCriterionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityAssessment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "answersJson" TEXT NOT NULL DEFAULT '[]',
    "blockersJson" TEXT NOT NULL DEFAULT '[]',
    "suggestedDecision" TEXT NOT NULL DEFAULT 'unclear',
    "decisionConfidence" DOUBLE PRECISION,
    "engineVersion" TEXT NOT NULL DEFAULT '',
    "configVersion" TEXT NOT NULL DEFAULT '',
    "criteriaVersion" INTEGER NOT NULL DEFAULT 1,
    "autoApplied" BOOLEAN NOT NULL DEFAULT false,
    "autoApplyPolicy" TEXT NOT NULL DEFAULT '',
    "autoAppliedAt" TIMESTAMP(3),
    "reviewerDecision" TEXT NOT NULL DEFAULT '',
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL DEFAULT '',
    "overrideReason" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScreenEligibilityJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'title_abstract',
    "scope" TEXT NOT NULL DEFAULT 'undecided',
    "recordIdsJson" TEXT NOT NULL DEFAULT '[]',
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT NOT NULL DEFAULT '',
    "nAssessed" INTEGER NOT NULL DEFAULT 0,
    "nAutoApplied" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "heartbeatAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScreenEligibilityJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibilityProjectSetting" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "settingsJson" TEXT NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EligibilityProjectSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchStrategyIteration" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "strategyVersionId" TEXT,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "database" TEXT NOT NULL DEFAULT '',
    "searchString" TEXT NOT NULL DEFAULT '',
    "hitCount" INTEGER,
    "hitKind" TEXT NOT NULL DEFAULT '',
    "criticJson" TEXT NOT NULL DEFAULT '{}',
    "changesJson" TEXT NOT NULL DEFAULT '{}',
    "profile" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchStrategyIteration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchSeedStudy" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "doi" TEXT,
    "pmid" TEXT,
    "openAlexId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "addedById" TEXT,
    "addedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchSeedStudy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchRecallReport" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "strategyVersionId" TEXT,
    "runId" TEXT,
    "seedTotal" INTEGER NOT NULL DEFAULT 0,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedRecall" DOUBLE PRECISION,
    "missingJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchRecallReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeOutcomeAssessment" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "outcomeKey" TEXT NOT NULL,
    "outcomeLabel" TEXT NOT NULL DEFAULT '',
    "startLevel" INTEGER NOT NULL DEFAULT 4,
    "startLevelSource" TEXT NOT NULL DEFAULT '',
    "domainsJson" TEXT NOT NULL DEFAULT '{}',
    "suggestionsJson" TEXT NOT NULL DEFAULT '{}',
    "certaintyLevel" TEXT NOT NULL DEFAULT '',
    "certaintyNumeric" INTEGER,
    "robSignature" TEXT NOT NULL DEFAULT '',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lockedById" TEXT,
    "lockedByName" TEXT,
    "lockedAt" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GradeOutcomeAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeAuditLog" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "outcomeKey" TEXT NOT NULL DEFAULT '',
    "action" TEXT NOT NULL DEFAULT '',
    "beforeJson" TEXT NOT NULL DEFAULT '{}',
    "afterJson" TEXT NOT NULL DEFAULT '{}',
    "changedById" TEXT,
    "changedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedReview" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "filename" TEXT NOT NULL DEFAULT '',
    "fileHash" TEXT NOT NULL DEFAULT '',
    "uploadedById" TEXT,
    "uploadedByName" TEXT,
    "referenceCount" INTEGER NOT NULL DEFAULT 0,
    "textChars" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeedReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExtractedReference" (
    "id" TEXT NOT NULL,
    "seedReviewId" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "raw" TEXT NOT NULL DEFAULT '',
    "authors" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "journal" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "doi" TEXT NOT NULL DEFAULT '',
    "pmid" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL DEFAULT '',
    "parseConfidence" DOUBLE PRECISION,
    "resolutionStatus" TEXT NOT NULL DEFAULT 'pending',
    "resolvedJson" TEXT NOT NULL DEFAULT '{}',
    "resolvedSource" TEXT NOT NULL DEFAULT '',
    "resolvedDoi" TEXT NOT NULL DEFAULT '',
    "resolvedPmid" TEXT NOT NULL DEFAULT '',
    "resolvedOpenAlexId" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExtractedReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationChaseJob" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "direction" TEXT NOT NULL DEFAULT 'backward',
    "depth" INTEGER NOT NULL DEFAULT 1,
    "maxCandidates" INTEGER NOT NULL DEFAULT 500,
    "seedIdsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER,
    "nFound" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "heartbeatAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "claimedBy" TEXT NOT NULL DEFAULT '',
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "errorText" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CitationChaseJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CitationCandidate" (
    "id" TEXT NOT NULL,
    "metaLabProjectId" TEXT NOT NULL DEFAULT '',
    "chaseJobId" TEXT,
    "seedReviewId" TEXT,
    "doi" TEXT NOT NULL DEFAULT '',
    "pmid" TEXT NOT NULL DEFAULT '',
    "openAlexId" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "abstract" TEXT NOT NULL DEFAULT '',
    "year" TEXT NOT NULL DEFAULT '',
    "journal" TEXT NOT NULL DEFAULT '',
    "authorsJson" TEXT NOT NULL DEFAULT '[]',
    "publicationType" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "provenanceJson" TEXT NOT NULL DEFAULT '{}',
    "dedupStatus" TEXT NOT NULL DEFAULT '',
    "matchedRecordId" TEXT NOT NULL DEFAULT '',
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CitationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTierAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "previousTierId" TEXT,
    "assignedById" TEXT,
    "assignedByName" TEXT,
    "changeType" TEXT NOT NULL DEFAULT 'manual',
    "reason" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveUntil" TIMESTAMP(3),
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "reverted" BOOLEAN NOT NULL DEFAULT false,
    "revertedAt" TIMESTAMP(3),
    "revertedById" TEXT,
    "metaJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTierAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TierSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT,
    "provider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "priceId" TEXT,
    "planId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'none',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "trialStart" TIMESTAMP(3),
    "trialEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "lastPaymentAt" TIMESTAMP(3),
    "nextRenewalAt" TIMESTAMP(3),
    "failedPaymentCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TierSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistInvitation" (
    "id" TEXT NOT NULL,
    "waitlistApplicantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "name" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "acceptedAt" TIMESTAMP(3),
    "acceptedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "tierId" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'pending',
    "emailSentAt" TIMESTAMP(3),
    "lastEmailError" TEXT,
    "invitedByUserId" TEXT NOT NULL,
    "batchId" TEXT,
    "cohort" TEXT,
    "ip" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" SERIAL NOT NULL,
    "projectId" TEXT NOT NULL,
    "projectRev" INTEGER NOT NULL DEFAULT 0,
    "eventType" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subtype" TEXT,
    "actorUserId" TEXT NOT NULL DEFAULT '',
    "actorName" TEXT NOT NULL DEFAULT '',
    "actorRole" TEXT NOT NULL DEFAULT '',
    "origin" TEXT NOT NULL DEFAULT 'user_action',
    "clientTs" TIMESTAMP(3),
    "serverTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectStage" TEXT,
    "module" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "parentEntityId" TEXT,
    "prevValue" TEXT NOT NULL DEFAULT 'null',
    "newValue" TEXT NOT NULL DEFAULT 'null',
    "diff" TEXT NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "correlationId" TEXT,
    "sessionId" TEXT,
    "jobId" TEXT,
    "relatedOutcome" TEXT,
    "relatedStudy" TEXT,
    "relatedAnalysis" TEXT,
    "significance" INTEGER NOT NULL DEFAULT 1,
    "manuscriptSections" TEXT NOT NULL DEFAULT '[]',
    "resultImpact" TEXT NOT NULL DEFAULT 'none',
    "requiresRecalc" BOOLEAN NOT NULL DEFAULT false,
    "requiresManuscriptRefresh" BOOLEAN NOT NULL DEFAULT false,
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "supersedesEventId" INTEGER,
    "reconstructed" BOOLEAN NOT NULL DEFAULT false,
    "invalidated" BOOLEAN NOT NULL DEFAULT false,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "checksum" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_userNumber_idx" ON "User"("userNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_rorId_key" ON "Institution"("rorId");

-- CreateIndex
CREATE INDEX "Institution_normalizedName_idx" ON "Institution"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingQuestion_key_key" ON "OnboardingQuestion"("key");

-- CreateIndex
CREATE INDEX "OnboardingQuestion_isActive_displayOrder_idx" ON "OnboardingQuestion"("isActive", "displayOrder");

-- CreateIndex
CREATE INDEX "UserOnboardingResponse_userId_idx" ON "UserOnboardingResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserOnboardingResponse_userId_questionId_key" ON "UserOnboardingResponse"("userId", "questionId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_createdAt_idx" ON "PasswordResetToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Project_userId_lastActivityAt_idx" ON "Project"("userId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_idx" ON "ReviewRecord"("projectId");

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_doi_idx" ON "ReviewRecord"("projectId", "doi");

-- CreateIndex
CREATE INDEX "ReviewRecord_projectId_pmid_idx" ON "ReviewRecord"("projectId", "pmid");

-- CreateIndex
CREATE INDEX "ReviewStudy_projectId_idx" ON "ReviewStudy"("projectId");

-- CreateIndex
CREATE INDEX "ContactMessage_reference_idx" ON "ContactMessage"("reference");

-- CreateIndex
CREATE INDEX "ContactMessage_triageStatus_idx" ON "ContactMessage"("triageStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ContactMessageRead_messageId_userId_key" ON "ContactMessageRead"("messageId", "userId");

-- CreateIndex
CREATE INDEX "ContactReply_messageId_idx" ON "ContactReply"("messageId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_idx" ON "SecurityEvent"("userId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectStatusEvent_status_createdAt_idx" ON "ScreenProjectStatusEvent"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectStatusEvent_projectId_createdAt_idx" ON "ScreenProjectStatusEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProject_linkedMetaLabProjectId_idx" ON "ScreenProject"("linkedMetaLabProjectId");

-- CreateIndex
CREATE INDEX "ScreenRecord_projectId_idx" ON "ScreenRecord"("projectId");

-- CreateIndex
CREATE INDEX "ScreenRecord_duplicateGroupId_idx" ON "ScreenRecord"("duplicateGroupId");

-- CreateIndex
CREATE INDEX "ScreenRecord_projectId_id_idx" ON "ScreenRecord"("projectId", "id");

-- CreateIndex
CREATE INDEX "ScreenDecision_projectId_idx" ON "ScreenDecision"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenDecision_recordId_reviewerId_stage_key" ON "ScreenDecision"("recordId", "reviewerId", "stage");

-- CreateIndex
CREATE INDEX "ScreenDuplicateGroup_projectId_idx" ON "ScreenDuplicateGroup"("projectId");

-- CreateIndex
CREATE INDEX "ScreenDuplicateLabel_projectId_idx" ON "ScreenDuplicateLabel"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenDuplicateLabel_projectId_recordIdA_recordIdB_key" ON "ScreenDuplicateLabel"("projectId", "recordIdA", "recordIdB");

-- CreateIndex
CREATE INDEX "ScreenConflict_projectId_idx" ON "ScreenConflict"("projectId");

-- CreateIndex
CREATE INDEX "ScreenConflict_recordId_idx" ON "ScreenConflict"("recordId");

-- CreateIndex
CREATE INDEX "ScreenImportBatch_projectId_fileHash_idx" ON "ScreenImportBatch"("projectId", "fileHash");

-- CreateIndex
CREATE INDEX "ScreenImportJob_projectId_status_idx" ON "ScreenImportJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenImportJob_status_createdAt_idx" ON "ScreenImportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenImportJob_projectId_fileHash_idx" ON "ScreenImportJob"("projectId", "fileHash");

-- CreateIndex
CREATE INDEX "ScreenDuplicateJob_projectId_status_idx" ON "ScreenDuplicateJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenDuplicateJob_projectId_createdAt_idx" ON "ScreenDuplicateJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenDuplicateJob_status_createdAt_idx" ON "ScreenDuplicateJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenProjectMember_inviteTokenHash_idx" ON "ScreenProjectMember"("inviteTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenProjectMember_projectId_email_key" ON "ScreenProjectMember"("projectId", "email");

-- CreateIndex
CREATE INDEX "ScreenChatMessage_projectId_createdAt_idx" ON "ScreenChatMessage"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenPdfAttachment_fileHash_idx" ON "ScreenPdfAttachment"("fileHash");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenRecordOpenState_recordId_userId_key" ON "ScreenRecordOpenState"("recordId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenChatRead_projectId_userId_key" ON "ScreenChatRead"("projectId", "userId");

-- CreateIndex
CREATE INDEX "UsageEvent_type_createdAt_idx" ON "UsageEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_idx" ON "UsageEvent"("userId");

-- CreateIndex
CREATE INDEX "ScreenAuditLog_projectId_createdAt_idx" ON "ScreenAuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RobAssessment_projectId_idx" ON "RobAssessment"("projectId");

-- CreateIndex
CREATE INDEX "RobAssessment_projectId_studyId_idx" ON "RobAssessment"("projectId", "studyId");

-- CreateIndex
CREATE INDEX "RobAnswer_assessmentId_idx" ON "RobAnswer"("assessmentId");

-- CreateIndex
CREATE UNIQUE INDEX "RobAnswer_assessmentId_questionId_key" ON "RobAnswer"("assessmentId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "RobDomainJudgment_assessmentId_domainId_key" ON "RobDomainJudgment"("assessmentId", "domainId");

-- CreateIndex
CREATE UNIQUE INDEX "RobOverall_assessmentId_key" ON "RobOverall"("assessmentId");

-- CreateIndex
CREATE INDEX "RobAuditLog_projectId_createdAt_idx" ON "RobAuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RobAuditLog_assessmentId_createdAt_idx" ON "RobAuditLog"("assessmentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionAuditLog_projectId_createdAt_idx" ON "ExtractionAuditLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionAuditLog_studyId_createdAt_idx" ON "ExtractionAuditLog"("studyId", "createdAt");

-- CreateIndex
CREATE INDEX "RobManualStudy_projectId_idx" ON "RobManualStudy"("projectId");

-- CreateIndex
CREATE INDEX "WorkflowModuleState_projectId_idx" ON "WorkflowModuleState"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowModuleState_projectId_moduleKey_key" ON "WorkflowModuleState"("projectId", "moduleKey");

-- CreateIndex
CREATE INDEX "WorkflowStateAudit_projectId_createdAt_idx" ON "WorkflowStateAudit"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowStateAudit_projectId_moduleKey_idx" ON "WorkflowStateAudit"("projectId", "moduleKey");

-- CreateIndex
CREATE INDEX "ScreenAiRun_projectId_createdAt_idx" ON "ScreenAiRun"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenAiRun_projectId_status_idx" ON "ScreenAiRun"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenAiRun_projectId_stage_isActive_idx" ON "ScreenAiRun"("projectId", "stage", "isActive");

-- CreateIndex
CREATE INDEX "ScreenAiScore_projectId_stage_idx" ON "ScreenAiScore"("projectId", "stage");

-- CreateIndex
CREATE INDEX "ScreenAiScore_projectId_score_idx" ON "ScreenAiScore"("projectId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "ScreenAiScore_projectId_recordId_stage_key" ON "ScreenAiScore"("projectId", "recordId", "stage");

-- CreateIndex
CREATE INDEX "ScreenAiFeedback_projectId_createdAt_idx" ON "ScreenAiFeedback"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenAiFeedback_projectId_recordId_idx" ON "ScreenAiFeedback"("projectId", "recordId");

-- CreateIndex
CREATE INDEX "ScreenAiJob_projectId_createdAt_idx" ON "ScreenAiJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenAiJob_projectId_status_idx" ON "ScreenAiJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenAiJob_status_createdAt_idx" ON "ScreenAiJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenExportJob_projectId_status_idx" ON "ScreenExportJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenExportJob_projectId_createdAt_idx" ON "ScreenExportJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenExportJob_status_createdAt_idx" ON "ScreenExportJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PecanSearchRun_metaLabProjectId_createdAt_idx" ON "PecanSearchRun"("metaLabProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "PecanSearchRun_state_idx" ON "PecanSearchRun"("state");

-- CreateIndex
CREATE UNIQUE INDEX "PecanSearchRun_metaLabProjectId_idempotencyKey_key" ON "PecanSearchRun"("metaLabProjectId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "PecanSearchSource_runId_idx" ON "PecanSearchSource"("runId");

-- CreateIndex
CREATE INDEX "PecanSearchSource_runId_provider_idx" ON "PecanSearchSource"("runId", "provider");

-- CreateIndex
CREATE INDEX "PecanSourceRecord_metaLabProjectId_doi_idx" ON "PecanSourceRecord"("metaLabProjectId", "doi");

-- CreateIndex
CREATE INDEX "PecanSourceRecord_metaLabProjectId_pmid_idx" ON "PecanSourceRecord"("metaLabProjectId", "pmid");

-- CreateIndex
CREATE INDEX "PecanSourceRecord_sourceId_idx" ON "PecanSourceRecord"("sourceId");

-- CreateIndex
CREATE INDEX "PecanSourceRecord_runId_idx" ON "PecanSourceRecord"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "PecanSourceRecord_runId_provider_providerRecordId_key" ON "PecanSourceRecord"("runId", "provider", "providerRecordId");

-- CreateIndex
CREATE INDEX "PecanDedupDecision_runId_idx" ON "PecanDedupDecision"("runId");

-- CreateIndex
CREATE INDEX "PecanDedupDecision_runId_decision_idx" ON "PecanDedupDecision"("runId", "decision");

-- CreateIndex
CREATE INDEX "PecanDedupDecision_metaLabProjectId_decision_idx" ON "PecanDedupDecision"("metaLabProjectId", "decision");

-- CreateIndex
CREATE INDEX "PecanSearchJob_status_createdAt_idx" ON "PecanSearchJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PecanSearchJob_runId_idx" ON "PecanSearchJob"("runId");

-- CreateIndex
CREATE INDEX "EngineVersionHistory_engineId_createdAt_idx" ON "EngineVersionHistory"("engineId", "createdAt");

-- CreateIndex
CREATE INDEX "EngineVersionHistory_commitSha_idx" ON "EngineVersionHistory"("commitSha");

-- CreateIndex
CREATE INDEX "ProcessedEngineChange_changeKey_idx" ON "ProcessedEngineChange"("changeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessedEngineChange_changeKey_engineId_key" ON "ProcessedEngineChange"("changeKey", "engineId");

-- CreateIndex
CREATE INDEX "CitationMetadata_workId_idx" ON "CitationMetadata"("workId");

-- CreateIndex
CREATE INDEX "CitationMetadata_fetchedAt_idx" ON "CitationMetadata"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CitationMetadata_key_key" ON "CitationMetadata"("key");

-- CreateIndex
CREATE INDEX "EmbeddingCacheEntry_model_idx" ON "EmbeddingCacheEntry"("model");

-- CreateIndex
CREATE UNIQUE INDEX "EmbeddingCacheEntry_textHash_model_key" ON "EmbeddingCacheEntry"("textHash", "model");

-- CreateIndex
CREATE INDEX "ScreenValidationSample_projectId_stage_createdAt_idx" ON "ScreenValidationSample"("projectId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "ExtractionForm_projectId_isActive_idx" ON "ExtractionForm"("projectId", "isActive");

-- CreateIndex
CREATE INDEX "ExtractionValue_projectId_studyId_idx" ON "ExtractionValue"("projectId", "studyId");

-- CreateIndex
CREATE INDEX "ExtractionValue_projectId_userId_idx" ON "ExtractionValue"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionValue_projectId_studyId_elementId_armKey_userId_key" ON "ExtractionValue"("projectId", "studyId", "elementId", "armKey", "userId");

-- CreateIndex
CREATE INDEX "ExtractionAssignment_projectId_idx" ON "ExtractionAssignment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionAssignment_projectId_studyId_key" ON "ExtractionAssignment"("projectId", "studyId");

-- CreateIndex
CREATE INDEX "ExtractionConsensus_projectId_studyId_idx" ON "ExtractionConsensus"("projectId", "studyId");

-- CreateIndex
CREATE UNIQUE INDEX "ExtractionConsensus_projectId_studyId_elementId_armKey_key" ON "ExtractionConsensus"("projectId", "studyId", "elementId", "armKey");

-- CreateIndex
CREATE INDEX "AiExtractionSuggestion_projectId_studyId_createdAt_idx" ON "AiExtractionSuggestion"("projectId", "studyId", "createdAt");

-- CreateIndex
CREATE INDEX "ParsedTable_projectId_studyId_idx" ON "ParsedTable"("projectId", "studyId");

-- CreateIndex
CREATE INDEX "LivingSavedSearch_metaLabProjectId_idx" ON "LivingSavedSearch"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "LivingSavedSearch_enabled_nextRunAt_idx" ON "LivingSavedSearch"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReviewSnapshot_metaLabProjectId_createdAt_idx" ON "ReviewSnapshot"("metaLabProjectId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceShiftAlert_metaLabProjectId_status_createdAt_idx" ON "EvidenceShiftAlert"("metaLabProjectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectExportUsage_userId_period_counted_idx" ON "ProjectExportUsage"("userId", "period", "counted");

-- CreateIndex
CREATE INDEX "ProjectExportUsage_userId_createdAt_idx" ON "ProjectExportUsage"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProjectExportUsage_projectId_idx" ON "ProjectExportUsage"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSynthesis_metaLabProjectId_key" ON "PublicSynthesis"("metaLabProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "PublicSynthesis_shareToken_key" ON "PublicSynthesis"("shareToken");

-- CreateIndex
CREATE INDEX "PublicSynthesisVersion_publicSynthesisId_version_idx" ON "PublicSynthesisVersion"("publicSynthesisId", "version");

-- CreateIndex
CREATE INDEX "PublicSynthesisVersion_metaLabProjectId_idx" ON "PublicSynthesisVersion"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "DashboardLayout_metaLabProjectId_idx" ON "DashboardLayout"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "FullTextRetrievalJob_status_createdAt_idx" ON "FullTextRetrievalJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "FullTextRetrievalJob_projectId_createdAt_idx" ON "FullTextRetrievalJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "FullTextCandidate_projectId_recordId_idx" ON "FullTextCandidate"("projectId", "recordId");

-- CreateIndex
CREATE INDEX "FullTextCandidate_recordId_provider_idx" ON "FullTextCandidate"("recordId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "FullTextRequest_projectId_recordId_key" ON "FullTextRequest"("projectId", "recordId");

-- CreateIndex
CREATE INDEX "SearchStrategyVersion_metaLabProjectId_version_idx" ON "SearchStrategyVersion"("metaLabProjectId", "version");

-- CreateIndex
CREATE INDEX "EligibilityCriterion_projectId_idx" ON "EligibilityCriterion"("projectId");

-- CreateIndex
CREATE INDEX "EligibilityCriterionAudit_projectId_idx" ON "EligibilityCriterionAudit"("projectId");

-- CreateIndex
CREATE INDEX "EligibilityAssessment_projectId_idx" ON "EligibilityAssessment"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityAssessment_projectId_recordId_key" ON "EligibilityAssessment"("projectId", "recordId");

-- CreateIndex
CREATE INDEX "ScreenEligibilityJob_projectId_createdAt_idx" ON "ScreenEligibilityJob"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ScreenEligibilityJob_projectId_status_idx" ON "ScreenEligibilityJob"("projectId", "status");

-- CreateIndex
CREATE INDEX "ScreenEligibilityJob_status_createdAt_idx" ON "ScreenEligibilityJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EligibilityProjectSetting_projectId_key" ON "EligibilityProjectSetting"("projectId");

-- CreateIndex
CREATE INDEX "SearchStrategyIteration_metaLabProjectId_idx" ON "SearchStrategyIteration"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "SearchSeedStudy_metaLabProjectId_idx" ON "SearchSeedStudy"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "SearchRecallReport_metaLabProjectId_idx" ON "SearchRecallReport"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "GradeOutcomeAssessment_metaLabProjectId_idx" ON "GradeOutcomeAssessment"("metaLabProjectId");

-- CreateIndex
CREATE UNIQUE INDEX "GradeOutcomeAssessment_metaLabProjectId_outcomeKey_key" ON "GradeOutcomeAssessment"("metaLabProjectId", "outcomeKey");

-- CreateIndex
CREATE INDEX "GradeAuditLog_metaLabProjectId_idx" ON "GradeAuditLog"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "SeedReview_metaLabProjectId_idx" ON "SeedReview"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "ExtractedReference_seedReviewId_idx" ON "ExtractedReference"("seedReviewId");

-- CreateIndex
CREATE INDEX "ExtractedReference_metaLabProjectId_idx" ON "ExtractedReference"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "CitationChaseJob_status_createdAt_idx" ON "CitationChaseJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CitationChaseJob_metaLabProjectId_idx" ON "CitationChaseJob"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "CitationChaseJob_heartbeatAt_idx" ON "CitationChaseJob"("heartbeatAt");

-- CreateIndex
CREATE INDEX "CitationCandidate_metaLabProjectId_idx" ON "CitationCandidate"("metaLabProjectId");

-- CreateIndex
CREATE INDEX "CitationCandidate_chaseJobId_idx" ON "CitationCandidate"("chaseJobId");

-- CreateIndex
CREATE INDEX "UserTierAssignment_userId_idx" ON "UserTierAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserTierAssignment_tierId_idx" ON "UserTierAssignment"("tierId");

-- CreateIndex
CREATE INDEX "UserTierAssignment_userId_isCurrent_idx" ON "UserTierAssignment"("userId", "isCurrent");

-- CreateIndex
CREATE INDEX "TierSubscription_userId_idx" ON "TierSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TierSubscription_userId_key" ON "TierSubscription"("userId");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_tokenHash_idx" ON "WaitlistInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_normalizedEmail_idx" ON "WaitlistInvitation"("normalizedEmail");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_status_idx" ON "WaitlistInvitation"("status");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_expiresAt_idx" ON "WaitlistInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_waitlistApplicantId_idx" ON "WaitlistInvitation"("waitlistApplicantId");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_acceptedUserId_idx" ON "WaitlistInvitation"("acceptedUserId");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_batchId_idx" ON "WaitlistInvitation"("batchId");

-- CreateIndex
CREATE INDEX "WaitlistInvitation_cohort_idx" ON "WaitlistInvitation"("cohort");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_idempotencyKey_key" ON "ProjectEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_id_idx" ON "ProjectEvent"("projectId", "id");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_category_idx" ON "ProjectEvent"("projectId", "category");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_eventType_idx" ON "ProjectEvent"("projectId", "eventType");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_significance_idx" ON "ProjectEvent"("projectId", "significance");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_serverTs_idx" ON "ProjectEvent"("projectId", "serverTs");

-- CreateIndex
CREATE INDEX "ProjectEvent_correlationId_idx" ON "ProjectEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOnboardingResponse" ADD CONSTRAINT "UserOnboardingResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserOnboardingResponse" ADD CONSTRAINT "UserOnboardingResponse_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "OnboardingQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRecord" ADD CONSTRAINT "ReviewRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewStudy" ADD CONSTRAINT "ReviewStudy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactMessageRead" ADD CONSTRAINT "ContactMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactReply" ADD CONSTRAINT "ContactReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ContactMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenProject" ADD CONSTRAINT "ScreenProject_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenRecord" ADD CONSTRAINT "ScreenRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenRecord" ADD CONSTRAINT "ScreenRecord_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ScreenImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenRecord" ADD CONSTRAINT "ScreenRecord_duplicateGroupId_fkey" FOREIGN KEY ("duplicateGroupId") REFERENCES "ScreenDuplicateGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenDecision" ADD CONSTRAINT "ScreenDecision_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenLabel" ADD CONSTRAINT "ScreenLabel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenExclusionReason" ADD CONSTRAINT "ScreenExclusionReason_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenDuplicateGroup" ADD CONSTRAINT "ScreenDuplicateGroup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenConflict" ADD CONSTRAINT "ScreenConflict_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenConflict" ADD CONSTRAINT "ScreenConflict_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenImportBatch" ADD CONSTRAINT "ScreenImportBatch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenImportJob" ADD CONSTRAINT "ScreenImportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenDuplicateJob" ADD CONSTRAINT "ScreenDuplicateJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenProjectMember" ADD CONSTRAINT "ScreenProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenProjectMember" ADD CONSTRAINT "ScreenProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenChatMessage" ADD CONSTRAINT "ScreenChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenPdfAttachment" ADD CONSTRAINT "ScreenPdfAttachment_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenRecordOpenState" ADD CONSTRAINT "ScreenRecordOpenState_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ScreenRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScreenAuditLog" ADD CONSTRAINT "ScreenAuditLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ScreenProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobAssessment" ADD CONSTRAINT "RobAssessment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobAnswer" ADD CONSTRAINT "RobAnswer_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "RobAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobDomainJudgment" ADD CONSTRAINT "RobDomainJudgment_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "RobAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobOverall" ADD CONSTRAINT "RobOverall_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "RobAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobManualStudy" ADD CONSTRAINT "RobManualStudy_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowModuleState" ADD CONSTRAINT "WorkflowModuleState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PecanSearchSource" ADD CONSTRAINT "PecanSearchSource_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PecanSearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PecanSourceRecord" ADD CONSTRAINT "PecanSourceRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PecanSearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PecanDedupDecision" ADD CONSTRAINT "PecanDedupDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PecanSearchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

