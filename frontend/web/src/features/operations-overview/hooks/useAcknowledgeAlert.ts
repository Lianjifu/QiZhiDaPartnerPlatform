/**
 * M01 运营告警确认 — POST /api/home/alerts/:id/acknowledge
 *
 * 行为契约：
 *  - 只允许管理员触发（前端按钮条件渲染；后端 mockHandler 也会二次校验）
 *  - 成功后失效 extra cache 以便下次 KPI / 告警数实时反映
 *  - 返回 { id, acknowledgedAt, acknowledgedBy, acknowledgementNote }
 */
import { useApiMutation } from '@/services/query';

export type AcknowledgeAlertPayload = { alertId: string };

export type AcknowledgeAlertResponse = {
  id: string;
  acknowledgedAt: string;
  acknowledgedBy: string;
  acknowledgementNote: string;
};

export function useAcknowledgeAlert() {
  return useApiMutation<AcknowledgeAlertResponse, AcknowledgeAlertPayload>(
    ({ alertId }) => `/api/home/alerts/${alertId}/acknowledge`,
    { invalidateKeys: [['home', 'extra'], ['home', 'alerts']] },
  );
}
