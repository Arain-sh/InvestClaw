/**
 * Main Layout Component
 * TitleBar at top, then sidebar + content below.
 */
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';

export function MainLayout() {
  return (
    <div
      data-testid="main-layout"
      className="app-root-shell flex h-screen min-h-0 flex-col overflow-hidden"
    >
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-2.5 md:p-3">
        <div className="app-shell-panel flex min-h-0 flex-1 overflow-hidden rounded-[1.7rem]">
          <Sidebar />
          <main
            data-testid="main-content"
            className="app-content-surface flex min-w-0 flex-1 flex-col overflow-hidden"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
