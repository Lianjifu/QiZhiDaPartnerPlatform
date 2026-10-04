/**
 * WorkflowsModals — 全部弹层（使用模板 / 升级 diff / 运行前校验 / 版本 diff /
 * 回滚确认 / 清空画布确认 / 右键菜单 / Toast）。
 */
import { createPortal } from 'react-dom';
import { Copy, Power, Trash2 } from 'lucide-react';
import { Badge, Button } from '@qzda/web-ui';
import { ConfirmDialog, Drawer } from '@/components/shared';
import { computeVersionDiff } from '@/features/workflows/version-diff';
import { isTemplateReusable } from '@/features/workflows/department-templates';
import type { WorkflowsController } from './useWorkflowsController';
import { NODE_LABELS, formatWorkflowVersionLabel } from './WorkflowsShared';

export function WorkflowsModals({ c }: { c: WorkflowsController }) {
  return (
    <>
      {c.toast && <ToastToast c={c} />}
      <UpgradeDiffDrawer c={c} />
      <UseTemplateDrawer c={c} />
      <PreflightDrawer c={c} />
      <VersionDiffDrawer c={c} />
      <RollbackConfirm c={c} />
      <ClearCanvasConfirm c={c} />
      <NodeContextMenu c={c} />
    </>
  );
}

function ToastToast({ c }: { c: WorkflowsController }) {
  const toast = c.toast!;
  return (
    <div className={`wf-toast wf-toast--${toast.tone}`} data-testid="wf-toast">
      <span>{toast.msg}</span>
    </div>
  );
}

