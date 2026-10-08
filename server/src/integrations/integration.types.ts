import type { Request } from 'express';
import type { ProcessEvent } from '../chat/chat.service';

export const INTERNAL_APP_ID = '00000000-0000-4000-8000-000000000001';
export const ACCESS_SCOPES = ['chat:write', 'conversations:read', 'conversations:delete', 'usage:read'] as const;
export type AccessScope = typeof ACCESS_SCOPES[number];
export type IntegrationApp = {
  id: string; name: string; enabled: boolean; websiteEnabled: boolean; apiEnabled: boolean;
  allowedOrigins: string[]; scopes: AccessScope[]; requestsPerMinute: number; concurrency: number;
  dailyRequests: number; dailyTokenLimit: number | null; authVersion: number; isInternal: boolean; createdAt: string; updatedAt: string;
};
export type IntegrationIdentity = {
  app: IntegrationApp; scopes: AccessScope[]; kind: 'website' | 'api'; ownerId?: string; keyId?: string;
};
export type IntegrationRequest = Request & { integration: IntegrationIdentity };
export type PublicAgentResult = {
  progressEvents?: ProcessEvent[];
  conversationId: string; runId: string | null; traceId: string | null;
  status: 'completed'; answer: string; refused: boolean; citations: unknown[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number; reservedTokens: number; unknownModelCalls: number; accounting: 'actual' | 'pending' | 'incomplete'; includesSummary: boolean };
};
