import { lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { I18nProvider } from './i18n/I18nProvider';
import { AuthProvider, useAuth } from './lib/auth';
import { ConnectivityProvider } from './lib/connectivity';
import { ModelProvider } from './model/ModelProvider';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import ResultPage from './pages/ResultPage';
import TriageWizard from './pages/TriageWizard';
import { SyncProvider } from './triage/SyncProvider';

// Dashboards (and Recharts) load on demand, keeping the triage path small. The service worker
// precaches these chunks too, so they still open offline.
const HealthWorkerPage = lazy(() => import('./pages/HealthWorkerPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const SessionDetailPage = lazy(() => import('./pages/SessionDetailPage'));
const PatientPage = lazy(() => import('./pages/PatientPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

function Home() {
  const { user } = useAuth();
  const to = { patient: '/triage', health_worker: '/hw', doctor: '/review', admin: '/admin' }[
    user?.role ?? 'patient'
  ];
  return <Navigate to={to} replace />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<Home />} />
          <Route path="triage" element={<TriageWizard />} />
          <Route path="result/:clientId" element={<ResultPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="hw" element={<HealthWorkerPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="patients/:id" element={<PatientPage />} />
          <Route path="me" element={<PatientPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ConnectivityProvider>
        <AuthProvider>
          <ModelProvider>
            <SyncProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </SyncProvider>
          </ModelProvider>
        </AuthProvider>
      </ConnectivityProvider>
    </I18nProvider>
  );
}
