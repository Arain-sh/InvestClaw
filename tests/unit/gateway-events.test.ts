import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doUnmock('@/stores/chat');
  });

  it('subscribes to host events through subscribeHostEvent on init', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:status', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:error', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:notification', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:chat-message', expect.any(Function));
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    handlers.get('gateway:status')?.({ state: 'stopped', port: 18789 });
    expect(useGatewayStore.getState().status.state).toBe('stopped');
  });

  it('keeps the current run pending until history reload completes after a completed notification', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const chatState = {
      currentSessionKey: 'agent:main:main',
      sessions: [{ key: 'agent:main:main' }],
      activeRunId: 'run-1',
      sending: true,
      pendingFinal: false,
      lastUserMessageAt: 123,
      loadSessions: vi.fn(),
      loadHistory: vi.fn(),
      handleChatEvent: vi.fn(),
    };

    const setChatState = vi.fn((patch: Record<string, unknown>) => {
      Object.assign(chatState, patch);
    });

    vi.doMock('@/stores/chat', () => ({
      useChatStore: {
        getState: () => chatState,
        setState: setChatState,
      },
    }));

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        phase: 'completed',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chatState.loadHistory).toHaveBeenCalledWith(true);
    expect(setChatState).toHaveBeenCalledWith({ pendingFinal: true });
    expect(chatState.sending).toBe(true);
    expect(chatState.activeRunId).toBe('run-1');
  });
});
