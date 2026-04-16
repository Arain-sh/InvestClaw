/**
 * React Application Entry Point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './i18n';
import './styles/globals.css';
import { initializeDefaultTransports } from './lib/api-client';
import { hasElectronBridge } from './lib/electron-bridge';

initializeDefaultTransports();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found');
}

const root = ReactDOM.createRoot(rootElement);

function formatStartupError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n\n${error.stack || ''}`.trim();
  }
  return String(error);
}

function renderStartupMessage(title: string, details: string): void {
  root.render(
    <React.StrictMode>
      <div style={{
        minHeight: '100vh',
        background: '#f4efe3',
        color: '#1f2937',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '32px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}>
        <div style={{
          maxWidth: '880px',
          width: '100%',
          background: 'rgba(255,255,255,0.72)',
          border: '1px solid rgba(17,24,39,0.12)',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 18px 48px rgba(17,24,39,0.10)',
        }}>
          <h1 style={{ fontSize: '22px', margin: '0 0 12px', fontFamily: 'Georgia, serif' }}>{title}</h1>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            fontSize: '13px',
            lineHeight: 1.55,
          }}>{details}</pre>
        </div>
      </div>
    </React.StrictMode>,
  );
}

window.addEventListener('error', (event) => {
  console.error('Unhandled startup error:', event.error || event.message);
  renderStartupMessage('Renderer Startup Error', formatStartupError(event.error || event.message));
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled startup rejection:', event.reason);
  renderStartupMessage('Renderer Startup Rejection', formatStartupError(event.reason));
});

if (!hasElectronBridge()) {
  console.warn('[startup] Electron preload bridge is not available');
}

renderStartupMessage('AraInvest Is Starting', 'Loading renderer...');

void import('./App')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>,
    );
  })
  .catch((error) => {
    console.error('Failed to import App:', error);
    renderStartupMessage('Failed To Load AraInvest', formatStartupError(error));
  });
