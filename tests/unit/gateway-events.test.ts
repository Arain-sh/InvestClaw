import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const handleChatEventMock = vi.fn();
const loadSessionsMock = vi.fn();
const loadHistoryMock = vi.fn();
const chatSetStateMock = vi.fn();
const chatState = {
  currentSessionKey: 'agent:main:main',
  sessions: [{ key: 'agent:main:main' }],
  activeRunId: null as string | null,
  sending: false,
  pendingFinal: false,
  lastUserMessageAt: null as number | null,
  handleChatEvent: handleChatEventMock,
  loadSessions: loadSessionsMock,
  loadHistory: loadHistoryMock,
};

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: {
    getState: () => chatState,
    setState: (patch: Record<string, unknown>) => {
      chatSetStateMock(patch);
      Object.assign(chatState, patch);
    },
  },
}));

describe('gateway store event wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    chatState.currentSessionKey = 'agent:main:main';
    chatState.sessions = [{ key: 'agent:main:main' }];
    chatState.activeRunId = null;
    chatState.sending = false;
    chatState.pendingFinal = false;
    chatState.lastUserMessageAt = null;
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

  it('normalizes terminal agent failures into chat error events', async () => {
    hostApiFetchMock.mockResolvedValueOnce({ state: 'running', port: 18789 });

    const handlers = new Map<string, (payload: unknown) => void>();
    subscribeHostEventMock.mockImplementation((eventName: string, handler: (payload: unknown) => void) => {
      handlers.set(eventName, handler);
      return () => {};
    });

    const { useGatewayStore } = await import('@/stores/gateway');
    await useGatewayStore.getState().init();

    handlers.get('gateway:notification')?.({
      method: 'agent',
      params: {
        phase: 'completed',
        runId: 'run-1',
        sessionKey: 'agent:main:main',
        isError: true,
        error: 'LLM request failed: network connection error',
        rawError: 'fetch failed',
      },
    });

    await vi.waitFor(() => {
      expect(handleChatEventMock).toHaveBeenCalled();
    });

    expect(handleChatEventMock).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      sessionKey: 'agent:main:main',
      state: 'error',
      isError: true,
      errorMessage: expect.stringContaining('LLM request failed: network connection error'),
    }));
    expect(handleChatEventMock).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: expect.stringContaining('fetch failed'),
    }));
  });
});
