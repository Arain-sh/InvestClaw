/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  const location = useLocation();
  const isChatRoute = location.pathname === '/';

  return (
    <div data-testid="main-layout" className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex flex-1 gap-3 overflow-hidden p-3 md:gap-4 md:p-4">
        <Sidebar />
        <main
          data-testid="main-content"
          className={`surface-panel flex-1 rounded-[2rem] border border-black/6 p-4 md:p-5 dark:border-white/10 ${isChatRoute ? 'overflow-hidden' : 'overflow-auto'}`}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
