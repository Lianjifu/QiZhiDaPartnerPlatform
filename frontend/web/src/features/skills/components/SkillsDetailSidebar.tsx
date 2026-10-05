/**
 * 技能详情 · 右侧粘性 sidebar（M11 P1.5 重设）。
 *
 * 内容：
 *   - 健康摘要卡：sparkline + 三个核心指标
 *   - 快速操作：测试 / 配置 / 卸载 / 复制 ID / 打开商店
 *   - 所有者卡：owner / team / 风险 / 生命周期
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, Clipboard, ExternalLink,
  Play, Settings, ShieldCheck, Trash2, User,
} from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { SkillRow } from './SkillsShared';
import { isBuiltinSource, KIND_META, skillLifecycleLabel } from './SkillsShared';
import { SkillsSparkline } from './SkillsSparkline';

function copyToClipboard(value: string, onCopied: (msg: string) => void) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    onCopied('当前环境不支持剪贴板');
    return;
  }
  navigator.clipboard.writeText(value).then(
    () => onCopied('已复制到剪贴板'),
    () => onCopied('复制失败'),
  );
}

export function SkillsDetailSidebar({
  active,
  canWrite,
  onRunTest,
  onOpenRuntimeConfig,
  onUninstall,
  onOpenStore,
  onNotice,
}: {
  active: SkillRow;
  canWrite: boolean;
  onRunTest: () => void;
  onOpenRuntimeConfig: () => void;
  onUninstall: () => void;
  onOpenStore: () => void;
  onNotice: (msg: string) => void;
}) {
  const [copying, setCopying] = useState(false);
  const builtin = isBuiltinSource(active.source);
  const Icon = KIND_META[active.kind]?.icon ?? Settings;
  const lifecycle = active.lifecycleStatus ?? 'enabled';

  return (
    <aside className="skill-page-aside">
      <article className="skill-page-aside__card skill-page-aside__card--health">
        <header>
          <span className="skill-page-aside__kicker">运行健康</span>
          <Badge
            tone={active.riskLevel === 'high' ? 'error' : active.riskLevel === 'mid' ? 'warn' : 'success'}
            className="text-[9px]"
          >
            风险{active.riskLevel === 'high' ? '高' : active.riskLevel === 'mid' ? '中' : '低'}
          </Badge>
        </header>
        <SkillsSparkline
          seed={active.id}
          calls24h={active.perf?.calls24h ?? 0}
          errorRate={active.perf?.errorRate ?? 0}
          p95Ms={active.perf?.p95Ms ?? 0}
        />
        <div className="skill-page-aside__metrics">
          <div>
            <span>调用</span>
            <strong className="font-mono">{active.perf?.calls24h ?? 0}</strong>
          </div>
          <div>
            <span>错误率</span>
            <strong className={cn(
              'font-mono',
              (active.perf?.errorRate ?? 0) > 1 ? 'text-[var(--danger)]' : 'text-[var(--success)]',
            )}>
              {active.perf?.errorRate ?? 0}%
            </strong>
          </div>
          <div>
            <span>P95</span>
            <strong className="font-mono">{active.perf?.p95Ms ?? 0}ms</strong>
          </div>
        </div>
        <div className="skill-page-aside__legend">
          <span><i style={{ background: 'var(--brand)' }} />调用</span>
          <span><i style={{ background: 'var(--danger)' }} />错误</span>
          <span><i style={{ background: 'var(--warning)' }} />P95</span>
        </div>
      </article>

      <article className="skill-page-aside__card skill-page-aside__card--actions">
        <header>
          <span className="skill-page-aside__kicker">快速操作</span>
        </header>
        <Button size="sm" onClick={onRunTest}>
          <Play className="h-3.5 w-3.5" />运行测试
        </Button>
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={onOpenRuntimeConfig}>
          <Settings className="h-3.5 w-3.5" />运行配置
        </Button>
        {!builtin && (
          <Button
            size="sm"
            variant="ghost"
            className="text-[var(--danger)]"
            disabled={!canWrite}
            onClick={onUninstall}
          >
            <Trash2 className="h-3.5 w-3.5" />卸载
          </Button>
        )}
        <div className="skill-page-aside__subrow">
          <button
            type="button"
            className="skill-page-aside__iconbtn"
            onClick={() => {
              setCopying(true);
              copyToClipboard(active.id, onNotice);
              setTimeout(() => setCopying(false), 1200);
            }}
            title="复制 skill ID"
          >
            {copying ? <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" /> : <Clipboard className="h-3.5 w-3.5" />}
            <span>复制 ID</span>
          </button>
          <button type="button" className="skill-page-aside__iconbtn" onClick={onOpenStore}>
            <ExternalLink className="h-3.5 w-3.5" />
            <span>技能商店</span>
          </button>
        </div>
        {builtin && (
          <p className="skill-page-aside__note">
            <ShieldCheck className="h-3 w-3" />
            出厂技能随岗位包提供，目录中不卸载。
          </p>
        )}
      </article>

      <article className="skill-page-aside__card skill-page-aside__card--owner">
        <header>
          <span className="skill-page-aside__kicker">所有者</span>
        </header>
        <div className="skill-page-aside__owner">
          <span className="skill-page-aside__avatar"><User className="h-4 w-4" /></span>
          <div className="min-w-0">
            <strong>{active.owner ?? '未分配'}</strong>
            <span>{active.team ?? '平台默认'}</span>
          </div>
        </div>
        <ul className="skill-page-aside__facts">
          <li>
            <Icon className="h-3.5 w-3.5" />
            <span>类型</span>
            <strong>{KIND_META[active.kind]?.label ?? '技能'}</strong>
          </li>
          <li>
            <Activity className="h-3.5 w-3.5" />
            <span>生命周期</span>
            <strong>{skillLifecycleLabel(lifecycle)}</strong>
          </li>
          <li>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>最近核验</span>
            <strong className="font-mono">{active.lastVerifiedAt ?? '—'}</strong>
          </li>
        </ul>
      </article>
    </aside>
  );
}
