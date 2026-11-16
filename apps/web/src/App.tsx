import { Route, Routes } from 'react-router-dom';
import { RedirectIfAuth, RequireAuth } from './auth/RouteGuards';
import { Layout } from './components/Layout';
import { AlertsPage } from './pages/AlertsPage';
import { DashboardPage } from './pages/DashboardPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { MonitorsPage } from './pages/MonitorsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicStatusPage } from './pages/PublicStatusPage';
import { RegisterPage } from './pages/RegisterPage';
import { StatusSettingsPage } from './pages/StatusSettingsPage';

export function App() {
  return (
    <Routes>
      {/* Página pública fora do layout autenticado. */}
      <Route path="status/:slug" element={<PublicStatusPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route
          path="entrar"
          element={
            <RedirectIfAuth>
              <LoginPage />
            </RedirectIfAuth>
          }
        />
        <Route
          path="cadastro"
          element={
            <RedirectIfAuth>
              <RegisterPage />
            </RedirectIfAuth>
          }
        />
        <Route
          path="painel"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="monitores"
          element={
            <RequireAuth>
              <MonitorsPage />
            </RequireAuth>
          }
        />
        <Route
          path="alertas"
          element={
            <RequireAuth>
              <AlertsPage />
            </RequireAuth>
          }
        />
        <Route
          path="pagina-de-status"
          element={
            <RequireAuth>
              <StatusSettingsPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
