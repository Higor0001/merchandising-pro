import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineProvider } from './context/OfflineContext';
import { Layout, type MenuId } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { VisitsAndRoutesPage } from './pages/VisitsAndRoutesPage';
import { StoresPage } from './pages/StoresPage';
import { StoreOperationalPage } from './pages/StoreOperationalPage';
import { ReplenishmentPage } from './pages/ReplenishmentPage';
import { DisplayAndPlanogramPage } from './pages/DisplayAndPlanogramPage';
import { PricingAndCompetitorsPage } from './pages/PricingAndCompetitorsPage';
import { ExpiryAndInventoryPage } from './pages/ExpiryAndInventoryPage';
import { CampaignsAndOccurrencesPage } from './pages/CampaignsAndOccurrencesPage';
import { AIPage } from './pages/AIPage';
import { ReportsAndSettingsPage } from './pages/ReportsAndSettingsPage';

const AppContent: React.FC = () => {
  const { user } = useAuth();
  const [page, setPage] = useState<MenuId>('dashboard');
  const [selectedStoreId, setSelectedStoreId] = useState<number | null>(null);

  if (!user) return <LoginPage />;

  const handleNavigate = (nextPage: MenuId) => {
    setSelectedStoreId(null);
    setPage(nextPage);
  };

  const renderPage = () => {
    if (selectedStoreId !== null) {
      return <StoreOperationalPage storeId={selectedStoreId} onBack={() => setSelectedStoreId(null)} />;
    }
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={handleNavigate} onOpenStore={setSelectedStoreId} />;
      case 'visitas':
        return <VisitsAndRoutesPage mode="visitas" onOpenStore={setSelectedStoreId} />;
      case 'roteiros':
        return <VisitsAndRoutesPage mode="roteiros" onOpenStore={setSelectedStoreId} />;
      case 'lojas':
        return <StoresPage onOpenStore={setSelectedStoreId} />;
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
        return <ReportsAndSettingsPage mode="relatorios" />;
      case 'configuracoes':
        return <ReportsAndSettingsPage mode="configuracoes" />;
      default:
        return <DashboardPage onNavigate={handleNavigate} onOpenStore={setSelectedStoreId} />;
    }
  };

  return (
    <Layout activePage={page} onNavigate={handleNavigate}>
      {renderPage()}
    </Layout>
  );
};

export function App() {
  return (
    <AuthProvider>
      <OfflineProvider>
        <AppContent />
      </OfflineProvider>
    </AuthProvider>
  );
}

export default App;
