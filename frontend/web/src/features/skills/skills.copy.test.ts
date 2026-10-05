import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(fileURLToPath(import.meta.url));
const appSource = readFileSync(join(root, '../../App.tsx'), 'utf8');
const catalog = readFileSync(join(root, 'components/SkillsPage.tsx'), 'utf8');
const createPage = readFileSync(join(root, 'components/SkillsCreatePage.tsx'), 'utf8');
const detailPage = readFileSync(join(root, 'components/SkillsDetailPage.tsx'), 'utf8');
const catalogTab = readFileSync(join(root, 'components/SkillsTab.Catalog.tsx'), 'utf8');

describe('skills center IA', () => {
  it('registers create and detail routes before catalog', () => {
    expect(appSource).toContain('path="/skills/new"');
    expect(appSource).toContain('path="/skills/:id"');
    expect(appSource.indexOf('path="/skills/new"')).toBeLessThan(appSource.indexOf('path="/skills/:id"'));
    expect(appSource.indexOf('path="/skills/:id"')).toBeLessThan(appSource.indexOf('path="/skills" element'));
  });

  it('keeps catalog to assets and governance only', () => {
    expect(catalog).toContain("data-testid=\"page-skills\"");
    expect(catalog).toContain("navigate('/skills/new')");
    expect(catalog).toContain("技能资产");
    expect(catalog).toContain("运行治理");
    expect(catalog).toContain('/skills?filter=builtin');
    expect(catalog).not.toContain("selectTab('store')");
    expect(catalog).not.toContain("selectTab('integration')");
  });

  it('opens details as a page', () => {
    expect(catalogTab).toContain('skills-inventory-table');
    expect(catalogTab).not.toContain('knowledge-package-card');
    expect(catalogTab).toContain("kind === 'builtin' ? '内置'");
    expect(catalogTab).toContain('skillSourceLabel');
    expect(catalogTab).toContain('PlatformToolsWorkspace');
    expect(catalogTab).not.toContain("from './SkillsDetailModal'");
    expect(detailPage).toContain('page-skills-detail');
    expect(detailPage).toContain('概览与策略');
    expect(detailPage).toContain('权限');
    expect(detailPage).toContain('版本与发布');
    expect(detailPage).toContain('运行与审计');
    expect(detailPage).not.toContain('KnowledgeStudioRail');
    expect(detailPage).not.toContain('上一步');
    expect(detailPage).not.toContain('下一步');
  });

  it('create page covers upload, MCP, Tool and store', () => {
    expect(createPage).toContain('page-skills-create');
    expect(createPage).toContain('/api/skills/import');
    expect(createPage).toContain('/api/skills/import-package');
    expect(createPage).toContain('/api/mcp-connections');
    expect(createPage).toContain('/api/tools');
    expect(createPage).toContain("source === 'store'");
    expect(createPage).toContain('role="radiogroup"');
    expect(createPage).not.toContain('KnowledgeStudioRail');
    expect(createPage).not.toContain('上一步');
    expect(createPage).not.toContain('下一步');
  });
});
