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
      className="flex h-screen min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(255,255,255,0)_18rem),radial-gradient(circle_at_bottom_right,rgba(220,230,245,0.48),rgba(220,230,245,0)_24rem),linear-gradient(180deg,#f4f7fb_0%,#e8eef5_100%)]"
    >
      {/* Title bar: drag region on macOS, icon + controls on Windows */}
      <TitleBar />

      {/* Below the title bar: sidebar + content */}
      <div className="flex min-h-0 flex-1 overflow-hidden p-2.5 md:p-3">
        <div className="app-shell-panel flex min-h-0 flex-1 overflow-hidden rounded-[1.7rem] border border-slate-300/40 bg-white/48 backdrop-blur-[18px]">
        <Sidebar />
        <main
          data-testid="main-content"
          className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.52),rgba(246,249,253,0.72))]"
        >
          <Outlet />
        </main>
        </div>
      </div>
    </div>
  );
}
