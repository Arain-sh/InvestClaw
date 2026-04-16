/**
 * Root Application Component
 * Handles routing and global providers
 */
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { Component, Suspense, lazy, useEffect } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Toaster } from 'sonner';
import i18n from './i18n';
import { MainLayout } from './components/layout/MainLayout';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LoadingSpinner } from '@/components/common/LoadingSpinner';
import { useSettingsStore } from './stores/settings';
import { useGatewayStore } from './stores/gateway';
import { useProviderStore } from './stores/providers';
import { applyGatewayTransportPreference } from './lib/api-client';
import { getElectronBridge } from './lib/electron-bridge';

const Models = lazy(() => import('./pages/Models').then((module) => ({ default: module.Models })));
const Chat = lazy(() => import('./pages/Chat').then((module) => ({ default: module.Chat })));
const Agents = lazy(() => import('./pages/Agents').then((module) => ({ default: module.Agents })));
const Channels = lazy(() => import('./pages/Channels').then((module) => ({ default: module.Channels })));
const Skills = lazy(() => import('./pages/Skills').then((module) => ({ default: module.Skills })));
const Cron = lazy(() => import('./pages/Cron').then((module) => ({ default: module.Cron })));
const Settings = lazy(() => import('./pages/Settings').then((module) => ({ default: module.Settings })));
const Setup = lazy(() => import('./pages/Setup').then((module) => ({ default: module.Setup })));

function RouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="page-card-muted flex min-h-[180px] w-full max-w-md items-center justify-center p-10">
        <LoadingSpinner size="lg" />
      </div>
    </div>
  );
}

/**
 * Error Boundary to catch and display React rendering errors
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '40px',
          color: '#5b4732',
          background: '#f8f5ef',
          minHeight: '100vh',
          fontFamily: 'SF Pro Text, Helvetica Neue, Arial, sans-serif'
        }}>
          <h1 style={{ fontSize: '28px', marginBottom: '16px', fontFamily: 'Iowan Old Style, Georgia, serif', letterSpacing: '-0.04em' }}>
            Something went wrong
          </h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            background: 'rgba(255,255,255,0.84)',
            border: '1px solid rgba(49,35,14,0.08)',
            padding: '16px',
            borderRadius: '18px',
            fontSize: '14px'
          }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            style={{
              marginTop: '16px',
              padding: '10px 18px',
              background: '#156c4f',
              color: 'white',
              border: 'none',
              borderRadius: '999px',
              cursor: 'pointer'
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const initSettings = useSettingsStore((state) => state.init);
  const theme = useSettingsStore((state) => state.theme);
  const language = useSettingsStore((state) => state.language);
  const setupComplete = useSettingsStore((state) => state.setupComplete);
  const initGateway = useGatewayStore((state) => state.init);
  const initProviders = useProviderStore((state) => state.init);

  useEffect(() => {
    initSettings();
  }, [initSettings]);

  // Sync i18n language with persisted settings on mount
  useEffect(() => {
    if (language && language !== i18n.language) {
      i18n.changeLanguage(language);
    }
  }, [language]);

  // Initialize Gateway connection on mount
  useEffect(() => {
    initGateway();
  }, [initGateway]);

  // Initialize provider snapshot on mount
  useEffect(() => {
    initProviders();
  }, [initProviders]);

  // Redirect to setup wizard if not complete
  useEffect(() => {
    if (!setupComplete && !location.pathname.startsWith('/setup')) {
      navigate('/setup');
    }
  }, [setupComplete, location.pathname, navigate]);

  // Listen for navigation events from main process
  useEffect(() => {
    const electron = getElectronBridge();
    if (!electron?.ipcRenderer?.on) {
      console.warn('[app] Electron navigation bridge is unavailable');
      return;
    }

    const handleNavigate = (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') {
        navigate(path);
      }
    };

    const unsubscribe = electron.ipcRenderer.on('navigate', handleNavigate);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigate]);

  // Apply theme
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    applyGatewayTransportPreference();
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={300}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* Setup wizard (shown on first launch) */}
            <Route path="/setup/*" element={<Setup />} />

            {/* Main application routes */}
            <Route element={<MainLayout />}>
              <Route path="/" element={<Chat />} />
              <Route path="/models" element={<Models />} />
              <Route path="/agents" element={<Agents />} />
              <Route path="/channels" element={<Channels />} />
              <Route path="/skills" element={<Skills />} />
              <Route path="/cron" element={<Cron />} />
              <Route path="/settings/*" element={<Settings />} />
            </Route>
          </Routes>
        </Suspense>

        {/* Global toast notifications */}
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          style={{ zIndex: 99999 }}
        />
      </TooltipProvider>
    </ErrorBoundary>
  );
}

export default App;
