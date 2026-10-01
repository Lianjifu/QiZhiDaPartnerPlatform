import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, type ReactNode } from 'react';
import { AppLayout } from './layouts/AppLayout';
import { ProtectedRoute } from './auth';
import { ToastHost, Spinner } from '@qzda/web-ui';
import { ErrorBoundary, RouteErrorBoundary } from './components/ErrorBoundary';
import { NotFound } from './pages/NotFound';
import { useAuthStore } from './stores/authStore';

const LoginPage = lazy(() => import('./auth/LoginPage'));
const Home = lazy(() => import('./features/dashboard/HomePage'));
const Copilot = lazy(() => import('./pages/Copilot'));
const CopilotShare = lazy(() => import('./pages/CopilotShare'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Workspaces = lazy(() => import('./pages/Workspaces'));
const DigitalPartners = lazy(() => import('./pages/Partners'));
const Workflows = lazy(() => import('./pages/Workflows'));
const WorkflowOrchestrationSession = lazy(() => import('./pages/WorkflowOrchestrationSession'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const Memory = lazy(() => import('./pages/Memory'));
const Skills = lazy(() => import('./pages/Skills'));
const Models = lazy(() => import('./pages/Models'));
const Channels = lazy(() => import('./pages/Channels'));
const Settings = lazy(() => import('./pages/Settings'));
const AuditCenter = lazy(() => import('./pages/AuditCenter'));
const ZeroTrust = lazy(() => import('./pages/ZeroTrust'));

function PageFallback() {
  return (
    <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
      <Spinner size={28} className="text-[var(--brand)]" />
    </div>
  );
}

/** 管理员统一进入平台设置对应 Tab；审计员保留独立治理页。 */
function AdminSettingsRedirect({ tab, children }: { tab: string; children: ReactNode }) {
  const role = useAuthStore((state) => state.user?.role);
  if (role === 'admin') return <Navigate to={`/settings?tab=${tab}`} replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary fallbackTitle="应用遇到问题">
      <a href="#main-content" className="skip-link">跳转到主内容</a>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/login" element={<ErrorBoundary><LoginPage /></ErrorBoundary>} />
          <Route path="/copilot/share/:token" element={<ErrorBoundary><CopilotShare /></ErrorBoundary>} />
          <Route
            element={
              <ProtectedRoute>
                <RouteErrorBoundary>
                  <AppLayout />
                </RouteErrorBoundary>
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Home /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/copilot" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Copilot /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/copilot/:id" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Copilot /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/tasks" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Tasks /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/workspaces" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><Workspaces /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/partners" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><DigitalPartners /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/workflows" element={<ProtectedRoute permission="workflow.read" roles={['user', 'admin', 'auditor']}><ErrorBoundary><Workflows /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/workflows/orchestration" element={<ProtectedRoute permission="workflow.read" roles={['user', 'admin']}><ErrorBoundary><WorkflowOrchestrationSession /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/workflows/orchestration/:sessionId" element={<ProtectedRoute permission="workflow.read" roles={['user', 'admin']}><ErrorBoundary><WorkflowOrchestrationSession /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/knowledge" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Knowledge /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/memory" element={<ProtectedRoute roles={['admin', 'auditor']}><ErrorBoundary><Memory /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/skills" element={<ProtectedRoute roles={['user', 'admin', 'auditor']}><ErrorBoundary><Skills /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/models" element={<ProtectedRoute permission="model.read" roles={['admin', 'auditor']}><ErrorBoundary><Models /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/channels" element={<ProtectedRoute permission="channel.read" roles={['admin']}><ErrorBoundary><Channels /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/governance" element={<ProtectedRoute roles={['admin']}><Navigate to="/settings?tab=access" replace /></ProtectedRoute>} />
            <Route
              path="/zero-trust"
              element={(
                <ProtectedRoute roles={['admin', 'auditor']}>
                  <AdminSettingsRedirect tab="zeroTrust">
                    <ErrorBoundary><ZeroTrust /></ErrorBoundary>
                  </AdminSettingsRedirect>
                </ProtectedRoute>
              )}
            />
            <Route
              path="/audit-center"
              element={(
                <ProtectedRoute roles={['admin', 'auditor']}>
                  <AdminSettingsRedirect tab="auditCenter">
                    <ErrorBoundary><AuditCenter /></ErrorBoundary>
                  </AdminSettingsRedirect>
                </ProtectedRoute>
              )}
            />
            <Route path="/settings/*" element={<ProtectedRoute roles={['admin']}><ErrorBoundary><Settings /></ErrorBoundary></ProtectedRoute>} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <ToastHost />
    </ErrorBoundary>
  );
}
