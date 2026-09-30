import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiMutation, useApiQuery } from '@/services/query';
import { Badge, Button, Input, toast } from '@qzda/web-ui';
import {
  Wrench, Globe, Box, Upload, Network, RefreshCw, Sparkles, Search, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import type { SkillIntegration } from '@qzda/web-types';
import { Modal, EmptyState } from '@/components/shared';
import { useWorkspaceStore } from '@/stores/workspaceStore';

export function IntegrationWorkspace({
  onImport, onMcp, onTool, canWrite,
}: {
  onImport: () => void;
  onMcp: () => void;
  onTool: () => void;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const workspaceId = useWorkspaceStore((state) => state.currentWorkspaceId ?? 'w1');
  const [statusFilter, setStatusFilter] = useState<'all' | SkillIntegration['status'] | 'attention'>('all');
  const [searchQ, setSearchQ] = useState('');
  const [selected, setSelected] = useState<SkillIntegration | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data: integrationsData } = useApiQuery<SkillIntegration[]>(['skill-integrations'], '/api/skill-integrations');
  const integrations = integrationsData ?? [];

  const applyIntegrationResult = (result: SkillIntegration) => {
    queryClient.setQueryData<SkillIntegration[]>(['skill-integrations', workspaceId], (prev) => {
      const list = prev ?? integrations;
      return list.map((item) => (item.id === result.id ? { ...item, ...result } : item));
    });
    setSelected((prev) => (prev?.id === result.id ? { ...prev, ...result } : prev));
  };

  const notifyError = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : '接入操作失败');
  };

  const testMutation = useApiMutation<SkillIntegration, { id: string }>(
    ({ id }) => `/api/skill-integrations/${id}/test`,
    {
      onSuccess: (result) => {
        applyIntegrationResult(result);
        toast.success(
          result.health === 'healthy'
            ? `「${result.name}」验证通过（${result.lastVerifiedAt}）`
            : `「${result.name}」验证完成`,
        );
      },
      onError: notifyError,
    },
  );
  const discoverMutation = useApiMutation<SkillIntegration, { id: string }>(
    ({ id }) => `/api/skill-integrations/${id}/discover`,
    {
      onSuccess: (result) => {
        applyIntegrationResult(result);
        toast.success(`「${result.name}」已发现 ${result.discoveredCapabilities} 项能力`);
      },
      onError: notifyError,
    },
  );

  const runTest = (id: string) => {
    if (!canWrite || testMutation.isPending) return;
    setPendingId(id);
    testMutation.mutate(
      { id },
      { onSettled: () => setPendingId((cur) => (cur === id ? null : cur)) },
    );
  };

  const runDiscover = (id: string) => {
    if (!canWrite || discoverMutation.isPending) return;
    setPendingId(id);
    discoverMutation.mutate(
      { id },
      { onSettled: () => setPendingId((cur) => (cur === id ? null : cur)) },
    );
  };

  const enabledCount = integrations.filter((item) => item.status === 'enabled').length;
  const validatingCount = integrations.filter((item) => item.status === 'validating').length;
  const pendingCount = integrations.filter((item) => item.status === 'pending_approval').length;
  const attentionCount = integrations.filter((item) => item.health === 'attention' || item.status === 'failed').length;

  const visible = integrations.filter((item) => {
    if (statusFilter === 'attention') return item.health === 'attention' || item.status === 'failed';
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return `${item.name} ${item.endpoint} ${item.owner} ${item.credentialRef}`.toLowerCase().includes(q);
  });

  const statusLabel: Record<SkillIntegration['status'], string> = {
    draft: '草稿', validating: '验证中', pending_approval: '待审批', enabled: '已启用', failed: '验证失败', quarantined: '已隔离', disabled: '已停用',
  };
  const statusTone = (status: SkillIntegration['status']) => status === 'enabled' ? 'success' : status === 'pending_approval' || status === 'validating' ? 'warn' : status === 'failed' || status === 'quarantined' ? 'error' : 'neutral';
  const typeIcon = (type: SkillIntegration['type']) => type === 'mcp' ? Globe : type === 'tool' ? Box : Wrench;

  const kpiItems = [
    { key: 'enabled' as const, label: '已启用', value: enabledCount, tone: 'success' as const, icon: CheckCircle2 },
    { key: 'validating' as const, label: '待验证', value: validatingCount, tone: 'warn' as const, icon: RefreshCw },
    { key: 'pending_approval' as const, label: '待审批', value: pendingCount, tone: 'warn' as const, icon: AlertTriangle },
    { key: 'attention' as const, label: '异常连接', value: attentionCount, tone: 'error' as const, icon: Network },
  ];

  return (
    <div className="skills-integration">
      <section className="skills-integration__kpis">
        {kpiItems.map((item) => (
          <button
            key={item.key}
            type="button"
            className={cn('skills-integration-kpi', statusFilter === item.key && 'is-active')}
            onClick={() => setStatusFilter((prev) => (prev === item.key ? 'all' : item.key))}
          >
            <span className="skills-integration-kpi__label">
              <item.icon className={cn('h-3.5 w-3.5', item.tone === 'success' ? 'text-[var(--success)]' : item.tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--warning)]')} />
              {item.label}
            </span>
            <strong className={cn(
              item.tone === 'success' ? 'text-[var(--success)]' : item.tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--warning)]',
            )}>{item.value}</strong>
          </button>
        ))}
      </section>

      <section className="skills-integration__shell">
        <header className="skills-integration__header">
          <div className="min-w-0">
            <h3>接入任务</h3>
            <p>先完成连接、能力发现与策略校验，再将能力纳管到启用清单。凭据以密钥引用保存。</p>
          </div>
          <div className="skills-integration__actions">
            <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onImport}><Upload className="h-3.5 w-3.5" />导入 Skill</Button>
            <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onMcp}><Globe className="h-3.5 w-3.5" />连接 MCP</Button>
            <Button size="sm" disabled={!canWrite} onClick={onTool}><Box className="h-3.5 w-3.5" />注册 Tool</Button>
          </div>
        </header>

        <div className="skills-integration__toolbar">
          <select
            value={statusFilter === 'attention' ? 'attention' : statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className="h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[11px]"
            aria-label="状态筛选"
          >
            <option value="all">全部状态</option>
            <option value="draft">草稿</option>
            <option value="validating">验证中</option>
            <option value="pending_approval">待审批</option>
            <option value="enabled">已启用</option>
            <option value="failed">验证失败</option>
            <option value="quarantined">已隔离</option>
            <option value="attention">异常连接</option>
          </select>
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
            <Input value={searchQ} onChange={(event) => setSearchQ(event.target.value)} placeholder="搜索名称、地址或责任人" className="h-9 pl-8 text-xs" />
          </div>
          <span className="ml-auto hidden text-[11px] text-[var(--text-muted)] lg:inline">共 {visible.length} 项</span>
        </div>

        <div className="skills-integration__table-wrap">
          {visible.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState icon={Network} title="没有匹配的接入任务" description="调整筛选条件，或新建 Skill / MCP / Tool 接入。" />
            </div>
          ) : (
            <table className="skills-integration-table">
              <thead>
                <tr>
                  <th>接入任务</th>
                  <th>环境 / 状态</th>
                  <th>发现能力</th>
                  <th>凭据与网络</th>
                  <th>最近验证</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const Icon = typeIcon(item.type);
                  const busy = pendingId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div className="skills-integration-table__task">
                          <span className={cn(
                            'skills-integration-table__icon',
                            item.type === 'mcp' ? 'is-mcp' : item.type === 'tool' ? 'is-tool' : 'is-skill',
                          )}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0">
                            <strong>{item.name}</strong>
                            <small className="font-mono">{item.endpoint}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <Badge tone={statusTone(item.status) as 'success' | 'warn' | 'error' | 'neutral'} className="text-[9px]">{statusLabel[item.status]}</Badge>
                        <div className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                          {item.environment === 'production' ? '生产' : item.environment === 'test' ? '测试' : '开发'} · {item.owner}
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-[13px] font-semibold text-[var(--text)]">{item.discoveredCapabilities}</span>
                        <span className="ml-1 text-[11px] text-[var(--text-muted)]">项</span>
                      </td>
                      <td>
                        <div className="skills-integration-table__mono truncate text-[var(--brand)]">{item.credentialRef}</div>
                        <div className="mt-1.5 truncate text-[11px] text-[var(--text-muted)]">{item.allowedEgress.join('、') || '无外网出口'}</div>
                      </td>
                      <td>
                        <span className="text-[12px] text-[var(--text-secondary)]">{item.lastVerifiedAt}</span>
                        {item.lastError && <div className="mt-1.5 max-w-[200px] text-[11px] leading-4 text-[var(--danger)]">{item.lastError}</div>}
                      </td>
                      <td className="text-right">
                        <div className="skills-integration-table__ops">
                          <button
                            type="button"
                            disabled={!canWrite || busy}
                            onClick={() => runTest(item.id)}
                          >
                            {busy && testMutation.isPending ? '验证中…' : '验证'}
                          </button>
                          <button
                            type="button"
                            disabled={!canWrite || item.status === 'failed' || busy}
                            onClick={() => runDiscover(item.id)}
                          >
                            {busy && discoverMutation.isPending ? '发现中…' : '发现'}
                          </button>
                          <button type="button" onClick={() => setSelected(item)}>详情</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.name} · 接入详情` : '接入详情'}
        description="连接、发现、安全策略、验证日志与上线状态。"
        size="lg"
        panelClassName="max-w-[640px]"
        bodyClassName="skill-detail-modal px-7 py-6"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setSelected(null)}>关闭</Button>
            {selected && (
              <Button
                variant="secondary"
                disabled={!canWrite || testMutation.isPending}
                onClick={() => runTest(selected.id)}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', testMutation.isPending && pendingId === selected.id && 'animate-spin')} />
                {testMutation.isPending && pendingId === selected.id ? '验证中…' : '重新验证'}
              </Button>
            )}
            {selected && (
              <Button
                disabled={!canWrite || selected.status === 'failed' || discoverMutation.isPending}
                onClick={() => runDiscover(selected.id)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {discoverMutation.isPending && pendingId === selected.id ? '发现中…' : '重新发现'}
              </Button>
            )}
          </>
        )}
      >
        {selected && (
          <div className="flex flex-col gap-5 text-xs">
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">运行概况</div>
              <dl className="skill-detail-kv">
                <div><dt>发现能力</dt><dd className="font-mono">{selected.discoveredCapabilities} 项</dd></div>
                <div>
                  <dt>健康状态</dt>
                  <dd className={selected.health === 'healthy' ? 'text-[var(--success)]' : selected.health === 'attention' ? 'text-[var(--danger)]' : undefined}>
                    {selected.health === 'healthy' ? '正常' : selected.health === 'attention' ? '异常' : '待验证'}
                  </dd>
                </div>
                <div><dt>接入类型</dt><dd>{selected.type.toUpperCase()}</dd></div>
                <div><dt>责任人</dt><dd>{selected.owner}</dd></div>
                <div><dt>最近验证</dt><dd className="font-mono">{selected.lastVerifiedAt}</dd></div>
                {selected.skillId && <div><dt>关联技能</dt><dd className="font-mono">{selected.skillId}</dd></div>}
              </dl>
            </div>
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">连接与凭据</div>
              <dl className="skill-detail-kv">
                <div><dt>服务地址</dt><dd className="truncate font-mono text-[var(--brand)]">{selected.endpoint}</dd></div>
                <div><dt>凭据引用</dt><dd className="truncate font-mono text-[var(--brand)]">{selected.credentialRef}</dd></div>
                <div><dt>网络出口</dt><dd>{selected.allowedEgress.join('、') || '无外网出口'}</dd></div>
              </dl>
            </div>
            <div className="skill-detail-panel">
              <div className="skill-detail-panel__title">安全与上线策略</div>
              <dl className="skill-detail-kv">
                <div>
                  <dt>写操作审批</dt>
                  <dd><Badge tone={selected.writeApprovalRequired ? 'warn' : 'success'} className="text-[9px]">{selected.writeApprovalRequired ? '必须审批' : '无需审批'}</Badge></dd>
                </div>
                <div>
                  <dt>说明</dt>
                  <dd className="text-left text-[var(--text-muted)]">
                    {selected.type === 'skill'
                      ? '包技能验证会检查关联技能是否存在，以及 SKILL.md / 落盘目录是否可用。'
                      : '私网连接、mTLS、凭据轮换与熔断由控制面执行；此处展示当前策略状态。'}
                  </dd>
                </div>
                {selected.lastError && (
                  <div>
                    <dt>最近错误</dt>
                    <dd className="text-left text-[var(--danger)]">{selected.lastError}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
