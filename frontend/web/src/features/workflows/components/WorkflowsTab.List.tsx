/**
 * 工作流模板库：统一目录 + 搜索筛选。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Layers, Search, Trash2, X } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { INDUSTRY_OPTIONS } from '@/features/workflows/department-templates';
import { isPersonalTemplate, isTemplateReusable, needsTemplateReview } from '@/features/workflows/department-templates';
import { type WorkflowTemplateAsset } from './WorkflowsShared';
import type { WorkflowsController } from './useWorkflowsController';

interface Props {
  c: WorkflowsController;
}

const TPL_PAGE_SIZE = 12;
const RISK_OPTIONS = [
  { key: 'all', label: '全部风险' },
  { key: 'L1', label: 'L1' },
  { key: 'L2', label: 'L2' },
  { key: 'L3', label: 'L3' },
] as const;

export function WorkflowsTabList({ c }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'healthy' | 'review'>('all');
  const [risk, setRisk] = useState<(typeof RISK_OPTIONS)[number]['key']>('all');
  const [page, setPage] = useState(1);

  const baseCatalog = useMemo(
    () => c.availableTemplates.filter((template) => {
      if (!c.showAdvancedLibrary && template.library === 'advanced') return false;
      if (c.workspaceDeptOnly && c.workspaceDepartments.size > 0 && !c.workspaceDepartments.has(template.department)) return false;
      return true;
    }),
    [c.availableTemplates, c.showAdvancedLibrary, c.workspaceDeptOnly, c.workspaceDepartments],
  );

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return baseCatalog.filter((template) => {
      if (scope === 'healthy' && !isTemplateReusable(template)) return false;
      if (scope === 'review' && !needsTemplateReview(template)) return false;
      if (risk !== 'all' && template.risk !== risk) return false;
      if (!q) return true;
      const hay = [
        template.name, template.description, template.owner, template.departmentLabel,
        template.audience, template.industryTags.join(' '),
        template.connectors.map((slot) => `${slot.slot} ${slot.label}`).join(' '),
        ...(template.requiredSkills ?? []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [baseCatalog, query, scope, risk]);

  const deptCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of searched) counts.set(template.department, (counts.get(template.department) ?? 0) + 1);
    return counts;
  }, [searched]);

  const visibleTemplates = useMemo(
    () => searched.filter((template) => c.filterGroup === 'all' || template.department === c.filterGroup),
    [searched, c.filterGroup],
  );

  const flatList = useMemo(
    () => visibleTemplates.slice().sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name, 'zh')),
    [visibleTemplates],
  );
  const totalCount = flatList.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / TPL_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  useEffect(() => { setPage(1); }, [query, scope, risk, c.filterGroup, c.filterIndustry, c.showAdvancedLibrary, c.workspaceDeptOnly]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const pagedFlat = useMemo(() => {
    const start = (safePage - 1) * TPL_PAGE_SIZE;
    return flatList.slice(start, start + TPL_PAGE_SIZE);
  }, [flatList, safePage]);

  const activeFilters = [
    query.trim() ? { key: 'q', label: `搜索「${query.trim()}」`, clear: () => setQuery('') } : null,
    c.filterGroup !== 'all' ? { key: 'dept', label: c.DEPARTMENT_OPTIONS.find((item) => item.key === c.filterGroup)?.label ?? c.filterGroup, clear: () => c.setFilterGroup('all') } : null,
    c.filterIndustry !== 'all' ? { key: 'industry', label: INDUSTRY_OPTIONS.find((item) => item.key === c.filterIndustry)?.label ?? c.filterIndustry, clear: () => c.setFilterIndustry('all') } : null,
    scope !== 'all' ? { key: 'scope', label: scope === 'healthy' ? '可使用' : '需授权', clear: () => setScope('all') } : null,
    risk !== 'all' ? { key: 'risk', label: `风险 ${risk}`, clear: () => setRisk('all') } : null,
    c.workspaceDeptOnly ? { key: 'ws', label: '本工作区部门', clear: () => c.setWorkspaceDeptOnly(false) } : null,
    c.showAdvancedLibrary ? { key: 'adv', label: 'IT 高级库', clear: () => c.setShowAdvancedLibrary(false) } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  const resetFilters = () => {
    setQuery('');
    setScope('all');
    setRisk('all');
    c.setFilterGroup('all');
    c.setFilterIndustry('all');
    c.setWorkspaceDeptOnly(false);
    c.setShowAdvancedLibrary(false);
  };

  return (
    <div className="wf-tpl-page">
      <div className="wf-tpl-toolbar">
        <div className="wf-tpl-toolbar__row">
          <div className="wf-tpl-search">
            <Search className="h-3.5 w-3.5" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索名称、部门、适用对象、连接或技能"
              aria-label="搜索模板"
            />
            {query && (
              <button type="button" className="wf-tpl-search__clear" onClick={() => setQuery('')} aria-label="清除搜索">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="wf-tpl-toolbar__filters">
            <select
              value={c.filterGroup}
              onChange={(event) => c.setFilterGroup(event.target.value as typeof c.filterGroup)}
              className="wf-tpl-select"
              aria-label="部门"
            >
              {c.DEPARTMENT_OPTIONS.map((group) => {
                const count = group.key === 'all' ? searched.length : (deptCounts.get(group.key) ?? 0);
                return <option key={group.key} value={group.key}>{group.label}{count > 0 ? ` ${count}` : ''}</option>;
              })}
            </select>
            <select value={c.filterIndustry} onChange={(event) => c.setFilterIndustry(event.target.value)} className="wf-tpl-select" aria-label="行业">
              {INDUSTRY_OPTIONS.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
            <select value={scope} onChange={(event) => setScope(event.target.value as typeof scope)} className="wf-tpl-select" aria-label="可用状态">
              <option value="all">全部状态</option>
              <option value="healthy">可使用</option>
              <option value="review">需授权</option>
            </select>
            <select value={risk} onChange={(event) => setRisk(event.target.value as typeof risk)} className="wf-tpl-select" aria-label="风险等级">
              {RISK_OPTIONS.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
            </select>
            <button type="button" onClick={() => c.setWorkspaceDeptOnly(!c.workspaceDeptOnly)} className={cn('wf-tpl-toggle', c.workspaceDeptOnly && 'is-on')}>本工作区</button>
            <button type="button" onClick={() => c.setShowAdvancedLibrary(!c.showAdvancedLibrary)} className={cn('wf-tpl-toggle', c.showAdvancedLibrary && 'is-warn')}>IT 高级库</button>
          </div>
        </div>
        {activeFilters.length > 0 && (
          <div className="wf-tpl-active">
            {activeFilters.map((item) => (
              <button key={item.key} type="button" className="wf-tpl-active__chip" onClick={item.clear}>
                {item.label}<X className="h-3 w-3" />
              </button>
            ))}
            <button type="button" className="wf-tpl-active__reset" onClick={resetFilters}>清除筛选</button>
          </div>
        )}
      </div>

      {visibleTemplates.length === 0 ? (
        <div className="wf-tpl-empty">
          <Layers className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="wf-tpl-empty__title">没有符合条件的模板</p>
          <p className="wf-tpl-empty__desc">调整关键词、部门或状态后再试。</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="secondary" onClick={resetFilters}>重置筛选</Button>
            {!c.showAdvancedLibrary && <Button size="sm" onClick={() => c.setShowAdvancedLibrary(true)}>打开 IT 高级库</Button>}
          </div>
        </div>
      ) : (
        <>
          <div className="wf-tpl-pagebar"><span>共 {totalCount} 个模板</span></div>
          <div className="wf-tpl-grid">{pagedFlat.map((template) => <TemplateCard key={template.id} t={template} c={c} />)}</div>
          {totalPages > 1 && (
            <nav className="wf-tpl-pager" aria-label="模板分页">
              <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <div className="wf-tpl-pager__pages">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button key={n} type="button" className={cn('wf-tpl-pager__btn', n === safePage && 'is-active')} onClick={() => setPage(n)} aria-current={n === safePage ? 'page' : undefined}>{n}</button>
                ))}
              </div>
              <Button size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function TemplateCard({ t, c }: { t: WorkflowTemplateAsset; c: WorkflowsController }) {
  const navigate = useNavigate();
  const reusable = isTemplateReusable(t);
  const personal = isPersonalTemplate(t);
  const unbound = (t.connectors ?? []).filter((slot) => !slot.defaultBinding && !c.connectorBindings[slot.slot] && slot.slot !== 'notify.send' && slot.slot !== 'knowledge.retrieve');
  const industryLabel = (t.industryTags ?? []).filter((tag) => tag !== 'all').slice(0, 2);
  const openPreview = () => navigate(`/workflows/templates/${encodeURIComponent(t.id)}`);
  return (
    <article
      className={cn('wf-tpl-card group', t.parentId && 'wf-tpl-card--compact', t.library === 'advanced' && 'wf-tpl-card--advanced', !reusable && 'wf-tpl-card--blocked')}
      role="link"
      tabIndex={0}
      aria-label={`查看「${t.name}」编排`}
      onClick={openPreview}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openPreview();
        }
      }}
    >
      <header className="wf-tpl-card__head">
        <div className="min-w-0 flex-1">
          <div className="wf-tpl-card__title-row">
            <h3 className="wf-tpl-card__title" title={t.name}>{t.name}</h3>
            {t.library === 'advanced' && <span className="wf-tpl-chip">高级库</span>}
            {t.parentId && <span className="wf-tpl-chip wf-tpl-chip--info">子流程</span>}
          </div>
          <p className="wf-tpl-card__meta">
            <span>{t.departmentLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{t.audience}</span>
          </p>
        </div>
        <span className={cn('wf-tpl-status', reusable ? 'is-ready' : 'is-blocked')}>{reusable ? '可使用' : '需授权'}</span>
      </header>
      <p className="wf-tpl-card__desc">{t.description}</p>
      {!reusable && t.blockers.length > 0 && (
        <div className="wf-tpl-callout wf-tpl-callout--warn">
          <span>{t.blockers[0]}{t.blockers.length > 1 ? ` 等 ${t.blockers.length} 项` : ''}</span>
          {unbound[0] && (
            <button
              type="button"
              className="wf-tpl-link"
              onClick={(event) => { event.stopPropagation(); c.bindConnectorSlot(unbound[0].slot); }}
            >
              去绑定
            </button>
          )}
        </div>
      )}
      <div className="wf-tpl-card__stats">
        <span>v{t.version}</span>
        <span>{t.nodes} 节点</span>
        <span>风险 {t.risk}</span>
      </div>
      {(industryLabel.length > 0 || (t.knowledgePackageIds?.length ?? 0) > 0 || (t.requiredSkills?.length ?? 0) > 0) && (
        <div className="wf-tpl-card__tags">
          {industryLabel.map((tag) => <span key={tag} className="wf-tpl-tag">{tag}</span>)}
          {(t.knowledgePackageIds ?? []).slice(0, 1).map((id) => (
            <span key={id} className="wf-tpl-tag wf-tpl-tag--knowledge" title={id}>知识</span>
          ))}
          {(t.requiredSkills ?? []).slice(0, 1).map((sk) => (
            <span key={sk} className="wf-tpl-tag wf-tpl-tag--skill" title={sk}>{sk}</span>
          ))}
        </div>
      )}
      <footer className="wf-tpl-card__foot">
        {personal && c.canWrite ? (
          <button
            type="button"
            className="wf-tpl-ghost wf-tpl-ghost--danger"
            onClick={(event) => { event.stopPropagation(); c.deletePersonalTemplate(t); }}
            title="删除模板"
          >
            <Trash2 className="h-3.5 w-3.5" />删除
          </button>
        ) : <span className="wf-tpl-card__owner">{t.owner}</span>}
        <span className="wf-tpl-card__go">查看编排<ArrowRight className="h-3.5 w-3.5" /></span>
      </footer>
    </article>
  );
}

export default WorkflowsTabList;

export const __WORKFLOW_TPL_LEXICON = '办公通用';
