export const routePreloaders: Record<string, () => Promise<unknown>> = {
  '/home': () => import('@/features/dashboard/HomePage'),
  '/copilot': () => import('@/features/copilot/components/CopilotPage'),
  '/tasks': () => import('@/features/tasks/components/TasksPage'),
  '/partners/new': () => import('@/features/partners/components/PartnerCreatePage'),
  '/partners': () => import('@/features/partners/components/PartnersPage'),
  '/workflows': () => import('@/features/workflows/components/WorkflowsPage'),
  '/knowledge/new': () => import('@/features/knowledge/components/KnowledgeUploadPage'),
  '/knowledge/packages/new': () => import('@/features/knowledge/components/KnowledgePackageCreatePage'),
  '/knowledge/sources/new': () => import('@/features/knowledge/components/KnowledgeSourcePage'),
  '/knowledge': () => import('@/features/knowledge/components/KnowledgePage'),
  '/skills': () => import('@/features/skills/components/SkillsPage'),
  '/memory': () => import('@/features/memory/components/MemoryPage'),
  '/models/providers/new': () => import('@/features/models/components/ModelProviderCreatePage'),
  '/models': () => import('@/features/models/components/ModelsPage'),
  '/channels': () => import('@/features/channels/components/ChannelsPage'),
  '/settings': () => import('@/features/settings/components/SettingsPage'),
  '/workspaces': () => import('@/pages/Workspaces'),
};

export function preloadRoute(path: string) {
  const pathname = path.split('?')[0] ?? path;
  if (pathname !== '/partners/new' && pathname !== '/partners' && pathname.startsWith('/partners/')) {
    void import('@/features/partners/components/PartnerDetailPage');
    return;
  }
  if (pathname.startsWith('/workflows/templates/')) {
    void import('@/features/workflows/components/WorkflowTemplatePreviewPage');
    return;
  }
  if (pathname.startsWith('/knowledge/docs/')) {
    void import('@/features/knowledge/components/KnowledgeDocPage');
    return;
  }
  if (pathname === '/knowledge/packages/new') {
    void import('@/features/knowledge/components/KnowledgePackageCreatePage');
    return;
  }
  if (pathname.startsWith('/knowledge/packages/')) {
    void import('@/features/knowledge/components/KnowledgePackagePage');
    return;
  }
  if (pathname === '/knowledge/sources/new' || pathname.startsWith('/knowledge/sources/')) {
    void import('@/features/knowledge/components/KnowledgeSourcePage');
    return;
  }
  if (pathname === '/knowledge/new' || pathname.startsWith('/knowledge/new/')) {
    void import('@/features/knowledge/components/KnowledgeUploadPage');
    return;
  }
  if (pathname === '/models/providers/new') {
    void import('@/features/models/components/ModelProviderCreatePage');
    return;
  }
  if (pathname.startsWith('/models/providers/')) {
    void import('@/features/models/components/ModelProviderDetailPage');
    return;
  }
  const key = Object.keys(routePreloaders).find((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (!key) return;
  void routePreloaders[key]();
}
