/**
 * 新建知识包：只创建资料，成功后进入包详情纳入内容。
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Boxes } from 'lucide-react';
import { Button } from '@qzda/web-ui';
import type { KnowledgePackage } from '@qzda/web-types';
import { useKnowledgeController } from './useKnowledgeController';
import { KnowledgeStudioRail } from './KnowledgeStudioRail';
import { PackageIdentityForm } from './KnowledgePackageIdentity';
import { roleCanMutate } from '@/features/role-nav/role-nav';
import { useAuthStore } from '@/stores/authStore';

import { PACKAGE_LIFECYCLE_STEPS } from '@/features/knowledge/knowledge-ui';

const STEPS = PACKAGE_LIFECYCLE_STEPS.map((item) => (
  item.key === 'info' ? { ...item, key: 'create', label: '基本信息', hint: '填写后即可创建' } : item
));

export default function KnowledgePackageCreatePage() {
  const c = useKnowledgeController();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const canWrite = roleCanMutate(useAuthStore((s) => s.user?.role)) && c.canWrite;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [domain, setDomain] = useState('SRE');
  const [classification, setClassification] = useState<KnowledgePackage['classification']>('internal');
  const existingId = params.get('id') ?? '';
  const busy = c.createPackageMutation.isPending;
  const valid = Boolean(name.trim() && canWrite);

  useEffect(() => {
    if (existingId) {
      navigate(`/knowledge/packages/${encodeURIComponent(existingId)}?step=members`, { replace: true });
    }
  }, [existingId, navigate]);

  const persist = async () => {
    if (!name.trim() || !canWrite) return;
    try {
      const item = await c.createPackageMutation.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        domain: domain.trim() || '通用',
        classification,
      });
      navigate(`/knowledge/packages/${encodeURIComponent(item.id)}?step=members`, { replace: true });
    } catch {
      /* onError 已提示 */
    }
  };

  return (
    <div className="de-partner-wizard wf-studio" data-testid="page-knowledge-package-create">
      <header className="de-partner-wizard__top">
        <div className="min-w-0">
          <Link to="/knowledge" className="de-partner-wizard__back"><ArrowLeft className="h-3.5 w-3.5" />返回知识中心</Link>
          <div className="mt-2 flex flex-wrap items-end gap-x-3">
            <h1>新建知识包</h1>
            <p>先创建包，再在包内上传文件或接入数据源，然后加工评测并发布。</p>
          </div>
        </div>
      </header>
      <div className="de-partner-wizard__body">
        <KnowledgeStudioRail
          sequential
          label="知识包交付路径"
          current="create"
          onSelect={(key) => {
            if (key === 'create') return;
          }}
          steps={STEPS.map((item) => ({
            ...item,
            status: item.key === 'create' ? '进行中' : '创建后继续',
          }))}
        />
        <section className="de-partner-wizard__main wf-studio__main knowledge-pkg-create-shell">
          <div className="h-full min-h-0 overflow-y-auto p-3 md:p-4">
            <PackageIdentityForm
              name={name}
              description={description}
              domain={domain}
              classification={classification}
              disabled={!canWrite}
              onName={setName}
              onDescription={setDescription}
              onDomain={setDomain}
              onClassification={setClassification}
            />
            <p className="knowledge-pkg-create__aside-note mt-3">
              <Boxes className="h-3.5 w-3.5" />
              创建后将打开知识包，在「添加内容」纳入文件或数据源。
            </p>
          </div>
        </section>
      </div>
      <footer className="wf-studio__foot">
        <Button variant="ghost" onClick={() => navigate('/knowledge')}>取消</Button>
        <Button disabled={!valid || busy} onClick={() => void persist()}>
          {busy ? '创建中…' : '创建并纳入内容'}
        </Button>
      </footer>
    </div>
  );
}
