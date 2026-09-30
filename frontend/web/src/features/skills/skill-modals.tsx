import { useState } from 'react';
import { Button, Input } from '@qzda/web-ui';
import {
  Upload, Trash2, FileCode2, CheckCircle2, X,
} from 'lucide-react';
import { cn } from '@qzda/web-utils';
import { Modal } from '@/components/shared';
import { KIND_META, KIND_PROFILE, type SkillRow } from './skill-ui';

export function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] text-[var(--text-muted)] uppercase">{label}</div>
      <div className="text-[11px] font-mono font-semibold">{value}</div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'success' | 'error' }) {
  const color = tone === 'success' ? 'text-[var(--success)]' : tone === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text)]';
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2 text-center">
      <div className="text-[10px] text-[var(--text-muted)]">{label}</div>
      <div className={cn('text-base font-mono font-bold', color)}>{value}</div>
    </div>
  );
}

export function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-[var(--text-secondary)]">
        {label}{required && <span className="text-[var(--danger)]"> *</span>}
      </label>
      {children}
    </div>
  );
}

export function StoreSkillDetail({
  skill, detailTab, setDetailTab,
}: {
  skill: SkillRow;
  detailTab: 'overview' | 'access' | 'versions' | 'runtime';
  setDetailTab: (tab: 'overview' | 'access' | 'versions' | 'runtime') => void;
  onInstall?: () => void;
  canWrite?: boolean;
}) {
  const market = skill as SkillRow & {
    publisher?: string;
    signed?: boolean;
    license?: string;
    vulnerabilityCount?: number;
    supportedEnvironments?: string[];
    dependencies?: string[];
    lastScannedAt?: string;
  };
  const profile = KIND_PROFILE[skill.kind];
  const meta = KIND_META[skill.kind];
  const tabs = [
    { key: 'overview' as const, label: '能力概览' },
    { key: 'access' as const, label: '兼容与依赖' },
    { key: 'versions' as const, label: '安全与合规' },
    { key: 'runtime' as const, label: '安装记录' },
  ];
  const deps = market.dependencies ?? [];
  const envs = market.supportedEnvironments ?? ['待验证'];

  return (
    <div className="flex flex-col gap-5">
      <div className="skill-store-notice">
        <p>完成预检与安装后，才能分配给智能体或引用到工作流。</p>
      </div>

      <div className="skill-detail-tabs" role="tablist" aria-label="商店技能详情">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={detailTab === tab.key}
            onClick={() => setDetailTab(tab.key)}
            className={cn(detailTab === tab.key && 'is-active')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {detailTab === 'overview' && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title">{meta.label} 能力画像</div>
          <dl className="skill-detail-kv">
            <div><dt>能力形态</dt><dd>{profile.caption}</dd></div>
            <div><dt>发布方</dt><dd>{market.publisher ?? '社区发布方'}</dd></div>
            <div><dt>{profile.primaryLabel}</dt><dd>{profile.primaryValue}</dd></div>
            <div><dt>{profile.secondaryLabel}</dt><dd>{profile.secondaryValue}</dd></div>
            <div><dt>适用场景</dt><dd>{skill.description}</dd></div>
          </dl>
        </div>
      )}

      {detailTab === 'access' && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title">兼容性与依赖</div>
          <dl className="skill-detail-kv">
            <div><dt>适用环境</dt><dd>{envs.join('、')}</dd></div>
            <div><dt>运行形态</dt><dd>{profile.primaryValue}</dd></div>
            <div>
              <dt>依赖项</dt>
              <dd>
                {deps.length === 0 ? (
                  <span className="text-[var(--success)]">无额外依赖</span>
                ) : (
                  <ul className="m-0 list-none space-y-2 p-0">
                    {deps.map((dependency) => (
                      <li key={dependency} className="flex items-center justify-between gap-3">
                        <span className="font-mono">{dependency}</span>
                        <span className="shrink-0 text-[11px] text-[var(--text-muted)]">安装时校验</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {detailTab === 'versions' && (
        <div className="flex flex-col gap-4">
          <div className="skill-detail-panel">
            <div className="skill-detail-panel__title">供应链与合规</div>
            <dl className="skill-detail-kv">
              <div>
                <dt>签名</dt>
                <dd className={market.signed ? 'text-[var(--success)]' : 'text-[var(--danger)]'}>
                  {market.signed ? '已验证' : '未验证'}
                </dd>
              </div>
              <div><dt>许可证</dt><dd>{market.license ?? '待确认'}</dd></div>
              <div>
                <dt>漏洞</dt>
                <dd className={(market.vulnerabilityCount ?? 0) > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}>
                  {market.vulnerabilityCount ?? 0} 项
                </dd>
              </div>
              <div><dt>最近扫描</dt><dd>{market.lastScannedAt ?? '—'}</dd></div>
            </dl>
          </div>
          <p className="m-0 rounded-xl bg-[var(--info-bg)] px-4 py-3 text-[12px] leading-5 text-[var(--info)]">
            供应链信息将在安装预检时再次校验；生产环境以制品仓库与安全平台的签名、SBOM、扫描结果为准。
          </p>
        </div>
      )}

      {detailTab === 'runtime' && (
        <div className="skill-detail-panel">
          <div className="skill-detail-panel__title">安装与使用记录</div>
          <p className="m-0 text-[12px] leading-5 text-[var(--text-muted)]">
            尚未安装到当前工作区，暂无智能体引用、工作流引用、运行记录和治理审计。安装并分配后，记录会出现在启用清单的详情中。
          </p>
        </div>
      )}
    </div>
  );
}

export function ImportSkillModal({
  open, onClose, onSubmitText, onSubmitFile, uploading = false,
}: {
  open: boolean;
  onClose: () => void;
  onSubmitText: (raw: string) => void;
  onSubmitFile: (file: File) => void;
  uploading?: boolean;
}) {
  const [mode, setMode] = useState<'file' | 'text'>('file');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const acceptFile = (next?: File | null) => {
    if (!next) return;
    const name = next.name.toLowerCase();
    const ok = name.endsWith('.skill') || name.endsWith('.zip') || name.endsWith('.tgz') || name.endsWith('.tar.gz');
    if (!ok) {
      setFileError('仅支持 .skill / .zip / .tgz / .tar.gz');
      setFile(null);
      return;
    }
    if (next.size > 10 * 1024 * 1024) {
      setFileError('技能包不能超过 10 MB');
      setFile(null);
      return;
    }
    setFileError(null);
    setFile(next);
  };

  const valid = mode === 'file' ? Boolean(file) && !fileError : text.trim().length > 0;
  const busy = uploading;

  return (
    <Modal
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="导入技能"
      description="上传符合 Agent Skills 规范的 .skill / 压缩包，或粘贴 JSON / 名称列表"
      size="lg"
      footer={(
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>取消</Button>
          <Button
            disabled={!valid || busy}
            loading={busy}
            onClick={() => {
              if (mode === 'file' && file) onSubmitFile(file);
              else if (mode === 'text') { onSubmitText(text); setText(''); }
            }}
          >
            {busy ? '导入中…' : '导入'}
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <div className="flex gap-1 rounded-lg bg-[var(--bg-elevated)] p-1">
          <button type="button" className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-medium', mode === 'file' ? 'bg-[var(--surface-1)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]')} onClick={() => setMode('file')}>上传技能包</button>
          <button type="button" className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-medium', mode === 'text' ? 'bg-[var(--surface-1)] text-[var(--text)] shadow-sm' : 'text-[var(--text-muted)]')} onClick={() => setMode('text')}>粘贴文本</button>
        </div>

        {mode === 'file' ? (
          <div className="space-y-2">
            <label
              className={cn('knowledge-upload-dropzone', dragging && 'is-dragging', file && 'has-file')}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files?.[0]); }}
            >
              <span className="knowledge-upload-dropzone__icon"><Upload className="h-4 w-4" /></span>
              <span className="mt-2 text-xs font-medium text-[var(--text)]">拖拽或点击选择技能包</span>
              <span className="mt-1 text-[10px] text-[var(--text-muted)]">.skill · .zip · .tgz · .tar.gz · 最大 10 MB</span>
              <input
                type="file"
                accept=".skill,.zip,.tgz,.tar.gz,application/zip,application/gzip"
                className="hidden"
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
            </label>
            {file && (
              <div className="knowledge-upload-file">
                <span className="knowledge-upload-file__icon"><FileCode2 className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{file.name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB</div>
                </div>
                <button type="button" className="text-[10px] text-[var(--danger)]" onClick={() => setFile(null)}>移除</button>
              </div>
            )}
            {fileError && <p className="text-[10px] text-[var(--danger)]">{fileError}</p>}
            <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2.5 text-[10px] leading-5 text-[var(--text-muted)]">
              <div className="mb-1 font-medium text-[var(--text-secondary)]">包结构（Agent Skills）</div>
              <pre className="font-mono">{`my-skill.skill\n└── my-skill/\n    ├── SKILL.md      # 必填：YAML name/description\n    ├── scripts/      # 可选：可执行脚本\n    ├── references/\n    └── assets/`}</pre>
            </div>
          </div>
        ) : (
          <>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'# JSON 格式示例：\n{"name": "my-tool", "kind": "skill", "description": "...", "version": "0.1.0"}\n\n# 或每行一个名称：\nteam-redis-tool\nteam-k8s-helper'}
              className="h-48 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] p-2 font-mono text-[11px]"
            />
            <p className="text-[10px] text-[var(--text-muted)]">
              <FileCode2 className="mr-1 inline h-3 w-3" />
              支持 JSON 数组 / 对象 / 纯文本名称；生产环境请优先上传 .skill 包以便沙箱真实执行。
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

export function CapabilityConfigModal({
  open, onClose, kind, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  kind: 'MCP' | 'Tool';
  onSubmit: (form: { name: string; endpoint: string; authMode?: string; protocol?: string; schema?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [detail, setDetail] = useState(kind === 'MCP' ? 'OAuth' : '');
  const [protocol, setProtocol] = useState('mcp-streamable-http');
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const validateToolSchema = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      const isOpenApi = typeof parsed?.openapi === 'string' && typeof parsed?.info === 'object' && typeof parsed?.paths === 'object';
      const isJsonSchema = typeof parsed?.$schema === 'string' && (typeof parsed?.type === 'string' || typeof parsed?.properties === 'object');
      if (!isOpenApi && !isJsonSchema) return '仅支持标准 OpenAPI 3.x 或 JSON Schema Draft 文档';
      return null;
    } catch {
      return '文件不是有效的 JSON';
    }
  };
  const handleSchemaChange = (value: string, source?: string) => {
    setDetail(value);
    setFileName(source ?? null);
    setSchemaError(value.trim() ? validateToolSchema(value) : '请上传或粘贴 Schema');
  };
  const handleFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setSchemaError('JSON 文件不能超过 2 MB'); return; }
    if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') { setSchemaError('请上传 .json 格式文件'); return; }
    try { handleSchemaChange(await file.text(), file.name); } catch { setSchemaError('无法读取上传文件'); }
  };
  const protocolError = kind === 'MCP' && protocol === 'mcp-stdio' && endpoint.trim().startsWith('https://')
    ? 'stdio 适用于本地进程，远程 HTTPS 请改用 Streamable HTTP 或 SSE'
    : null;
  const valid = Boolean(
    name.trim()
    && endpoint.trim()
    && (kind !== 'MCP' || (protocol && !protocolError))
    && (kind === 'MCP' || (!schemaError && detail.trim())),
  );
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`配置 ${kind}`}
      description={kind === 'MCP' ? '保存后执行连接、认证和工具发现预检。' : '上传或粘贴标准契约文件，完成本地与服务端双重校验后接入。'}
      size="md"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button
            disabled={!valid}
            onClick={() => onSubmit(
              kind === 'MCP'
                ? { name: name.trim(), endpoint: endpoint.trim(), authMode: detail, protocol }
                : { name: name.trim(), endpoint: endpoint.trim(), schema: detail },
            )}
          >
            预检并接入
          </Button>
        </>
      )}
    >
      <div className="space-y-3">
        <Field label="名称" required><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'MCP' ? '例如：企业 GitLab MCP' : '例如：变更工单 API'} /></Field>
        <Field label={kind === 'MCP' ? '服务地址' : 'API 地址'} required><Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://service.example.com" /></Field>
        {kind === 'MCP' ? (
          <>
            <Field label="协议规范" required>
              <select
                value={protocol}
                onChange={(event) => setProtocol(event.target.value)}
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              >
                <option value="mcp-streamable-http">MCP Streamable HTTP（2025-03-26，推荐）</option>
                <option value="mcp-sse">MCP SSE（2024-11-05）</option>
                <option value="mcp-stdio">MCP stdio（本地进程）</option>
              </select>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                决定客户端如何与 MCP Server 握手与传讯；远程 HTTPS 服务优先 Streamable HTTP。
              </p>
              {protocolError && <p className="mt-1 text-[10px] text-[var(--danger)]">{protocolError}</p>}
            </Field>
            <Field label="认证方式">
              <select
                value={detail}
                onChange={(event) => setDetail(event.target.value)}
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs outline-none focus:border-[var(--brand)]"
              >
                <option value="OAuth">OAuth</option>
                <option value="API Key">API Key</option>
                <option value="mTLS">mTLS</option>
                <option value="None">None（仅内网）</option>
              </select>
            </Field>
          </>
        ) : (
          <Field label="OpenAPI / JSON Schema" required>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--bg-elevated)] px-3 py-2.5 text-xs transition-colors hover:border-[var(--brand)]">
                <span className="flex items-center gap-2"><Upload className="h-3.5 w-3.5 text-[var(--brand)]" />{fileName ? fileName : '上传标准 JSON 文件'}</span>
                <span className="text-[10px] text-[var(--text-muted)]">.json · 最大 2 MB</span>
                <input type="file" accept=".json,application/json" className="hidden" onChange={(event) => void handleFile(event.target.files?.[0])} />
              </label>
              <textarea value={detail} onChange={(event) => handleSchemaChange(event.target.value)} placeholder={'粘贴 OpenAPI 3.x 或 JSON Schema，例如：\n{"openapi":"3.0.3","info":{"title":"Tool"},"paths":{}}'} className="h-28 w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 font-mono text-[11px] outline-none focus:border-[var(--brand)]" />
              {schemaError ? <p className="text-[10px] text-[var(--danger)]">{schemaError}</p> : detail && <p className="text-[10px] text-[var(--success)]"><CheckCircle2 className="mr-1 inline h-3 w-3" />契约格式校验通过</p>}
            </div>
          </Field>
        )}
      </div>
    </Modal>
  );
}

export { X };
