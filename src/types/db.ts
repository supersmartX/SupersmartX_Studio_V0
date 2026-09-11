export type PlanType = 'free' | 'creator_monthly' | 'creator_yearly' | 'pro_monthly' | 'pro_yearly';

export type ExportJobStatus = 'pending' | 'encoding' | 'uploading' | 'completed' | 'failed';

export interface StoredUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  plan: PlanType;
  planExpiresAt?: string;
  sessionVersion: number;
}

export interface ResetToken {
  tokenHash: string;
  email: string;
  expiresAt: string;
}

export interface ExportJobRecord {
  id: string;
  userId: string;
  configJson: string;
  status: ExportJobStatus;
  progress: number;
  resultR2Key: string | null;
  resultExportId: string | null;
  resultFileSize: number;
  errorMessage: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface ExportRecord {
  id: string;
  userId: string;
  r2Key: string;
  platform: string;
  outputWidth: number;
  outputHeight: number;
  fileSize: number;
  mimeType: string;
  status: string;
  createdAt: string;
  jobId?: string | null;
}
