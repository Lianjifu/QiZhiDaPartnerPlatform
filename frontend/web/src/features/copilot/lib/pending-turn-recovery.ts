import { getApiClient } from '@qzda/web-api';

export type TurnStatus = 'running' | 'done' | 'cancelled' | 'failed';

export type CopilotTurnStatus = {
  correlationId: string;
  conversationId: string;
  status: TurnStatus;
  clientMsgId?: string;
  hasAssistantReply?: boolean;
};

export async function fetchCopilotTurnStatus(
  conversationId: string,
  correlationId: string,
): Promise<CopilotTurnStatus | null> {
  try {
    const data = await getApiClient().request<CopilotTurnStatus>(
      `/api/copilot/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(correlationId)}/status`,
    );
    return data ?? null;
  } catch {
    return null;
  }
}

export const TURN_RECOVERY_POLL_MS = 2000;
