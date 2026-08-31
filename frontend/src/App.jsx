import { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginView from './views/LoginView';
import DashboardView from './views/DashboardView';
import QueueView from './views/QueueView';
import TicketDetailView from './views/TicketDetailView';
import SlaAlertsView from './views/SlaAlertsView';
import Navbar from './components/Navbar';
import DocsViewerModal from './components/DocsViewerModal';
import './index.css';

const ProtectedLayout = () => {
  const { isAuthenticated, loading } = useAuth();
  const [isDocsOpen, setIsDocsOpen] = useState(false);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        Loading authentication session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="app-container">
      <Navbar onOpenDocs={() => setIsDocsOpen(true)} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardView />} />
          <Route path="/queue" element={<QueueView />} />
          <Route path="/tickets/:id" element={<TicketDetailView />} />
          <Route path="/sla-alerts" element={<SlaAlertsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <DocsViewerModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<LoginView />} />
          <Route path="/*" element={<ProtectedLayout />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
