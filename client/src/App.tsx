import { lazy, type ReactNode, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { GuestLayout } from './components/GuestLayout';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { I18nProvider } from './i18n/I18nProvider';
import { AuthProvider, useAuth } from './lib/auth';
import { ConnectivityProvider } from './lib/connectivity';
import { ModelProvider } from './model/ModelProvider';
import HistoryPage from './pages/HistoryPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import ForgotPasswordPage from './pages/ForgotPasswordPage';
import GuestResultPage from './pages/GuestResultPage';
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
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const RegisterPatientPage = lazy(() => import('./pages/RegisterPatientPage'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (!user) return <Navigate to="/login" replace />;
  // A temporary password must be replaced before anything else.
  if (user.mustChangePassword && pathname !== '/change-password')
    return <Navigate to="/change-password" replace />;
  return <>{children}</>;
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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        {/* Triage without an account: same wizard, result kept only on this device. */}
        <Route path="/guest" element={<GuestLayout />}>
          <Route index element={<TriageWizard guest />} />
          <Route path="result/:clientId" element={<GuestResultPage />} />
        </Route>
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
          <Route path="change-password" element={<ChangePasswordPage />} />
          <Route path="hw" element={<HealthWorkerPage />} />
          <Route path="hw/register" element={<RegisterPatientPage />} />
          <Route path="review" element={<ReviewPage />} />
          <Route path="sessions/:id" element={<SessionDetailPage />} />
          <Route path="patients/:id" element={<PatientPage />} />
          <Route path="me" element={<PatientPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="admin/users" element={<AdminUsersPage />} />
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
