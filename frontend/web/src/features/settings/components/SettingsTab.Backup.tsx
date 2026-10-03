/**
 * SettingsTab.Backup — 平台设置 / 数据保留:备份 KPI + 备份表 + 立即备份按钮。
 * M09 P1 拆分:从 pages/Settings.tsx 行 485-544 抽出。
 */
import {
  CheckCircle2, Clock3, Database, Download, HardDrive, RotateCcw,
} from 'lucide-react';
import { Badge, Button, KpiCard, toast } from '@qzda/web-ui';
import { useApiMutation } from '@/services/query';
import { PanelHeader, panelClass } from './SettingsShared';

type Backup = {
  id: string;
  time: string;
  type: string;
  size: string;
  duration: string;
};

export function BackupPanel({ backups }: { backups: Backup[] }) {
  const latest = backups[0];
  const autoCount = backups.filter((b) => b.type === '自动').length;
  const requestBackup = useApiMutation<any, { scope: string }>(
    '/api/backups',
    {
      onSuccess: () => toast.success('已提交备份申请，等待审批'),
      onError: (error) => toast.error(error instanceof Error ? error.message : '备份申请失败'),
    },
  );

  return (
    <div className="settings-section">
      <section className="settings-kpis">
        <KpiCard label="备份总数" value={backups.length} sub="份" icon={Database} tone="brand" size="comfortable" />
        <KpiCard label="最近备份" value={latest?.time?.slice(5, 10) ?? '—'} sub={latest?.time?.slice(11) ?? ''} icon={Clock3} tone="success" size="comfortable" />
        <KpiCard label="自动备份" value={autoCount} sub="份" icon={RotateCcw} tone="info" size="comfortable" />
        <KpiCard label="保留策略" value="30" sub="天" icon={HardDrive} tone="warn" size="comfortable" />
      </section>

      <section className={panelClass}>
        <PanelHeader
          icon={HardDrive}
          title="数据保留与恢复"
          description="覆盖数字伙伴运行记忆索引、知识与配置快照；恢复需管理员审批。"
          trailing={(
            <Button size="sm" loading={requestBackup.isPending} onClick={() => requestBackup.mutate({ scope: 'full' })}>
              <RotateCcw className="h-3 w-3" />立即备份
            </Button>
          )}
        />
        <div className="settings-table-head settings-table-head--backup">
          <span>备份时间</span>
          <span>类型</span>
          <span>大小</span>
          <span>耗时</span>
          <span className="text-right">操作</span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {backups.map((b) => (
            <article key={b.id} className="settings-table-row settings-table-row--backup">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" />
                <span className="font-mono text-[11px]">{b.time}</span>
              </div>
              <div><Badge tone={b.type === '自动' ? 'info' : 'brand'}>{b.type}</Badge></div>
              <div className="font-mono text-[var(--text-secondary)]">{b.size}</div>
              <div className="text-[var(--text-muted)]">{b.duration}</div>
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="secondary"><RotateCcw className="h-3 w-3" />恢复</Button>
                <Button size="sm" variant="secondary" aria-label="下载备份"><Download className="h-3 w-3" /></Button>
              </div>
            </article>
          ))}
        </div>
        <div className="settings-panel__foot">自动备份每日 02:00 执行；恢复操作需管理员审批并写入审计。</div>
      </section>
    </div>
  );
}
