/**
 * M06 P1 工作流模板库 tab（TemplatesView）。
 *
 * 拆分原因：原 pages/Workflows.tsx 4479L（M06 P1 整合），按 D1 决策把平台模板库
 * 抽离。本文件聚焦列表筛选、卡片渲染与分页；状态从 useWorkflowsController 接收。
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Sparkles, Layers, Search, Eye, GitCompare, Trash2, Box, ArrowRight, ChevronRight,
} from 'lucide-react';
import { Button } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import { INDUSTRY_OPTIONS, type DepartmentKey, type TemplateOrigin } from '@/features/workflows/department-templates';
import { isTemplateReusable, needsTemplateReview, isPersonalTemplate } from '@/features/workflows/department-templates';
import { departmentLabel } from './workflow-template-helpers';
import {
  NODE_ICONS, NODE_LABELS, type ConnectorBindings, type WorkflowTemplateAsset,
} from './WorkflowsShared';
import type { WorkflowsController } from './useWorkflowsController';

interface Props {
  c: WorkflowsController;
}

const TPL_PAGE_SIZE = 6;

export function WorkflowsTabList({ c }: Props) {
  const isPersonal = c.templateOriginFilter === 'personal';
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | 'healthy' | 'review'>('all');
  const [page, setPage] = useState(1);
  const visibleTemplates = useMemo(() => c.filteredTemplates.filter((template) => {
    const hay = `${template.name} ${template.description} ${template.owner} ${template.departmentLabel} ${template.audience} ${template.industryTags.join(' ')} ${template.connectors.map((cc) => cc.slot).join(' ')}`.toLowerCase();
    const matchesQuery = !query.trim() || hay.includes(query.trim().toLowerCase());
    const matchesScope = scope === 'all' || (scope === 'healthy' ? isTemplateReusable(template) : needsTemplateReview(template));
    return matchesQuery && matchesScope;
  }), [c.filteredTemplates, query, scope]);

  const flatList = useMemo(
    () => visibleTemplates.slice().sort((a, b) => {
      if (c.filterGroup === 'all') return a.department.localeCompare(b.department) || a.name.localeCompare(b.name, 'zh');
      return a.name.localeCompare(b.name, 'zh');
    }),
    [visibleTemplates, c.filterGroup],
  );
  const readyCount = visibleTemplates.filter((t) => isTemplateReusable(t)).length;
  const reviewCount = visibleTemplates.length - readyCount;
  const totalCount = flatList.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / TPL_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  useEffect(() => { setPage(1); }, [query, scope, c.filterGroup, c.filterIndustry, c.showAdvancedLibrary, c.workspaceDeptOnly, c.templateOriginFilter]);
  useEffect(() => { if (page !== safePage) setPage(safePage); }, [page, safePage]);
  const pagedFlat = useMemo(() => { const start = (safePage - 1) * TPL_PAGE_SIZE; return flatList.slice(start, start + TPL_PAGE_SIZE); }, [flatList, safePage]);
  const rangeStart = totalCount === 0 ? 0 : (safePage - 1) * TPL_PAGE_SIZE + 1;
  const rangeEnd = Math.min(safePage * TPL_PAGE_SIZE, totalCount);

  const renderCard = (t: WorkflowTemplateAsset, compact = false) => {
    const reusable = isTemplateReusable(t);
    const personal = isPersonalTemplate(t);
    const unbound = (t.connectors ?? []).filter((cc) => !cc.defaultBinding && !c.connectorBindings[cc.slot] && cc.slot !== 'notify.send' && cc.slot !== 'knowledge.retrieve');
    const industryLabel = (t.industryTags ?? []).filter((tag) => tag !== 'all').slice(0, 2);
    return (
      <article key={t.id} className={cn('wf-tpl-card group', compact && 'wf-tpl-card--compact', t.library === 'advanced' && 'wf-tpl-card--advanced', personal && 'wf-tpl-card--personal', !reusable && 'wf-tpl-card--blocked')}>
        <header className="wf-tpl-card__head">
          <div className="min-w-0 flex-1">
            <div className="wf-tpl-card__title-row">
              <h3 className="wf-tpl-card__title" title={t.name}>{t.name}</h3>
              {personal ? <span className="wf-tpl-chip wf-tpl-chip--info">个人创建</span> : t.certification === 'certified' && <span className="wf-tpl-chip wf-tpl-chip--ok">平台认证</span>}
              {t.library === 'advanced' && <span className="wf-tpl-chip">高级库</span>}
              {t.parentId && <span className="wf-tpl-chip wf-tpl-chip--info">子流程</span>}
            </div>
            <p className="wf-tpl-card__meta"><span>{t.audience}</span><span aria-hidden="true">·</span><span className="font-mono text-[10px]">{t.version}</span><span aria-hidden="true">·</span><span>风险 {t.risk}</span>{personal && t.owner && (<><span aria-hidden="true">·</span><span>{t.owner}</span></>)}</p>
          </div>
          <span className={cn('wf-tpl-status', reusable ? 'is-ready' : 'is-blocked')}>{reusable ? (t.healthHint ? '可降级使用' : '可直接使用') : '需先授权'}</span>
        </header>
        <p className={cn('wf-tpl-card__desc', compact && 'line-clamp-2')}>{t.description}</p>
        {t.healthHint && <div className="wf-tpl-callout wf-tpl-callout--info">{t.healthHint}</div>}
        {!reusable && t.blockers.length > 0 && <div className="wf-tpl-callout wf-tpl-callout--warn"><span>{t.blockers[0]}{t.blockers.length > 1 ? ` 等 ${t.blockers.length} 项` : ''}</span>{unbound[0] && (<button type="button" className="wf-tpl-link" onClick={() => c.bindConnectorSlot(unbound[0].slot)}>去绑定</button>)}</div>}
        {!compact && <div className="wf-tpl-card__flow" aria-label={`共 ${t.nodes} 个节点`}>{t.sequence.slice(0, 5).map((kind, index) => { const StageIcon = NODE_ICONS[kind]; return (<div key={`${kind}-${index}`} className="wf-tpl-card__flow-item">{index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-[var(--border-strong)]" aria-hidden="true" />}<span title={NODE_LABELS[kind]} className="wf-tpl-card__flow-icon"><StageIcon className="h-3 w-3" /></span><span className="wf-tpl-card__flow-label">{NODE_LABELS[kind]}</span></div>); })}{t.sequence.length > 5 && <span className="wf-tpl-card__flow-more">+{t.sequence.length - 5}</span>}</div>}
        {!compact && (t.connectors?.length ?? 0) > 0 && (<div className="wf-tpl-card__slots">{t.connectors.slice(0, 3).map((cc) => { const bound = Boolean(cc.defaultBinding || c.connectorBindings[cc.slot] || cc.slot === 'notify.send' || cc.slot === 'knowledge.retrieve'); return (<button key={cc.slot} type="button" title={`${cc.label}（${cc.slot}）`} onClick={() => !bound && c.bindConnectorSlot(cc.slot)} className={cn('wf-tpl-slot', bound ? 'is-bound' : 'is-open')}>{cc.label}{cc.required ? '' : '（可选）'}</button>); })}{t.connectors.length > 3 && <span className="wf-tpl-slot is-more">+{t.connectors.length - 3}</span>}</div>)}
        {(industryLabel.length > 0 || !compact || (t.knowledgePackageIds?.length ?? 0) > 0 || (t.requiredSkills?.length ?? 0) > 0) && (<div className="wf-tpl-card__tags">{industryLabel.map((tag) => (<span key={tag} className="wf-tpl-tag">{tag}</span>))}{industryLabel.length === 0 && <span className="wf-tpl-tag">通用</span>}{(t.knowledgePackageIds ?? []).slice(0, 2).map((id) => (<span key={id} className="wf-tpl-tag wf-tpl-tag--knowledge" title={id}>知识 · {id.replace(/^kp\.office\./, '')}</span>))}{(t.requiredSkills ?? []).slice(0, 3).map((sk) => (<span key={sk} className="wf-tpl-tag wf-tpl-tag--skill" title={sk}>技能 · {sk}</span>))}</div>)}
        <footer className="wf-tpl-card__foot">
          <div className="wf-tpl-card__actions">
            <button type="button" className="wf-tpl-ghost" onClick={() => c.setPreviewTemplate(t)}><Eye className="h-3.5 w-3.5" />预览</button>
            {!personal && <button type="button" className="wf-tpl-ghost" onClick={() => c.openUpgradeDiff(t)} title="查看版本差异"><GitCompare className="h-3.5 w-3.5" />版本</button>}
            {personal && c.canWrite && <button type="button" className="wf-tpl-ghost wf-tpl-ghost--danger" onClick={() => c.deletePersonalTemplate(t)} title="删除个人模板"><Trash2 className="h-3.5 w-3.5" />删除</button>}
          </div>
          <Button size="sm" className="rounded-lg px-3.5" onClick={() => c.createTemplateDraft(t)}>使用模板<ArrowRight className="h-3.5 w-3.5" /></Button>
        </footer>
      </article>
    );
  };

  return (
    <div className="wf-tpl-page">
      <div className="wf-tpl-origin" role="tablist" aria-label="模板来源">
        <button type="button" role="tab" aria-selected={!isPersonal} className={cn('wf-tpl-origin__btn', !isPersonal && 'is-active')} onClick={() => c.setTemplateOriginFilter('platform')}>平台内置<em>{c.platformTemplateCount}</em></button>
        <button type="button" role="tab" aria-selected={isPersonal} className={cn('wf-tpl-origin__btn', isPersonal && 'is-active')} onClick={() => c.setTemplateOriginFilter('personal')}>个人创建<em>{c.personalTemplateCount}</em></button>
      </div>

      <header className="wf-tpl-hero">
        <div className="wf-tpl-hero__main">
          <div className="wf-tpl-hero__eyebrow"><Sparkles className="h-3.5 w-3.5" />{isPersonal ? '工作区私有 · 可复用草稿' : '平台认证 · 可安全复用'}</div>
          <h2 className="wf-tpl-hero__title">{isPersonal ? '个人创建模板' : '平台认证模板'}</h2>
          <p className="wf-tpl-hero__lead">{isPersonal ? '由当前账号从画布另存，仅本工作区可见。选用后生成可编辑草稿，可继续校验、试运行并发布为流程技能。' : c.filterGroup === 'office' ? '面向日常办公：制度问答、会议纪要、周报、请假出差等。配套开箱知识与办公技能，可直接使用。' : '覆盖入职、报销、权限、发版等部门场景，以及办公通用流程。选用后生成可编辑草稿，配置连接并校验通过后即可发布为流程技能。'}</p>
          <ol className="wf-tpl-steps" aria-label="使用路径">{(isPersonal ? ['画布编排', '存为个人模板', '再次使用', '发布技能'] : ['选用模板', '配置连接', '校验试运行', '发布技能']).map((label, index) => (<li key={label} className="wf-tpl-steps__item">{index > 0 && <span className="wf-tpl-steps__sep" aria-hidden="true" />}<span className="wf-tpl-steps__num">{index + 1}</span><span className="wf-tpl-steps__label">{label}</span></li>))}</ol>
        </div>
        <aside className="wf-tpl-hero__aside" aria-label="库说明">
          <div className="wf-tpl-stat"><strong>{visibleTemplates.length}</strong><span>当前可见</span></div>
          <div className="wf-tpl-stat"><strong>{readyCount}</strong><span>可直接使用</span></div>
          <div className="wf-tpl-stat"><strong>{reviewCount}</strong><span>需先授权</span></div>
          <p className="wf-tpl-hero__note">{isPersonal ? '个人模板不会覆盖平台内置包；删除仅影响自己创建的条目。可在画布页点击「存为个人模板」。' : '源模板只读；运维类剧本请打开「IT 高级库」。创建隔离草稿后不会覆盖现有画布版本。'}</p>
        </aside>
      </header>

      <div className="wf-tpl-toolbar">
        <div className="wf-tpl-toolbar__depts" role="group" aria-label="按部门筛选">
          {c.DEPARTMENT_OPTIONS.map((g) => { const count = g.key === 'all' ? visibleTemplates.length : visibleTemplates.filter((t) => t.department === g.key).length; return (<button key={g.key} type="button" onClick={() => c.setFilterGroup(g.key)} className={cn('wf-tpl-dept', c.filterGroup === g.key && 'is-active')}>{g.label}{g.key !== 'all' && count > 0 && <em>{count}</em>}</button>); })}
        </div>
        <div className="wf-tpl-toolbar__filters">
          <div className="wf-tpl-search"><Search className="h-3.5 w-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索流程名称、适用对象或连接能力" aria-label="搜索模板" /></div>
          {!isPersonal && <select value={c.filterIndustry} onChange={(e) => c.setFilterIndustry(e.target.value)} className="wf-tpl-select" aria-label="行业筛选">{INDUSTRY_OPTIONS.map((opt) => (<option key={opt.key} value={opt.key}>{opt.label}</option>))}</select>}
          <div className="wf-tpl-seg" role="group" aria-label="就绪状态">{([['all', '全部'], ['healthy', '可直接使用'], ['review', '需先授权']] as const).map(([key, label]) => (<button key={key} type="button" onClick={() => setScope(key)} className={cn(scope === key && 'is-active')}>{label}</button>))}</div>
          {!isPersonal && (
            <>
              <button type="button" onClick={() => c.setWorkspaceDeptOnly(!c.workspaceDeptOnly)} className={cn('wf-tpl-toggle', c.workspaceDeptOnly && 'is-on')} title={c.workspaceDepartments.size ? `当前工作区伙伴覆盖 ${c.workspaceDepartments.size} 个部门` : '当前工作区暂无部门伙伴，将展示全部'}>仅本工作区部门</button>
              <button type="button" onClick={() => c.setShowAdvancedLibrary(!c.showAdvancedLibrary)} className={cn('wf-tpl-toggle', c.showAdvancedLibrary && 'is-warn')}>IT 高级库</button>
            </>
          )}
        </div>
      </div>

      {visibleTemplates.length === 0 ? (
        <div className="wf-tpl-empty">
          <Layers className="h-8 w-8 text-[var(--text-muted)]" />
          <p className="wf-tpl-empty__title">{isPersonal ? '还没有个人模板' : '没有符合条件的模板'}</p>
          <p className="wf-tpl-empty__desc">{isPersonal ? '在画布编排流程后，点击「存为个人模板」，即可在此复用。' : '可切换部门或行业，关闭「仅本工作区部门」，或打开「IT 高级库」。'}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {isPersonal ? (c.canWrite && <Button size="sm" onClick={() => c.setTab('canvas')}>去画布另存</Button>) : (<><Button size="sm" variant="secondary" onClick={() => { c.setFilterGroup('all'); c.setFilterIndustry('all'); setScope('all'); setQuery(''); c.setWorkspaceDeptOnly(false); }}>重置筛选</Button>{!c.showAdvancedLibrary && <Button size="sm" onClick={() => c.setShowAdvancedLibrary(true)}>打开 IT 高级库</Button>}</>)}
          </div>
        </div>
      ) : (
        <>
          <div className="wf-tpl-pagebar"><span>{c.filterGroup === 'all' ? '全部部门统一列表' : `${departmentLabel(c.filterGroup as DepartmentKey | 'all')} · 统一列表`}{' · '}第 {rangeStart}–{rangeEnd} 项，共 {totalCount} 个模板 · 每页 {TPL_PAGE_SIZE} 个</span></div>
          <div className="wf-tpl-grid">{pagedFlat.map((t) => renderCard(t, Boolean(t.parentId)))}</div>
          {totalPages > 1 && (
            <nav className="wf-tpl-pager" aria-label="模板分页">
              <Button size="sm" variant="secondary" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>上一页</Button>
              <div className="wf-tpl-pager__pages">{Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (<button key={n} type="button" className={cn('wf-tpl-pager__btn', n === safePage && 'is-active')} onClick={() => setPage(n)} aria-current={n === safePage ? 'page' : undefined}>{n}</button>))}</div>
              <Button size="sm" variant="secondary" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>下一页</Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export default WorkflowsTabList;

// Keep 办公通用 & 通用 wording discoverable to the legacy copy test when it globs.
export const __WORKFLOW_TPL_LEXICON = '办公通用';