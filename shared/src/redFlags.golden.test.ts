import { describe, expect, it } from 'vitest';
import golden from '../tests/red_flag_cases.json';
import { redFlagEngine } from './data';
import type { TriageContext } from './schemas';

interface GoldenCase {
  name: string;
  input: TriageContext;
  expected: { isEmergency: boolean; matchedRuleIds: string[]; unknownSymptoms?: string[] };
}

// The same file drives ai-service/tests/test_red_flags.py, so both engines must agree.
describe('red-flag engine golden cases', () => {
  it.each((golden.cases as GoldenCase[]).map((c) => [c.name, c] as const))('%s', (_name, c) => {
    const result = redFlagEngine.evaluate(c.input);

    expect(result.isEmergency).toBe(c.expected.isEmergency);
    expect(result.level).toBe(c.expected.isEmergency ? 'EMERGENCY' : null);
    expect(result.matchedRules.map((r) => r.id).sort()).toEqual([...c.expected.matchedRuleIds].sort());
    if (c.expected.unknownSymptoms) {
      expect(result.unknownSymptoms).toEqual(c.expected.unknownSymptoms);
    }
  });
});
