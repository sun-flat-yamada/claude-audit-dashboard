import { describe, expect, it } from 'vitest';
import {
  ALL_DATASET_NAMES,
  DATASET_NAMES,
  emptyData,
  isDatasetName,
  withDefaults,
} from '../model/dataset.js';
import {
  OPTIONAL_DATASET_NAMES,
  OPTIONAL_SOURCES,
  datasetsOfSource,
  emptyOptionalData,
  isOptionalDatasetName,
} from '../model/optional-datasets.js';

describe('optional dataset registration', () => {
  it('keeps DATASET_NAMES on the 13 built-in datasets', () => {
    expect(DATASET_NAMES).toHaveLength(13);
    for (const name of OPTIONAL_DATASET_NAMES) expect(DATASET_NAMES).not.toContain(name);
  });

  it('adds the five optional datasets to the map and to the known names', () => {
    expect(OPTIONAL_DATASET_NAMES).toEqual([
      'consoleWorkspaces',
      'consoleApiKeys',
      'consoleUsage',
      'consoleCost',
      'claudeCodeActivity',
    ]);
    expect(ALL_DATASET_NAMES).toHaveLength(18);
    for (const name of ALL_DATASET_NAMES) expect(isDatasetName(name)).toBe(true);
    expect(isDatasetName('unknownDataset')).toBe(false);
    expect(isOptionalDatasetName('members')).toBe(false);
    expect(Object.keys(emptyData()).sort()).toEqual([...ALL_DATASET_NAMES].sort());
    expect(Object.keys(emptyOptionalData())).toEqual([...OPTIONAL_DATASET_NAMES]);
    expect(withDefaults({}).consoleCost).toEqual([]);
  });

  it('maps every optional dataset to the config flag that enables it', () => {
    expect(datasetsOfSource('console')).toEqual([
      'consoleWorkspaces',
      'consoleApiKeys',
      'consoleUsage',
      'consoleCost',
    ]);
    expect(datasetsOfSource('claudeCode')).toEqual(['claudeCodeActivity']);
    expect(new Set(Object.values(OPTIONAL_SOURCES))).toEqual(new Set(['console', 'claudeCode']));
  });
});
