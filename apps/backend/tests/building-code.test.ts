import { describe, expect, it } from 'vitest';
import { buildingCodeMatches, buildingCodePattern, generateBuildingCode } from '../src/buildings/access-code.js';

describe('building access codes', () => {
  it('generates ten digits', () => {
    for (let index = 0; index < 20; index += 1) expect(generateBuildingCode()).toMatch(buildingCodePattern);
  });

  it('accepts the exact code with spaces typed by a resident', () => {
    expect(buildingCodeMatches(' 10000 00001 ', '1000000001')).toBe(true);
  });

  it('rejects another building code and malformed input', () => {
    expect(buildingCodeMatches('1000000002', '1000000001')).toBe(false);
    expect(buildingCodeMatches('100000000', '1000000001')).toBe(false);
    expect(buildingCodeMatches('abcdefghij', '1000000001')).toBe(false);
  });
});
