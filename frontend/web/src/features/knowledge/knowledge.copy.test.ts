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

describe('knowledge center IA', () => {
  it('splits catalog, upload studio, document and package detail routes', () => {
    expect(appSource).toContain('/knowledge/new');
    expect(appSource).toContain('/knowledge/sources/new');
    expect(appSource).toContain('/knowledge/docs/:id');
    expect(appSource).toContain('/knowledge/packages/new');
    expect(appSource).toContain('/knowledge/packages/:id');
    expect(source).toContain('page-knowledge');
    expect(source).toContain('page-knowledge-upload');
    expect(source).toContain('page-knowledge-source');
    expect(source).toContain('page-knowledge-doc');
    expect(source).toContain('page-knowledge-package-create');
    expect(source).toContain('page-knowledge-package');
  });

  it('requires a knowledge package on upload and keeps processing on package detail', () => {
    expect(source).toContain('归属知识包');
    expect(source).toContain('packageId');
    expect(source).toContain("key: 'processing'");
    expect(source).toContain("key: 'eval'");
    expect(source).toContain("key: 'graph'");
    expect(source).not.toContain("labelKey: 'module.knowledge.tabs.processing'");
  });

  it('keeps upload and data-source as catalog entries, not package-detail actions', () => {
    const catalogPage = readFileSync(join(root, 'components/KnowledgePage.tsx'), 'utf8');
    const packageSteps = readFileSync(join(root, 'components/KnowledgePackageSteps.tsx'), 'utf8');
    const packagePage = readFileSync(join(root, 'components/KnowledgePackagePage.tsx'), 'utf8');
    expect(catalogPage).toContain("接入数据源");
    expect(catalogPage).toContain("上传内容");
    expect(catalogPage).toContain('/knowledge/sources/new');
    expect(catalogPage).toContain('/knowledge/new');
    expect(source).toContain('提交并进入加工');
    expect(source).toContain('确认接入并进入加工');
    expect(source).not.toContain('改为接入数据源');
    expect(source).not.toContain('改为上传文件');
    expect(packageSteps).not.toContain('/knowledge/new');
    expect(packageSteps).not.toContain('/knowledge/sources/new');
    expect(packagePage).not.toContain('/knowledge/new');
    expect(packagePage).not.toContain('/knowledge/sources/new');
  });

  it('runs create wizard with upload and source ingest on later steps', () => {
    const createPage = readFileSync(join(root, 'components/KnowledgePackageCreatePage.tsx'), 'utf8');
    expect(createPage).toContain('创建并纳入内容');
    expect(createPage).toContain('上传到本包');
    expect(createPage).toContain('接入到本包');
    expect(createPage).toContain('KnowledgeUploadForm');
    expect(createPage).toContain('ConnectSourceFormView');
    expect(createPage).toContain("key: 'processing'");
    expect(createPage).toContain("key: 'eval'");
    expect(createPage).toContain("key: 'versions'");
  });

  it('keeps catalog as package discovery without inline process or publish', () => {
    expect(catalog).toContain('打开知识包');
    expect(catalog).not.toContain('启动加工');
    expect(catalog).not.toContain('onPublish');
  });
});
