import { describe, expect, it } from 'vitest';

import { jsonReport } from '../src/report.js';

describe('jsonReport', () => {
  it('always carries the same envelope, so a reader learns it once', () => {
    const report = jsonReport('doctor', true, [], { checks: [] });
    expect(Object.keys(report)).toEqual(['demotale', 'command', 'ok', 'problems', 'result']);
    expect(report.demotale).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('has problems as an array even when nothing is wrong', () => {
    expect(jsonReport('render', true, [], {}).problems).toEqual([]);
  });

  it('survives a round trip through JSON, which is the only way it is ever read', () => {
    const report = jsonReport('check', false, [{ code: 'locator-no-match' as const, message: 'step 2 missed', step: '2' }], {
      scenarios: [],
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
