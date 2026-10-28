import { beforeEach, describe, expect, it } from 'vitest';
import { recordRecordingDiagnostic } from '@/lib/recording/diagnostics';

describe('development recording diagnostics', () => {
  beforeEach(() => {
    window.__SXS_RECORDING_DIAGNOSTICS__?.clear();
  });

  it('stores timestamped metrics only and supports local JSON export and reset', () => {
    recordRecordingDiagnostic('recorder.started', { startupLatencyMs: 82 });
    const api = window.__SXS_RECORDING_DIAGNOSTICS__;
    expect(api).toBeDefined();
    expect(api?.events).toHaveLength(1);
    expect(api?.events[0]).toMatchObject({ name: 'recorder.started', data: { startupLatencyMs: 82 } });
    expect(api?.events[0].at).toBeTruthy();
    expect(api?.exportJson()).toContain('startupLatencyMs');
    api?.clear();
    expect(api?.events).toHaveLength(0);
  });
});