function UpgradeDiffDrawer({ c }: { c: WorkflowsController }) {
  if (!c.upgradeDiff) return null;
  const { template, diff } = c.upgradeDiff;
  const logs = [...(template.changelog ?? [])].sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return (
    <Drawer
      open
      onClose={() => c.setUpgradeDiff(null)}
      width={560}
      title={`模板版本 · ${template.name}`}
      description={diff.available ? `画布溯源 v${diff.fromVersion}，目录最新 v${diff.toVersion}` : `当前目录版本 v${template.version}`}
      footer={(
        <div className="wf-tpl-drawer__foot">
          <Button variant="outline" onClick={() => c.setUpgradeDiff(null)}>关闭</Button>
          <Button onClick={() => { c.setUpgradeDiff(null); c.setUseTemplate(template); }} disabled={!c.canWrite}>使用此版本</Button>
        </div>
      )}
    >
      <div className="wf-tpl-drawer" data-testid="wf-upgrade-diff">
        {diff.available ? (
          <div className="wf-tpl-drawer__callout">
            <strong>可升级</strong>
            <p>相对画布中的模板溯源，目录版本有更新。使用模板会按最新版本创建隔离草稿，不会覆盖已发布流程。</p>
            {(diff.sequenceAdded.length > 0 || diff.sequenceRemoved.length > 0 || diff.connectorAdded.length > 0) && (
              <ul>
                {diff.sequenceAdded.map((item) => <li key={`a-${item}`}>+ 节点 {NODE_LABELS[item as keyof typeof NODE_LABELS] ?? item}</li>)}
                {diff.sequenceRemoved.map((item) => <li key={`r-${item}`}>- 节点 {NODE_LABELS[item as keyof typeof NODE_LABELS] ?? item}</li>)}
                {diff.connectorAdded.map((item) => <li key={`c-${item}`}>+ 连接 {item}</li>)}
                {diff.connectorRemoved.map((item) => <li key={`d-${item}`}>- 连接 {item}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <p className="wf-tpl-drawer__hint">当前即为目录中的最新版本。下方为版本记录，便于核对变更说明。</p>
        )}
        <section>
          <h4>版本记录</h4>
          {logs.length === 0 ? <p className="wf-tpl-drawer__hint">暂无变更说明。</p> : (
            <ol className="wf-tpl-drawer__log">
              {logs.map((item) => (
                <li key={`${item.version}-${item.date}`}>
                  <strong>v{item.version}</strong>
                  <span>{item.date}</span>
                  <p>{item.note}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
        {diff.notes.length > 0 && (
          <section>
            <h4>相对当前的变更说明</h4>
            <ul className="wf-tpl-drawer__notes">
              {diff.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          </section>
        )}
      </div>
    </Drawer>
  );
}

function UseTemplateDrawer({ c }: { c: WorkflowsController }) {
  if (!c.useTemplate) return null;
  const tpl = c.useTemplate;
  const reusable = isTemplateReusable(tpl);
  const blockers = tpl.blockers?.length ? tpl.blockers : [];
  return (
    <Drawer
      open
      onClose={() => c.setUseTemplate(null)}
      width={520}
      title="使用模板"
      description={`将「${tpl.name}」创建为隔离草稿，写入流程编排画布。`}
      footer={(
        <div className="wf-tpl-drawer__foot">
          <Button variant="outline" onClick={() => c.setUseTemplate(null)}>取消</Button>
          <Button onClick={() => c.createTemplateDraft(tpl, { skipConfirm: true })} disabled={!c.canWrite}>创建隔离草稿</Button>
        </div>
      )}
    >
      <div className="wf-tpl-drawer" data-testid="wf-use-template">
        <div className="wf-tpl-drawer__kv">
          <div><span>模板</span><strong>{tpl.name}</strong></div>
          <div><span>版本</span><strong>v{tpl.version}</strong></div>
          <div><span>部门</span><strong>{tpl.departmentLabel}</strong></div>
          <div><span>风险</span><strong>{tpl.risk}</strong></div>
        </div>
        <p className="wf-tpl-drawer__lead">{tpl.description}</p>
        {c.isDirty && (
          <div className="wf-tpl-drawer__warn">当前画布有未保存修改。继续后会切换到新的隔离草稿，未保存内容仍可从版本管理找回最近保存的版本。</div>
        )}
        {!reusable && (
          <div className="wf-tpl-drawer__warn">
            依赖未就绪，仍可创建隔离草稿，但试运行与发布会被禁用。
            {blockers[0] ? ` ${blockers[0]}${blockers.length > 1 ? ` 等 ${blockers.length} 项` : ''}` : ''}
          </div>
        )}
        <ul className="wf-tpl-drawer__notes">
          <li>草稿溯源 {tpl.id}@{tpl.version}，不会覆盖线上已发布流程。</li>
          <li>创建后进入流程编排，可继续调整节点后再做运行前校验。</li>
          {tpl.healthHint ? <li>{tpl.healthHint}</li> : null}
        </ul>
      </div>
    </Drawer>
  );
}

function PreflightDrawer({ c }: { c: WorkflowsController }) {
  if (!c.preflightOpen) return null;
  const result = c.preflightResult;
  return (
    <Drawer open={c.preflightOpen} onClose={() => c.setPreflightOpen(false)}>
      <div className="p-4 space-y-3 max-w-2xl" data-testid="wf-preflight">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">运行前校验</h2>
          <Badge tone={result?.passed ? 'success' : 'error'}>{result?.passed ? '通过' : '未通过'}</Badge>
        </header>
        <ul className="text-xs space-y-1">
          {result && Object.entries(result.checks).map(([code, status]) => (
            <li key={code}><Badge tone={status === 'passed' ? 'success' : status === 'review' ? 'warn' : 'error'}>{status}</Badge> {code}</li>
          ))}
        </ul>
        {result && result.warnings && result.warnings.length > 0 && (
          <ul className="text-xs space-y-0.5">
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
        <div className="flex items-center gap-2 pt-2">
          <Button onClick={() => c.runWorkflowApi.mutate({ workflowId: c.workflowId })} disabled={!result?.passed || !c.canExecute}>进入沙箱运行</Button>
          <Button variant="outline" onClick={() => c.setPreflightOpen(false)}>关闭</Button>
        </div>
      </div>
    </Drawer>
  );
}

function VersionDiffDrawer({ c }: { c: WorkflowsController }) {
  if (!c.versionDiffOpen) return null;
  const selected = c.versions.find((v) => v.id === c.versionCenterSelectedId) ?? c.versions[0];
  const base = c.versions.find((v) => v.id === c.diffBaseId) ?? c.versions.find((v) => v.id !== selected?.id);
  const diff = selected && base && selected.id !== base.id ? computeVersionDiff(base, selected) : null;
  return (
    <Drawer open={c.versionDiffOpen} onClose={() => c.setVersionDiffOpen(false)}>
      <div className="p-4 space-y-3 max-w-2xl">
        <h2 className="text-lg font-semibold">版本对比</h2>
        <p className="text-xs text-[var(--text-muted)]">
          {base && selected ? `${formatWorkflowVersionLabel(base)} → ${formatWorkflowVersionLabel(selected)}` : '请在版本中心选择基线进行对比。'}
        </p>
        {diff ? (
          <div className="wf-versions__diff">
            <div className="wf-versions__diff-stats">
              <span>节点 <strong>+{diff.addedNodes.length}</strong> / <strong>-{diff.removedNodes.length}</strong> / <strong>~{diff.changedNodes.length}</strong></span>
              <span>连线 <strong>+{diff.addedEdges}</strong> / <strong>-{diff.removedEdges}</strong></span>
            </div>
            <ul className="wf-versions__diff-list">
              {diff.addedNodes.map((n) => <li key={`a-${n.id}`} className="is-add">+ {n.label} <code>{n.id}</code></li>)}
              {diff.removedNodes.map((n) => <li key={`d-${n.id}`} className="is-del">- {n.label} <code>{n.id}</code></li>)}
              {diff.changedNodes.map((n) => <li key={`c-${n.id}`} className="is-chg">~ {n.from} → {n.to}</li>)}
            </ul>
          </div>
        ) : <p className="text-xs text-[var(--text-muted)]">选择不同基线后即可查看差异。</p>}
        <Button variant="outline" onClick={() => c.setVersionDiffOpen(false)}>关闭</Button>
      </div>
    </Drawer>
  );
}

function RollbackConfirm({ c }: { c: WorkflowsController }) {
  if (!c.rollbackTargetId) return null;
  const version = c.versions.find((v) => v.id === c.rollbackTargetId);
  return (
    <ConfirmDialog
      open={Boolean(c.rollbackTargetId)}
      onClose={() => c.setRollbackTargetId(null)}
      title="回滚并生成新草稿"
      description={`将以版本 ${version?.label} 为基准生成新的草稿版本。当前画布修改将被覆盖。`}
      confirmText="回滚并生成新草稿"
      onConfirm={() => c.rollbackVersionApi.mutate({ workflowId: c.workflowId, versionId: c.rollbackTargetId! })}
    />
  );
}

function ClearCanvasConfirm({ c }: { c: WorkflowsController }) {
  return (
    <ConfirmDialog
      open={c.clearConfirmOpen}
      onClose={() => c.setClearConfirmOpen(false)}
      title="清空画布"
      description="当前画布将被清空。已发布版本与历史草稿不受影响。"
      confirmText="清空画布"
      onConfirm={() => c.confirmClearCanvas()}
    />
  );
}

function NodeContextMenu({ c }: { c: WorkflowsController }) {
  if (!c.contextMenu) return null;
  const { x, y, nodeId } = c.contextMenu;
  const node = c.nodes.find((n) => n.id === nodeId);
  const disabled = Boolean(node?.data?.disabled);
  const pad = 8;
  const menuW = 168;
  const menuH = 132;
  const left = Math.min(Math.max(pad, x + 4), window.innerWidth - menuW - pad);
  const top = Math.min(Math.max(pad, y + 4), window.innerHeight - menuH - pad);
  const close = () => c.setContextMenu(null);
  return createPortal(
    <>
      <div className="wf-context-menu__backdrop" onPointerDown={close} />
      <div
        className="wf-context-menu"
        role="menu"
        style={{ top, left }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button type="button" role="menuitem" onClick={() => { c.duplicateNode(nodeId); close(); }}>
          <Copy className="h-3.5 w-3.5" />复制节点
        </button>
        <button type="button" role="menuitem" onClick={() => { c.disableNode(nodeId); close(); }}>
          <Power className="h-3.5 w-3.5" />{disabled ? '启用' : '禁用'}
        </button>
        <button type="button" role="menuitem" className="is-danger" onClick={() => { c.deleteNode(nodeId); close(); }}>
          <Trash2 className="h-3.5 w-3.5" />删除
        </button>
      </div>
    </>,
    document.body,
  );
}

export default WorkflowsModals;