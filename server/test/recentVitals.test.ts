import { describe, expect, it } from 'vitest';
import { mostAbnormal } from '../src/vitals/recent';

describe('mostAbnormal', () => {
  it('prefers the candidate with the most severe alert', () => {
    expect(mostAbnormal('spo2', [98, 86, 98])).toBe(86);
    expect(mostAbnormal('temperatureC', [37, 36.8, 39.6])).toBe(39.6);
    expect(mostAbnormal('heartRate', [80, 36, 125])).toBe(36);
    expect(mostAbnormal('heartRate', [80, 45, 160])).toBe(160);
  });

  it('keeps the first candidate when nothing is more abnormal', () => {
    expect(mostAbnormal('spo2', [96, 95, 99])).toBe(96);
    expect(mostAbnormal('spo2', [89, 85, 97])).toBe(89);
  });

  it('is age-aware: 140 bpm is normal for a baby but not for an adult', () => {
    expect(mostAbnormal('heartRate', [100, 140], 6)).toBe(100);
    expect(mostAbnormal('heartRate', [100, 140], 400)).toBe(140);
    expect(mostAbnormal('heartRate', [100, 55], 60)).toBe(55);
  });
});
