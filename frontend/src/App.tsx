import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineProvider } from './context/OfflineContext';
import { Layout, type MenuId } from './components/Layout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { VisitsAndRoutesPage } from './pages/VisitsAndRoutesPage';
import { StoresPage } from './pages/StoresPage';
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

  if (!user) return <LoginPage />;

  const renderPage = () => {
    switch (page) {
      case 'dashboard':
        return <DashboardPage onNavigate={setPage} />;
      case 'visitas':
        return <VisitsAndRoutesPage mode="visitas" />;
      case 'roteiros':
        return <VisitsAndRoutesPage mode="roteiros" />;
      case 'lojas':
        return <StoresPage />;
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
        return <DashboardPage onNavigate={setPage} />;
    }
  };

  return (
    <Layout activePage={page} onNavigate={setPage}>
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
