import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(root, '../../App.tsx'), 'utf8');
const catalog = readFileSync(join(root, 'components/ModelsPage.tsx'), 'utf8');
const createPage = readFileSync(join(root, 'components/ModelProviderCreatePage.tsx'), 'utf8');
const detailPage = readFileSync(join(root, 'components/ModelProviderDetailPage.tsx'), 'utf8');

describe('model service IA', () => {
  it('splits catalog, provider create and provider detail routes', () => {
    expect(appSource).toContain('/models/providers/new');
    expect(appSource).toContain('/models/providers/:id');
    expect(createPage).toContain('page-models-provider-create');
    expect(detailPage).toContain('page-models-provider-detail');
  });

  it('opens dedicated pages from catalog access actions', () => {
    expect(catalog).toContain('/models/providers/new');
    expect(catalog).toContain('/models/providers/');
    expect(catalog).not.toContain("setProviderModal('new')");
    expect(catalog).not.toContain('c.setProviderModal(id)');
  });

  it('keeps routing on provider create/detail, not as a catalog tab', () => {
    expect(catalog).not.toContain("key: 'routing'");
    expect(catalog).not.toContain('ModelsTabRouting');
    expect(createPage).toContain('模型路由策略');
    expect(createPage).toContain('ModelsModalsCreatePolicy');
    expect(detailPage).toContain('配置路由策略');
  });
});
