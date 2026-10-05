import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const source = [
  'components/KnowledgePage.tsx',
  'components/KnowledgeUploadPage.tsx',
  'components/KnowledgeSourcePage.tsx',
  'components/KnowledgeDocPage.tsx',
  'components/KnowledgePackageCreatePage.tsx',
  'components/KnowledgePackagePage.tsx',
  'components/KnowledgePackageSteps.tsx',
  'components/useKnowledgeController.ts',
  'components/KnowledgeTab.Packages.tsx',
].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const catalog = [
  'components/KnowledgePage.tsx',
  'components/KnowledgeTab.Packages.tsx',
  'components/PackageWorkbench.tsx',
].map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
const appSource = readFileSync(join(root, '../../App.tsx'), 'utf8');
const catalogPage = readFileSync(join(root, 'components/KnowledgePage.tsx'), 'utf8');
const packageSteps = readFileSync(join(root, 'components/KnowledgePackageSteps.tsx'), 'utf8');
const packagePage = readFileSync(join(root, 'components/KnowledgePackagePage.tsx'), 'utf8');
const createPage = readFileSync(join(root, 'components/KnowledgePackageCreatePage.tsx'), 'utf8');

describe('knowledge center IA', () => {
  it('keeps catalog, package create/detail and compatibility ingest routes', () => {
    expect(appSource).toContain('/knowledge/new');
    expect(appSource).toContain('/knowledge/sources/new');
    expect(appSource).toContain('/knowledge/docs/:id');
    expect(appSource).toContain('/knowledge/packages/new');
    expect(appSource).toContain('/knowledge/packages/:id');
    expect(source).toContain('page-knowledge');
    expect(source).toContain('page-knowledge-package-create');
    expect(source).toContain('page-knowledge-package');
    expect(source).toContain('page-knowledge-doc');
  });

  it('binds ingest to a package and keeps lifecycle steps on package detail', () => {
    expect(source).toContain('packageId');
    expect(packagePage).toContain('PACKAGE_LIFECYCLE_STEPS');
    expect(packagePage).toContain("step === 'info'");
    expect(packagePage).toContain("go('eval')");
    expect(packagePage).toContain("go('versions')");
    expect(source).not.toContain("labelKey: 'module.knowledge.tabs.processing'");
  });

  it('removes catalog ingest buttons; upload and source live on package members', () => {
    expect(catalogPage).toContain('新建知识包');
    expect(catalogPage).not.toContain('上传内容');
    expect(catalogPage).not.toContain('接入数据源');
    expect(catalogPage).not.toContain('/knowledge/sources/new');
    expect(catalogPage).not.toContain("navigate('/knowledge/new')");
    expect(packageSteps).toContain('上传到本包');
    expect(packageSteps).toContain('接入到本包');
    expect(packageSteps).toContain('KnowledgeUploadForm');
    expect(packageSteps).toContain('ConnectSourceFormView');
    expect(packageSteps).not.toContain('/knowledge/new');
    expect(packagePage).not.toContain('/knowledge/new');
    expect(packagePage).not.toContain('/knowledge/sources/new');
  });

  it('creates a package then opens detail for ingest', () => {
    expect(createPage).toContain('创建并纳入内容');
    expect(createPage).toContain('/knowledge/packages/');
    expect(createPage).toContain('step=members');
    expect(createPage).not.toContain('KnowledgeUploadForm');
  });

  it('redirects legacy ingest URLs onto package members or create', () => {
    const upload = readFileSync(join(root, 'components/KnowledgeUploadPage.tsx'), 'utf8');
    const sourcePage = readFileSync(join(root, 'components/KnowledgeSourcePage.tsx'), 'utf8');
    expect(upload).toContain('Navigate');
    expect(upload).toContain('step=members');
    expect(sourcePage).toContain('ingest=source');
  });

  it('keeps catalog as package discovery without inline process or publish', () => {
    expect(catalog).toContain('打开知识包');
    expect(catalog).not.toContain('启动加工');
    expect(catalog).not.toContain('onPublish');
  });
});
