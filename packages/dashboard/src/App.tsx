import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { I18nProvider } from './components/I18nProvider';
import { OverviewPage } from './pages/Overview';
import { ChatPage } from './pages/Chat';
import { ToolsPage } from './pages/Tools';
import { UsagePage } from './pages/Usage';
import { AuditPage } from './pages/Audit';
import { SettingsPage } from './pages/Settings';
import PluginStorePage from './pages/PluginStore';
import { ChannelsPage } from './pages/Channels';
import { AgentsPage } from './pages/Agents';
import { WorkspacePage } from './pages/Workspace';
import { GmailPage } from './pages/Gmail';
import { MemoryPage } from './pages/Memory';
import { ApiKeysPage } from './pages/ApiKeys';
import { WebhooksPage } from './pages/Webhooks';
import { CalendarPage } from './pages/Calendar';
import { VoicePage } from './pages/Voice';
import { RAGPage } from './pages/RAG';
import { CanvasPage } from './pages/Canvas';
import { RecordingsPage } from './pages/Recordings';
import { ActivityPage } from './pages/Activity';

export function App() {
  return (
    <I18nProvider>
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/usage" element={<UsagePage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/plugins" element={<PluginStorePage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/gmail" element={<GmailPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/api-keys" element={<ApiKeysPage />} />
        <Route path="/webhooks" element={<WebhooksPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/voice" element={<VoicePage />} />
        <Route path="/rag" element={<RAGPage />} />
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
      </Route>
    </Routes>
    </I18nProvider>
  );
}
