/**
 * WorkflowsModals — 全部弹层（模板预览 / 升级 diff / 运行前校验 / 版本 diff /
 * 回滚确认 / 清空画布确认 / 右键菜单 / Toast）。
 */
import { Badge, Button } from '@qzda/web-ui';
import { ConfirmDialog, Drawer } from '@/components/shared';
import type { WorkflowsController } from './useWorkflowsController';
import { categoryLabel, templateSnapshot } from './WorkflowsShared';

export function WorkflowsModals({ c }: { c: WorkflowsController }) {
  return (
    <>
      {c.toast && <ToastToast c={c} />}
      <TemplatePreviewModal c={c} />
      <UpgradeDiffDrawer c={c} />
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

function TemplatePreviewModal({ c }: { c: WorkflowsController }) {
  if (!c.previewTemplate) return null;
  const tpl = c.previewTemplate;
  const snap = templateSnapshot(tpl);
  return (
    <Drawer open={Boolean(c.previewTemplate)} onClose={() => c.setPreviewTemplate(null)}>
      <div className="p-4 space-y-3 max-w-3xl" data-testid="wf-template-preview">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{tpl.name}</h2>
          <Badge tone={tpl.health === '需授权' ? 'error' : 'success'}>{tpl.health}</Badge>
        </header>
        <p className="text-sm">{tpl.description}</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-[var(--text-muted)]">部门：</span>{categoryLabel(tpl.category, tpl.departmentLabel ?? tpl.department)}</div>
          <div><span className="text-[var(--text-muted)]">版本：</span>v{tpl.version}</div>
          <div><span className="text-[var(--text-muted)]">节点数：</span>{tpl.nodes}</div>
          <div><span className="text-[var(--text-muted)]">风险：</span>{tpl.risk}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] mb-1">节点序列</div>
          <ul className="text-xs space-y-0.5">
            {snap.nodes.map((n) => <li key={n.id}><Badge tone="info">{n.data.kind}</Badge></li>)}
          </ul>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)] mb-1">依赖与授权</div>
          <ul className="text-xs space-y-0.5">
            {tpl.dependencyStatus.map((d) => (
              <li key={d.name}>
                <Badge tone={d.status === 'ready' ? 'success' : 'error'}>{d.status}</Badge> {d.name}{d.reason ? ` · ${d.reason}` : ''}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { c.createTemplateDraft(tpl); c.setPreviewTemplate(null); }}>创建隔离草稿</Button>
          <Button variant="outline" onClick={() => c.setPreviewTemplate(null)}>关闭</Button>
        </div>
      </div>
    </Drawer>
  );
}

function UpgradeDiffDrawer({ c }: { c: WorkflowsController }) {
  if (!c.upgradeDiff) return null;
  const { template, diff } = c.upgradeDiff;
  return (
    <Drawer open={Boolean(c.upgradeDiff)} onClose={() => c.setUpgradeDiff(null)}>
      <div className="p-4 space-y-3 max-w-2xl" data-testid="wf-upgrade-diff">
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">模板升级 · {template.name}</h2>
          <Badge tone={diff.available ? 'info' : 'error'}>{diff.available ? `v${diff.fromVersion} → v${diff.toVersion}` : '无升级'}</Badge>
        </header>
        {diff.available ? (
          <>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">新增节点</div>
              <ul className="text-xs space-y-0.5">
                {diff.sequenceAdded.map((item, i) => <li key={i}><Badge tone="info">{item}</Badge></li>)}
              </ul>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">移除节点</div>
              <ul className="text-xs space-y-0.5">
                {diff.sequenceRemoved.map((item, i) => <li key={i}><Badge tone="warn">{item}</Badge></li>)}
              </ul>
            </div>
            <div>
              <div className="text-xs text-[var(--text-muted)] mb-1">变更说明</div>
              <ul className="text-xs space-y-0.5">
                {diff.notes.map((note, i) => <li key={i}>{note}</li>)}
              </ul>
            </div>
          </>
        ) : <p className="text-xs">当前画布无可用升级。</p>}
        <div className="flex items-center gap-2">
          <Button onClick={() => c.createTemplateDraft(template)}>创建隔离草稿</Button>
          <Button variant="outline" onClick={() => c.setUpgradeDiff(null)}>关闭</Button>
        </div>
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
  return (
    <Drawer open={c.versionDiffOpen} onClose={() => c.setVersionDiffOpen(false)}>
      <div className="p-4 space-y-3 max-w-2xl">
        <h2 className="text-lg font-semibold">版本对比</h2>
        <p className="text-xs text-[var(--text-muted)]">请在版本中心选择基线进行对比。</p>
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
  return (
    <div
      className="wf-context-menu"
      style={{ position: 'fixed', top: y, left: x, zIndex: 9999 }}
      onClick={() => c.setContextMenu(null)}
    >
      <button type="button" onClick={() => { c.duplicateNode(nodeId); c.setContextMenu(null); }}>复制节点</button>
      <button type="button" onClick={() => { c.disableNode(nodeId); c.setContextMenu(null); }}>启用/禁用</button>
      <button type="button" onClick={() => { c.deleteNode(nodeId); c.setContextMenu(null); }}>删除</button>
    </div>
  );
}

export default WorkflowsModals;