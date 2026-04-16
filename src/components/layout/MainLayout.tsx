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
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f8f5ef_0%,#f5f1e8_100%)]"
    >
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex min-h-0 flex-1 gap-2 overflow-hidden p-2 md:gap-2.5 md:p-2.5">
        <Sidebar />
        <main
          data-testid="main-content"
          className="app-shell-panel flex min-w-0 flex-1 flex-col overflow-hidden rounded-[2.05rem]"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
