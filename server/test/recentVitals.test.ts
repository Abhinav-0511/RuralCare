import { describe, expect, it } from 'vitest';
import { mostAbnormal } from '../src/vitals/recent';

describe('mostAbnormal', () => {
  it('prefers the reading with the most severe alert', () => {
    expect(mostAbnormal('spo2', { last: 98, min: 86, max: 98 })).toBe(86);
    expect(mostAbnormal('temperatureC', { last: 37, min: 36.8, max: 39.6 })).toBe(39.6);
    expect(mostAbnormal('heartRate', { last: 80, min: 36, max: 125 })).toBe(36);
    expect(mostAbnormal('heartRate', { last: 80, min: 45, max: 160 })).toBe(160);
  });

  it('uses the latest value when nothing is more abnormal', () => {
    expect(mostAbnormal('spo2', { last: 96, min: 95, max: 99 })).toBe(96);
    expect(mostAbnormal('spo2', { last: 89, min: 85, max: 97 })).toBe(89);
  });
});
