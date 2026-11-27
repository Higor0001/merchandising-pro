import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineProvider } from './context/OfflineContext';
import { ToastProvider } from './context/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout, MENU_ITEMS, type MenuId } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';

const VisitsAndRoutesPage = lazy(() =>
  import('./pages/VisitsAndRoutesPage').then((m) => ({ default: m.VisitsAndRoutesPage }))
);
const StoresPage = lazy(() => import('./pages/StoresPage').then((m) => ({ default: m.StoresPage })));
const StoreOperationalPage = lazy(() =>
  import('./pages/StoreOperationalPage').then((m) => ({ default: m.StoreOperationalPage }))
);
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const ReplenishmentPage = lazy(() =>
  import('./pages/ReplenishmentPage').then((m) => ({ default: m.ReplenishmentPage }))
);
const DisplayAndPlanogramPage = lazy(() =>
  import('./pages/DisplayAndPlanogramPage').then((m) => ({ default: m.DisplayAndPlanogramPage }))
);
const PricingAndCompetitorsPage = lazy(() =>
  import('./pages/PricingAndCompetitorsPage').then((m) => ({ default: m.PricingAndCompetitorsPage }))
);
const ExpiryAndInventoryPage = lazy(() =>
  import('./pages/ExpiryAndInventoryPage').then((m) => ({ default: m.ExpiryAndInventoryPage }))
);
const CampaignsAndOccurrencesPage = lazy(() =>
  import('./pages/CampaignsAndOccurrencesPage').then((m) => ({ default: m.CampaignsAndOccurrencesPage }))
);
const AIPage = lazy(() => import('./pages/AIPage').then((m) => ({ default: m.AIPage })));
const ReportsAndSettingsPage = lazy(() =>
  import('./pages/ReportsAndSettingsPage').then((m) => ({ default: m.ReportsAndSettingsPage }))
);

const VALID_PAGES = new Set<string>(MENU_ITEMS.map((m) => m.id));

function parseHashRoute(): { page: MenuId; storeId: number | null } {
  const hash = window.location.hash.replace(/^#\/?/, '').trim();
  if (hash.startsWith('loja/')) {
    const id = Number(hash.slice(5));
    if (Number.isFinite(id) && id > 0) return { page: 'lojas', storeId: id };
  }
  if (VALID_PAGES.has(hash)) {
    return { page: hash as MenuId, storeId: null };
  }
  return { page: 'dashboard', storeId: null };
}

const PageSkeleton: React.FC = () => (
  <div className="space-y-4 animate-pulse py-2">
    <div className="h-28 rounded-3xl bg-white border border-slate-200/80" />
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="h-24 rounded-2xl bg-white border border-slate-200/80" />
      <div className="h-24 rounded-2xl bg-white border border-slate-200/80" />
      <div className="h-24 rounded-2xl bg-white border border-slate-200/80" />
      <div className="h-24 rounded-2xl bg-white border border-slate-200/80" />
    </div>
    <div className="h-64 rounded-3xl bg-white border border-slate-200/80" />
  </div>
);

const AppContent: React.FC = () => {
  const { user } = useAuth();
  const initial = parseHashRoute();
  const [page, setPage] = useState<MenuId>(initial.page);
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(initial.storeId);

  useEffect(() => {
    const onHashChange = () => {
      const next = parseHashRoute();
      setPage(next.page);
      setSelectedStoreId(next.storeId);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (!user) return <LoginPage />;

  const isManager = user.role === 'admin' || user.role === 'supervisor';

  const handleNavigate = (nextPage: MenuId) => {
    setSelectedStoreId(null);
    setPage(nextPage);
    if (window.location.hash !== `#${nextPage}`) {
      window.location.hash = `#${nextPage}`;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleOpenStore = (storeId: number) => {
    setSelectedStoreId(storeId);
    if (window.location.hash !== `#loja/${storeId}`) {
      window.location.hash = `#loja/${storeId}`;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCloseStore = () => {
    setSelectedStoreId(null);
    if (window.location.hash !== `#${page}`) {
      window.location.hash = `#${page}`;
    }
  };

  const renderPage = () => {
    if (selectedStoreId !== null) {
      return <StoreOperationalPage storeId={selectedStoreId} onBack={handleCloseStore} />;
    }
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={handleNavigate} onOpenStore={handleOpenStore} />;
      case 'catalogo':
        return <CatalogPage />;
      case 'visitas':
        return <VisitsAndRoutesPage mode="visitas" onOpenStore={handleOpenStore} />;
      case 'roteiros':
        return <VisitsAndRoutesPage mode="roteiros" onOpenStore={handleOpenStore} />;
      case 'lojas':
        return <StoresPage onOpenStore={handleOpenStore} />;
      case 'abastecimento':
        return <ReplenishmentPage />;
      case 'exposicao':
        return <DisplayAndPlanogramPage mode="exposicao" />;
      case 'pontos-extras':
        return <DisplayAndPlanogramPage mode="pontos-extras" />;
      case 'planogramas':
        return <DisplayAndPlanogramPage mode="planogramas" />;
      case 'precificacao':
        return <PricingAndCompetitorsPage mode="precificacao" />;
      case 'concorrencia':
        return <PricingAndCompetitorsPage mode="concorrencia" />;
      case 'validades':
        return <ExpiryAndInventoryPage mode="validades" />;
      case 'estoque':
        return <ExpiryAndInventoryPage mode="estoque" />;
      case 'campanhas':
        return <CampaignsAndOccurrencesPage mode="campanhas" />;
      case 'rupturas':
        return <CampaignsAndOccurrencesPage mode="rupturas" />;
      case 'ocorrencias':
        return <CampaignsAndOccurrencesPage mode="ocorrencias" />;
      case 'ia':
        return <AIPage />;
      case 'relatorios':
        return isManager ? (
          <ReportsAndSettingsPage mode="relatorios" />
        ) : (
          <DashboardPage onNavigate={handleNavigate} onOpenStore={handleOpenStore} />
        );
      case 'configuracoes':
        return isManager ? (
          <ReportsAndSettingsPage mode="configuracoes" />
        ) : (
          <DashboardPage onNavigate={handleNavigate} onOpenStore={handleOpenStore} />
        );
      default:
        return <DashboardPage onNavigate={handleNavigate} onOpenStore={handleOpenStore} />;
    }
  };

  return (
    <Layout
      activePage={page}
      activeStoreContext={selectedStoreId !== null}
      onNavigate={handleNavigate}
      onOpenStore={handleOpenStore}
    >
      <Suspense fallback={<PageSkeleton />}>{renderPage()}</Suspense>
    </Layout>
  );
};

export function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <OfflineProvider>
            <AppContent />
          </OfflineProvider>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
