import { describe, it, expect } from 'vitest';
import { TelemetryLogger } from '@/utils/telemetry/logger';

describe('TelemetryLogger', () => {
  it('stores and limits events', () => {
    const logger = new TelemetryLogger();
  for (let i=0;i<400;i++) logger.log('play', { info: 'ok 10ms' });
    expect(logger.getAll().length).toBeLessThanOrEqual(300);
  });
  it('exports bundle', () => {
    const logger = new TelemetryLogger();
    logger.log('play');
    const bundle = logger.exportBundle('chan1');
    expect(bundle.channelId).toBe('chan1');
    expect(bundle.events.length).toBe(1);
  });
});
