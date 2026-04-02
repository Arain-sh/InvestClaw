export type RendererPlatform = NodeJS.Platform | 'unknown';

export function getElectronBridge() {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.electron;
}

export function getRendererPlatform(): RendererPlatform {
  return getElectronBridge()?.platform ?? 'unknown';
}

export function hasElectronBridge(): boolean {
  return !!getElectronBridge()?.ipcRenderer;
}
