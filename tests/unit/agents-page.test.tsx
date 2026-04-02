import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Agents } from '../../src/pages/Agents/index';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const fetchAgentsMock = vi.fn();
const createAgentMock = vi.fn();
const deleteAgentMock = vi.fn();
const updateAgentMock = vi.fn();
const updateAgentWorkspaceMock = vi.fn();
const updateAgentModelMock = vi.fn();
const refreshProviderSnapshotMock = vi.fn();

const { gatewayState, agentsState, providersState } = vi.hoisted(() => ({
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    defaultModelRef: null as string | null,
    loading: false,
    error: null as string | null,
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    vendors: [] as Array<Record<string, unknown>>,
    defaultAccountId: '' as string,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: typeof agentsState & {
    fetchAgents: typeof fetchAgentsMock;
    createAgent: typeof createAgentMock;
    deleteAgent: typeof deleteAgentMock;
    updateAgent: typeof updateAgentMock;
    updateAgentWorkspace: typeof updateAgentWorkspaceMock;
    updateAgentModel: typeof updateAgentModelMock;
  }) => unknown) => {
    const state = {
      ...agentsState,
      fetchAgents: fetchAgentsMock,
      createAgent: createAgentMock,
      deleteAgent: deleteAgentMock,
      updateAgent: updateAgentMock,
      updateAgentWorkspace: updateAgentWorkspaceMock,
      updateAgentModel: updateAgentModelMock,
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState & {
    refreshProviderSnapshot: typeof refreshProviderSnapshotMock;
  }) => unknown) => {
    const state = {
      ...providersState,
      refreshProviderSnapshot: refreshProviderSnapshotMock,
    };
    return selector(state);
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('Agents page status refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.agents = [];
    agentsState.defaultModelRef = null;
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
    providersState.defaultAccountId = '';
    fetchAgentsMock.mockResolvedValue(undefined);
    createAgentMock.mockResolvedValue(undefined);
    deleteAgentMock.mockResolvedValue(undefined);
    updateAgentMock.mockResolvedValue(undefined);
    updateAgentWorkspaceMock.mockResolvedValue(undefined);
    updateAgentModelMock.mockResolvedValue(undefined);
    refreshProviderSnapshotMock.mockResolvedValue(undefined);
    hostApiFetchMock.mockResolvedValue({
      success: true,
      channels: [],
    });
  });

  it('refetches channel accounts when gateway channel-status events arrive', async () => {
    let channelStatusHandler: (() => void) | undefined;
    subscribeHostEventMock.mockImplementation((eventName: string, handler: () => void) => {
      if (eventName === 'gateway:channel-status') {
        channelStatusHandler = handler;
      }
      return vi.fn();
    });

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });
    expect(subscribeHostEventMock).toHaveBeenCalledWith('gateway:channel-status', expect.any(Function));

    await act(async () => {
      channelStatusHandler?.();
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('refetches channel accounts when the gateway transitions to running after mount', async () => {
    gatewayState.status = { state: 'starting', port: 18789 };

    const { rerender } = render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/accounts');
    });

    gatewayState.status = { state: 'running', port: 18789 };
    await act(async () => {
      rerender(<Agents />);
    });

    await waitFor(() => {
      const channelFetchCalls = hostApiFetchMock.mock.calls.filter(([path]) => path === '/api/channels/accounts');
      expect(channelFetchCalls).toHaveLength(2);
    });
  });

  it('uses "Use default model" as form fill only and disables it when already default', async () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'claude-opus-4.6',
        modelRef: 'openrouter/anthropic/claude-opus-4.6',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:desk',
        channelTypes: [],
      },
    ];
    agentsState.defaultModelRef = 'openrouter/anthropic/claude-opus-4.6';
    providersState.accounts = [
      {
        id: 'openrouter-default',
        label: 'OpenRouter',
        vendorId: 'openrouter',
        authMode: 'api_key',
        model: 'openrouter/anthropic/claude-opus-4.6',
        enabled: true,
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'openrouter-default', hasKey: true }];
    providersState.vendors = [
      { id: 'openrouter', name: 'OpenRouter', modelIdPlaceholder: 'anthropic/claude-opus-4.6' },
    ];
    providersState.defaultAccountId = 'openrouter-default';

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTitle('settings'));
    fireEvent.click(screen.getByText('settingsDialog.modelLabel').closest('button') as HTMLButtonElement);

    const useDefaultButton = await screen.findByRole('button', { name: 'settingsDialog.useDefaultModel' });
    const modelIdInput = screen.getByLabelText('settingsDialog.modelIdLabel');
    const saveButton = screen.getByTestId('agents-model-save-button');

    expect(useDefaultButton).toBeDisabled();

    fireEvent.change(modelIdInput, { target: { value: 'anthropic/claude-sonnet-4.5' } });
    expect(useDefaultButton).toBeEnabled();
    expect(saveButton).toBeEnabled();

    fireEvent.click(useDefaultButton);

    expect(updateAgentModelMock).not.toHaveBeenCalled();
    expect((modelIdInput as HTMLInputElement).value).toBe('anthropic/claude-opus-4.6');
    expect(useDefaultButton).toBeDisabled();
  });

  it('passes the custom workspace path when creating an agent', async () => {
    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('agents-add-button'));
    fireEvent.change(screen.getByLabelText('createDialog.nameLabel'), { target: { value: 'Research Agent' } });
    fireEvent.change(screen.getByTestId('agents-create-workspace-input'), {
      target: { value: '/tmp/investclaw-agent-workspace' },
    });

    fireEvent.click(screen.getByTestId('agents-add-save-button'));

    await waitFor(() => {
      expect(createAgentMock).toHaveBeenCalledWith('Research Agent', {
        inheritWorkspace: false,
        workspace: '/tmp/investclaw-agent-workspace',
      });
    });
  });

  it('loads workspace explorer data and saves a changed workspace path', async () => {
    agentsState.agents = [
      {
        id: 'alpha',
        name: 'Alpha',
        isDefault: false,
        modelDisplay: 'gpt-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '/tmp/alpha-workspace',
        agentDir: '~/.openclaw/agents/alpha/agent',
        mainSessionKey: 'agent:alpha:desk',
        channelTypes: [],
      },
    ];

    hostApiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/channels/accounts') {
        return Promise.resolve({ success: true, channels: [] });
      }
      if (path === '/api/agents/alpha/workspace') {
        return Promise.resolve({
          success: true,
          agentId: 'alpha',
          agentName: 'Alpha',
          configuredPath: '/tmp/alpha-workspace',
          hostPath: '/tmp/alpha-workspace',
          containerRoot: '/workspace',
          exists: true,
          currentRelativePath: '',
          currentHostPath: '/tmp/alpha-workspace',
          currentContainerPath: '/workspace',
          parentRelativePath: null,
          entries: [
            {
              name: 'README.md',
              kind: 'file',
              relativePath: 'README.md',
              hostPath: '/tmp/alpha-workspace/README.md',
              containerPath: '/workspace/README.md',
              extension: '.md',
              size: 42,
              modifiedAt: '2026-04-02T00:00:00.000Z',
            },
          ],
        });
      }
      if (path === '/api/agents/alpha/workspace/file?path=README.md') {
        return Promise.resolve({
          success: true,
          agentId: 'alpha',
          agentName: 'Alpha',
          configuredPath: '/tmp/alpha-workspace',
          containerRoot: '/workspace',
          exists: true,
          name: 'README.md',
          relativePath: 'README.md',
          hostPath: '/tmp/alpha-workspace/README.md',
          containerPath: '/workspace/README.md',
          extension: '.md',
          mimeType: 'text/markdown',
          size: 42,
          modifiedAt: '2026-04-02T00:00:00.000Z',
          kind: 'text',
          content: '# Alpha',
          truncated: false,
        });
      }
      throw new Error(`Unexpected hostApiFetch path: ${path}`);
    });

    render(<Agents />);

    await waitFor(() => {
      expect(fetchAgentsMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('agents-card-settings-alpha'));
    expect(await screen.findByTestId('agents-settings-modal')).toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('agents-workspace-tab'));

    expect(await screen.findByTestId('agents-workspace-explorer')).toBeInTheDocument();
    expect(await screen.findByText('README.md')).toBeInTheDocument();

    fireEvent.click(screen.getByText('README.md'));
    expect(await screen.findByTestId('agents-workspace-preview')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('agents-workspace-path-input'), {
      target: { value: '/tmp/alpha-workspace-next' },
    });
    fireEvent.click(screen.getByTestId('agents-workspace-save-button'));

    await waitFor(() => {
      expect(updateAgentWorkspaceMock).toHaveBeenCalledWith('alpha', '/tmp/alpha-workspace-next');
    });
  });
});
