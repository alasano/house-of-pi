import { describe, expect, it } from 'vitest';
import { normalizeEtaSettings } from '../extensions/settings';

describe('pi-eta settings', () => {
  const defaults = {
    verbose: false,
    calibrationMode: 'blended',
    profileSampleThreshold: 3,
  } as const;

  it('defaults to quiet blended calibration', () => {
    expect(normalizeEtaSettings(undefined)).toEqual(defaults);
    expect(normalizeEtaSettings({})).toEqual(defaults);
    expect(normalizeEtaSettings({ verbose: 'yes' })).toEqual(defaults);
  });

  it('accepts every calibration mode and a valid profile threshold', () => {
    for (const calibrationMode of ['blended', 'profile', 'global', 'profile-threshold'] as const) {
      expect(
        normalizeEtaSettings({ verbose: true, calibrationMode, profileSampleThreshold: 12 }),
      ).toEqual({ verbose: true, calibrationMode, profileSampleThreshold: 12 });
    }
  });

  it('normalizes invalid calibration settings independently', () => {
    expect(
      normalizeEtaSettings({
        verbose: true,
        calibrationMode: 'automatic',
        profileSampleThreshold: 0,
      }),
    ).toEqual({ ...defaults, verbose: true });
    expect(normalizeEtaSettings({ profileSampleThreshold: 2.5 })).toEqual(defaults);
  });

  it('rejects the superseded model-scoped mode and threshold keys', () => {
    expect(normalizeEtaSettings({ calibrationMode: 'model' })).toEqual(defaults);
    expect(normalizeEtaSettings({ calibrationMode: 'model-threshold' })).toEqual(defaults);
    expect(normalizeEtaSettings({ modelSampleThreshold: 12 })).toEqual(defaults);
  });
});
