import type { DocumentRenderer } from '@claude-audit/core';
import { stableStringify } from '../storage/file-store.js';
import { csvRenderer } from './csv.js';
import { htmlRenderer } from './html.js';
import { markdownRenderer } from './markdown.js';

export const jsonRenderer: DocumentRenderer = {
  id: 'json',
  render: (document) => [
    { suffix: '.json', mediaType: 'application/json', content: stableStringify(document) },
  ],
};

/** Output formats applied to every generated report. */
export const BUILTIN_RENDERERS: readonly DocumentRenderer[] = [
  markdownRenderer,
  htmlRenderer,
  csvRenderer,
  jsonRenderer,
];

export { csvRenderer, htmlRenderer, markdownRenderer };
