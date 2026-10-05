/**
 * 接入能力：上传技能包 / MCP / Tool / 从商店安装。成功后进入技能详情。
 */
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Network, Sparkles, Upload, Wrench } from 'lucide-react';
import { Button, Input } from '@qzda/web-ui';
import { cn } from '@qzda/web-utils';
import type { Skill } from '@qzda/web-types';
import { useApiMutation } from '@/services/query';
import { useAuthStore } from '@/stores/authStore';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { CatalogStoreView } from './SkillsTab.CatalogStore';
import { Field } from './SkillsModals';
import type { SkillRow } from './SkillsShared';

type Source = 'skill' | 'mcp' | 'tool' | 'store';

function parseSource(raw: string | null): Source {
  if (raw === 'mcp' || raw === 'tool' || raw === 'store' || raw === 'platform') return raw === 'platform' ? 'store' : raw;
  return 'skill';
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const comma = text.indexOf(',');
      resolve(comma >= 0 ? text.slice(comma + 1) : text);
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export default function SkillsCreatePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const canWrite = Boolean(user?.permissions.includes('skill.write')) && roleCanMutate(user?.role);
  const isAdmin = user?.role === 'admin';
  const source = parseSource(params.get('source'));
  const [error, setError] = useState<string | null>(null);

  const [skillName, setSkillName] = useState('');
  const [skillKind, setSkillKind] = useState<Skill['kind']>('skill');
  const [skillDesc, setSkillDesc] = useState('');
  const [skillJson, setSkillJson] = useState('');
  const [skillFile, setSkillFile] = useState<File | null>(null);

  const [mcpName, setMcpName] = useState('');
  const [mcpEndpoint, setMcpEndpoint] = useState('https://');
  const [mcpAuth, setMcpAuth] = useState('OAuth');
  const [mcpProtocol, setMcpProtocol] = useState('mcp-streamable-http');

  const [toolName, setToolName] = useState('');
  const [toolEndpoint, setToolEndpoint] = useState('https://');
  const [toolSchema, setToolSchema] = useState('{\n  "openapi": "3.0.0"\n}');

  const [installedRows, setInstalledRows] = useState<SkillRow[]>([]);

  const importMutation = useApiMutation<Skill[], { items: Array<Partial<Skill>> }>(() => '/api/skills/import');
  const importPackageMutation = useApiMutation<Skill, { fileName: string; contentBase64: string }>(() => '/api/skills/import-package');
  const mcpMutation = useApiMutation<Skill, { name: string; endpoint: string; authMode: string; protocol: string }>(() => '/api/mcp-connections');
  const toolMutation = useApiMutation<Skill, { name: string; endpoint: string; schema: string }>(() => '/api/tools');

  const go = (next: Source) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set('source', next);
    setParams(nextParams, { replace: true });
    setError(null);
  };

  const afterCreate = (skill: Skill | Skill[] | undefined) => {
    const item = Array.isArray(skill) ? skill[0] : skill;
    if (!item?.id) {
      setError('接入成功，但未返回技能编号');
      return;
    }
    navigate(`/skills/${item.id}?step=overview`, { replace: true });
  };

  const submitSkill = async () => {
    if (!canWrite) return;
    setError(null);
    try {
      if (skillFile) {
        const contentBase64 = await fileToBase64(skillFile);
        importPackageMutation.mutate(
          { fileName: skillFile.name, contentBase64 },
          { onSuccess: afterCreate, onError: (e) => setError(e instanceof Error ? e.message : '导入技能包失败') },
        );
        return;
      }
      let items: Array<Partial<Skill>> = [];
      if (skillJson.trim()) {
        const parsed = JSON.parse(skillJson);
        items = Array.isArray(parsed) ? parsed : parsed.items ?? [parsed];
      } else if (skillName.trim()) {
        items = [{ name: skillName.trim(), kind: skillKind, description: skillDesc.trim() || `导入技能 · ${skillName.trim()}` }];
      }
      if (!items.length) {
        setError('请填写技能名称，或粘贴 JSON，或选择技能包文件');
        return;
      }
      importMutation.mutate(
        { items },
        { onSuccess: afterCreate, onError: (e) => setError(e instanceof Error ? e.message : '导入失败') },
      );
    } catch {
      setError('JSON 格式不正确');
    }
  };

  const submitMcp = () => {
    if (!canWrite) return;
    setError(null);
    mcpMutation.mutate(
      { name: mcpName.trim(), endpoint: mcpEndpoint.trim(), authMode: mcpAuth, protocol: mcpProtocol },
      { onSuccess: afterCreate, onError: (e) => setError(e instanceof Error ? e.message : 'MCP 接入失败') },
    );
  };

  const submitTool = () => {
    if (!canWrite) return;
    setError(null);
    toolMutation.mutate(
      { name: toolName.trim(), endpoint: toolEndpoint.trim(), schema: toolSchema },
      { onSuccess: afterCreate, onError: (e) => setError(e instanceof Error ? e.message : 'Tool 接入失败') },
    );
  };

  const pending = importMutation.isPending || importPackageMutation.isPending || mcpMutation.isPending || toolMutation.isPending;

  const sourceCards = useMemo(() => ([
    { key: 'skill' as const, icon: Upload, title: '上传技能包', desc: '导入已有 Skill 制品' },
    { key: 'mcp' as const, icon: Network, title: '接入 MCP', desc: '连接远程 MCP 服务' },
    { key: 'tool' as const, icon: Wrench, title: '接入 Tool', desc: '用 Schema 注册工具' },
    { key: 'store' as const, icon: Sparkles, title: '从商店安装', desc: '预检后安装到工作区' },
  ]), []);

  return (
    <div className="de-partner-wizard" data-testid="page-skills-create">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/skills" className="de-partner-wizard__back">
            <ArrowLeft className="h-3.5 w-3.5" />技能资产
          </Link>
          <h1>接入能力</h1>
          <p>任选一种方式接入。四种来源彼此独立，选中后直接填写并提交，成功后进入该技能详情。</p>
        </div>
      </header>
      <div className="de-partner-wizard__body de-partner-wizard__body--single">
        <div className="min-w-0 overflow-y-auto p-4 md:p-5">
          <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4" role="radiogroup" aria-label="接入方式">
            {sourceCards.map((card) => {
              const Icon = card.icon;
              const selected = source === card.key;
              return (
                <button
                  key={card.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={cn(
                    'rounded-xl border p-3 text-left',
                    selected ? 'border-[var(--brand)] bg-[var(--brand-light)]' : 'border-[var(--border)] bg-[var(--surface-1)]',
                  )}
                  onClick={() => go(card.key)}
                >
                  <Icon className="mb-2 h-4 w-4 text-[var(--brand)]" />
                  <strong className="block text-[13px]">{card.title}</strong>
                  <span className="mt-1 block text-[11px] text-[var(--text-muted)]">{card.desc}</span>
                </button>
              );
            })}
          </div>
          {error && <p className="mb-3 text-xs text-[var(--danger)]">{error}</p>}

          {source === 'skill' && (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
              <Field label="技能名称">
                <Input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="例如：变更窗口检查" />
              </Field>
              <Field label="类型">
                <select value={skillKind} onChange={(e) => setSkillKind(e.target.value as Skill['kind'])} className="de-employee-input h-9 w-full rounded-lg px-2 text-xs">
                  <option value="skill">Skill</option>
                  <option value="mcp">MCP</option>
                  <option value="tool">Tool</option>
                </select>
              </Field>
              <Field label="说明">
                <Input value={skillDesc} onChange={(e) => setSkillDesc(e.target.value)} placeholder="可选" />
              </Field>
              <Field label="技能包文件">
                <input type="file" accept=".skill,.zip,.tgz,.tar.gz" onChange={(e) => setSkillFile(e.target.files?.[0] ?? null)} className="text-xs" />
              </Field>
              <Field label="或粘贴 JSON">
                <textarea value={skillJson} onChange={(e) => setSkillJson(e.target.value)} rows={6} className="de-employee-input w-full rounded-lg p-2 font-mono text-[11px]" placeholder='{"name":"...","kind":"skill"}' />
              </Field>
            </section>
          )}

          {source === 'mcp' && (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
              <Field label="MCP 名称">
                <Input value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="metrics-mcp" />
              </Field>
              <Field label="HTTPS 地址">
                <Input value={mcpEndpoint} onChange={(e) => setMcpEndpoint(e.target.value)} placeholder="https://mcp.example.com" />
              </Field>
              <Field label="认证">
                <Input value={mcpAuth} onChange={(e) => setMcpAuth(e.target.value)} />
              </Field>
              <Field label="协议">
                <select value={mcpProtocol} onChange={(e) => setMcpProtocol(e.target.value)} className="de-employee-input h-9 w-full rounded-lg px-2 text-xs">
                  <option value="mcp-streamable-http">Streamable HTTP</option>
                  <option value="mcp-sse">SSE</option>
                </select>
              </Field>
            </section>
          )}

          {source === 'tool' && (
            <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
              <Field label="Tool 名称">
                <Input value={toolName} onChange={(e) => setToolName(e.target.value)} />
              </Field>
              <Field label="HTTPS 地址">
                <Input value={toolEndpoint} onChange={(e) => setToolEndpoint(e.target.value)} placeholder="https://api.example.com" />
              </Field>
              <Field label="Schema（OpenAPI 3 或 JSON Schema）">
                <textarea value={toolSchema} onChange={(e) => setToolSchema(e.target.value)} rows={10} className="de-employee-input w-full rounded-lg p-2 font-mono text-[11px]" />
              </Field>
            </section>
          )}

          {source === 'store' && (
            <section className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-4">
              <CatalogStoreView
                installedRows={installedRows}
                setInstalledRows={setInstalledRows}
                canWrite={canWrite}
                isAdmin={isAdmin}
                onNotice={setError}
                onInstalled={(skill) => navigate(`/skills/${skill.id}?step=overview`, { replace: true })}
                initialStorePage={1}
                initialStoreSearchQ=""
                initialStoreRiskFilter="all"
                initialStoreChannelFilter="all"
                initialStoreReleaseFilter="all"
                initialCertifiedOnly={false}
                initialTypeFilter="all"
                onTypeFilterChange={() => undefined}
                onStorePageChange={() => undefined}
              />
            </section>
          )}
        </div>
      </div>
      <footer className="de-partner-wizard__footer">
        <Button variant="ghost" onClick={() => navigate('/skills')}>取消</Button>
        <div className="ml-auto flex gap-2">
          {source === 'skill' && <Button disabled={!canWrite || pending} onClick={() => void submitSkill()}>导入并进入详情</Button>}
          {source === 'mcp' && <Button disabled={!canWrite || pending} onClick={submitMcp}>接入并进入详情</Button>}
          {source === 'tool' && <Button disabled={!canWrite || pending} onClick={submitTool}>接入并进入详情</Button>}
        </div>
      </footer>
    </div>
  );
}
