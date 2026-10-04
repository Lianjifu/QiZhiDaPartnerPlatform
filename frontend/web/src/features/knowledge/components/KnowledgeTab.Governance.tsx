/**
 * 知识中心 · 引用治理 tab（M07 P1 拆分）。
 *
 * 内容包括：访问与保留策略 / 智能体影响范围 / 已发布知识包绑定 / 审计注记；
 * 治理卡片 + 消费者绑定表 + 政策行均在此文件，与原 pages/Knowledge.tsx 一致。
 */
import { Link } from 'react-router-dom';
import { ChevronRight, Link2, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { Badge } from '@qzda/web-ui';
import { EmptyState } from '@/components/shared';
import type { KnowledgeController } from './useKnowledgeController';

export function KnowledgeTabGovernance({ c, packageId }: { c: KnowledgeController; packageId?: string }) {
  const bindings = packageId ? c.consumerBindings.filter((item) => item.packageId === packageId) : c.consumerBindings;
  return (
    <main className="de-employee-shell knowledge-workspace overflow-hidden rounded-xl bg-[var(--surface-1)] p-3 md:p-4">
      <div className="knowledge-workspace-heading">
        <div>
          <div className="text-sm font-semibold">引用治理</div>
          <p>管理权限、版本、风险策略，并追踪知识包对智能体和工作流的变更影响。</p>
        </div>
        <Badge tone="brand">审计已启用</Badge>
      </div>

      <div className="knowledge-governance-grid mt-3">
        <section className="knowledge-governance-card">
          <div className="knowledge-section-title">
            <ShieldCheck className="h-3.5 w-3.5 text-[var(--brand)]" />
            访问与保留策略
          </div>
          <div className="mt-3 space-y-2 text-xs">
            <div className="knowledge-policy-row">
              <span>
                <strong>敏感数据检测</strong>
                <small>上传后识别凭据、个人数据与机密内容</small>
              </span>
              <Badge tone={c.governance?.sensitiveDataDetection ? 'success' : 'warn'}>
                {c.governance?.sensitiveDataDetection ? '已启用' : '已暂停'}
              </Badge>
            </div>
            <label className="knowledge-policy-row">
              <span>
                <strong>版本保留</strong>
                <small>保留 {c.governance?.retentionDays ?? 365} 天版本，可审计和回滚</small>
              </span>
              <input
                type="checkbox"
                checked={c.governance?.versionRetention ?? true}
                disabled={!c.canWrite || c.governanceMutation.isPending}
                onChange={(event) => c.governanceMutation.mutate({ versionRetention: event.target.checked })}
              />
            </label>
            <div className="knowledge-policy-row">
              <span>
                <strong>高风险操作</strong>
                <small>归档、删除和共享需责任人复核</small>
              </span>
              <Badge tone={c.governance?.highRiskChangeApproval ? 'warn' : 'error'}>
                {c.governance?.highRiskChangeApproval ? '受控' : '未受控'}
              </Badge>
            </div>
          </div>
        </section>

        <section className="knowledge-governance-card">
          <div className="knowledge-section-title">
            <Users className="h-3.5 w-3.5 text-[var(--brand)]" />
            智能体影响范围
          </div>
          <div className="mt-3 space-y-2">
            {c.citationTrace.length ? (
              c.citationTrace.slice(0, 3).map((citation: any) => (
                <button
                  key={citation.docId}
                  type="button"
                  onClick={() => c.setActiveModal('citationAgents')}
                  className="knowledge-impact-row"
                >
                  <span className="min-w-0">
                    <strong>{citation.title}</strong>
                    <small>最后引用：{citation.lastUsed ?? '—'}</small>
                  </span>
                  <span className="font-mono text-[var(--brand)]">{citation.citeCount ?? citation.count ?? 0} 次</span>
                  <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                </button>
              ))
            ) : (
              <EmptyState icon={Users} title="暂无引用影响" description="智能体使用知识后将在此追踪" />
            )}
          </div>
        </section>
      </div>

      <section className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
        <div className="flex items-center justify-between">
          <div className="knowledge-section-title">
            <Link2 className="h-3.5 w-3.5 text-[var(--brand)]" />
            已发布知识包引用
          </div>
          <Badge tone="neutral">{bindings.length} 个运行时绑定</Badge>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[720px] divide-y divide-[var(--border)] text-xs">
            <div className="grid grid-cols-[1.2fr_.9fr_.8fr_.8fr_.9fr] gap-3 px-2 py-2 text-[10px] text-[var(--text-muted)]">
              <span>知识包 / 版本</span>
              <span>引用方</span>
              <span>环境</span>
              <span>无结果策略</span>
              <span>检索配置</span>
            </div>
            {bindings.map((binding) => (
              <div key={binding.id} className="grid grid-cols-[1.2fr_.9fr_.8fr_.8fr_.9fr] gap-3 px-2 py-3">
                <span>
                  <strong className="block">{binding.packageName}</strong>
                  <small className="font-mono text-[var(--text-muted)]">{binding.packageVersion}</small>
                </span>
                <span>
                  <Badge tone={binding.consumerType === 'workflow' ? 'info' : 'brand'}>
                    {binding.consumerType === 'digital_employee'
                      ? '数字伙伴'
                      : binding.consumerType === 'workflow'
                        ? '工作流'
                        : '执行内核'}
                  </Badge>
                  <small className="ml-1 text-[var(--text-muted)]">{binding.consumerName}</small>
                </span>
                <span>{binding.environment === 'production' ? '生产' : binding.environment === 'staging' ? '预发' : '沙箱'}</span>
                <span>
                  {binding.noResultPolicy === 'block'
                    ? '阻断执行'
                    : binding.noResultPolicy === 'handoff'
                      ? '人工接管'
                      : '请求澄清'}
                </span>
                <span className="font-mono text-[10px]">{binding.profileId}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="knowledge-audit-note mt-3">
        <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />
        <span>
          {c.knowledgeAudit[0]
            ? `${c.knowledgeAudit[0].time} · ${c.knowledgeAudit[0].action} · ${c.knowledgeAudit[0].target}`
            : c.governanceNotice}
        </span>
        <Link to="/knowledge">返回知识中心</Link>
      </div>
    </main>
  );
}