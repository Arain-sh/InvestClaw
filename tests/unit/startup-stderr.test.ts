import { describe, expect, it } from 'vitest';
import { classifyGatewayStderrMessage } from '@electron/gateway/startup-stderr';

describe('classifyGatewayStderrMessage', () => {
  it('downgrades local loopback ws close-before-connect noise', () => {
    const result = classifyGatewayStderrMessage(
      '2026-04-15T16:29:56.647+08:00 [ws] closed before connect conn=a20 peer=127.0.0.1:58200->127.0.0.1:18789 remote=127.0.0.1 fwd=n/a origin=n/a host=localhost:18789 ua=n/a code=1006 reason=n/a',
    );

    expect(result.level).toBe('debug');
  });

  it('normalizes broken upstream object logging for whatsapp exits', () => {
    const result = classifyGatewayStderrMessage(
      '2026-04-15T18:16:21.071+08:00 [whatsapp] [default] channel exited: [object Object]',
    );

    expect(result.level).toBe('debug');
    expect(result.normalized).toContain('[details unavailable from upstream logger]');
  });

  it('downgrades noisy whatsapp reconnect lines', () => {
    const result = classifyGatewayStderrMessage(
      '2026-04-15T18:16:11.405+08:00 [whatsapp] Web connection closed (status 499). Retry 1/12 in 2.29s… (status=499)',
    );

    expect(result.level).toBe('debug');
  });

  it('downgrades noisy bonjour advertiser warnings', () => {
    const result = classifyGatewayStderrMessage(
      '2026-04-15T18:18:41.695+08:00 [bonjour] watchdog detected non-announced service; attempting re-advertise (gateway fqdn=Arain.local)',
    );

    expect(result.level).toBe('debug');
  });
});
