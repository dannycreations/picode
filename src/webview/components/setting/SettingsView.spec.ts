import { describe, expect, it } from 'vitest';

import { areSettingsValuesEqual } from './SettingsView';

describe('areSettingsValuesEqual', () => {
  it('correctly compares primitives and arrays of primitives', () => {
    // Boolean tests
    expect(areSettingsValuesEqual(true, true)).toBe(true);
    expect(areSettingsValuesEqual(true, false)).toBe(false);

    // Number tests
    expect(areSettingsValuesEqual(42, 42)).toBe(true);
    expect(areSettingsValuesEqual(42, 24)).toBe(false);

    // String tests
    expect(areSettingsValuesEqual('hello', 'hello')).toBe(true);
    expect(areSettingsValuesEqual('hello', 'world')).toBe(false);

    // Array tests - empty
    expect(areSettingsValuesEqual([], [])).toBe(true);

    // Array tests - identical
    expect(areSettingsValuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);

    // Array tests - different order
    expect(areSettingsValuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);

    // Array tests - different length
    expect(areSettingsValuesEqual(['a', 'b'], ['a'])).toBe(false);

    // Array tests - primitive vs array
    expect(areSettingsValuesEqual(['a'], 'a')).toBe(false);
  });
});
