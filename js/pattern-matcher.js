/**
 * pattern-matcher.js — Utility for matching resume bullets against
 * WINNING_BULLETS patterns from constants.js.
 *
 * Isolated in its own file to avoid circular imports between
 * ai-engine.js and gemini.js.
 *
 * @module pattern-matcher
 */

import { WINNING_BULLETS } from './constants.js';

// ---------------------------------------------------------------------------
// Industry name → WINNING_BULLETS key mapping
// ---------------------------------------------------------------------------

/**
 * Maps the human-readable industry names returned by detectIndustries()
 * (e.g. "Technology & Engineering") to the WINNING_BULLETS object keys
 * (e.g. "faang").  Multiple industry names can map to the same key.
 */
const INDUSTRY_TO_BULLETS_KEY = {
  'Technology & Engineering':           ['faang', 'startup', 'product'],
  'Data & Analytics':                   ['faang', 'product'],
  'Business Coaching & Consulting':     ['mbb', 'executive'],
  'Leadership & Executive Development': ['executive', 'mbb'],
  'Finance & Investment':               ['finance'],
  'Entrepreneurship & Startups':        ['startup'],
  'Product Management':                 ['product'],
  'Marketing & Personal Branding':      ['marketing'],
  'Operations & Strategy':              ['operations', 'mbb'],
  'Sales & Revenue Growth':             ['sales'],
  'Design & Creative':                  ['product'],
  'Human Resources & Talent':           ['operations', 'executive'],
  'Healthcare & Life Sciences':         ['operations'],
  'Legal & Compliance':                 ['finance', 'operations'],
  'Education & Academia':               ['executive'],
  'Real Estate & Construction':         ['operations', 'sales'],
  'Hospitality & Tourism':              ['operations', 'sales'],
  'Non-Profit & Social Impact':         ['executive', 'operations'],
  'Training & Development':             ['executive', 'mbb'],
};

// ---------------------------------------------------------------------------
// Tokenisation helpers
// ---------------------------------------------------------------------------

/**
 * Tokenize text into lowercase words, stripping punctuation and filtering
 * out short words (≤3 chars).  Bracket placeholders like [X] are removed.
 *
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  if (!text) return [];
  return text
    .replace(/\[[^\]]*\]/g, '')          // remove bracket placeholders
    .replace(/[^a-zA-Z0-9\s]/g, ' ')    // strip punctuation
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

// ---------------------------------------------------------------------------
// Main pattern-matching function
// ---------------------------------------------------------------------------

/**
 * Find the top N WINNING_BULLETS patterns that best match a given bullet.
 *
 * @param {string}   bullet      - The user's bullet text.
 * @param {string[]} industries  - Array of detected industry keys
 *   (e.g. ["Technology & Engineering", "Product Management"]).
 *   These are the human-readable names from detectIndustries().
 * @param {number}   [topN=3]    - Maximum number of patterns to return.
 * @returns {Array<{pattern: string, context: string, industry: string, score: number}>}
 *   Matched patterns sorted by score (descending), only those above threshold.
 */
export function findMatchingPatterns(bullet, industries, topN = 3) {
  if (!bullet || !industries || industries.length === 0) return [];

  const bulletTokens = new Set(tokenize(bullet));
  if (bulletTokens.size === 0) return [];

  const scored = [];

  // Resolve industry names to WINNING_BULLETS keys, deduplicating
  const bulletKeysSet = new Set();
  for (const industryName of industries) {
    const keys = INDUSTRY_TO_BULLETS_KEY[industryName];
    if (keys) {
      for (const k of keys) bulletKeysSet.add(k);
    }
  }

  // Also try direct keys (in case caller passes raw WINNING_BULLETS keys)
  for (const industryName of industries) {
    const lower = industryName.toLowerCase();
    if (WINNING_BULLETS[lower]) {
      bulletKeysSet.add(lower);
    }
  }

  for (const bulletKey of bulletKeysSet) {
    const patterns = WINNING_BULLETS[bulletKey];
    if (!patterns || !Array.isArray(patterns)) continue;

    for (const entry of patterns) {
      const patternTokens = tokenize(entry.pattern);
      const contextTokens = tokenize(entry.context);
      const allPatternTokens = [...patternTokens, ...contextTokens];

      if (allPatternTokens.length === 0) continue;

      // Count overlapping words
      let overlap = 0;
      for (const token of allPatternTokens) {
        if (bulletTokens.has(token)) overlap++;
      }

      // Normalize by pattern token count to avoid bias toward longer patterns
      const score = overlap / allPatternTokens.length;

      if (score > 0.1) {
        scored.push({
          pattern: entry.pattern,
          context: entry.context,
          industry: bulletKey,
          score,
        });
      }
    }
  }

  // Sort by score descending and return top N
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Extract numeric metrics from a bullet string for use in pattern filling.
 * Returns an object with categorized numbers found in the text.
 *
 * @param {string} text - The bullet text to extract metrics from.
 * @returns {{ revenue: string[], percentages: string[], teamSizes: string[], counts: string[], rawNumbers: string[] }}
 */
export function extractBulletMetrics(text) {
  if (!text) return { revenue: [], percentages: [], teamSizes: [], counts: [], rawNumbers: [] };

  const revenue = [...text.matchAll(/\$[\d,.]+(?:\s*(?:k|m|mm|b|bn|million|billion|thousand))?/gi)]
    .map((m) => m[0].trim());

  const percentages = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    .map((m) => m[1]);

  const teamSizes = [...text.matchAll(/(?:team\s+of\s+|led\s+|managed\s+|mentored\s+)(\d+)/gi)]
    .map((m) => m[1]);

  const counts = [...text.matchAll(/(\d+)\s*(?:\+\s*)?(?:projects|initiatives|features|products|services|systems|platforms|campaigns|accounts|clients|customers|users|engineers|teams|stakeholders|partners|markets|regions|facilities|geographies|business\s+units|processes|quarters|months|weeks|days|years)/gi)]
    .map((m) => m[1]);

  const rawNumbers = [...text.matchAll(/\b(\d[\d,.]*)\b/g)]
    .map((m) => m[1])
    .filter((n) => !revenue.some((r) => r.includes(n)));

  return { revenue, percentages, teamSizes, counts, rawNumbers };
}

/**
 * Attempt to fill a WINNING_BULLETS pattern's placeholders with real
 * metrics extracted from the user's bullet.
 *
 * Only returns the filled pattern if ALL placeholders are filled
 * (no remaining [X], [Y], etc.).
 *
 * @param {string} pattern - The WINNING_BULLETS pattern with [X], [Y], etc. placeholders.
 * @param {Object} metrics - Metrics extracted from the bullet via extractBulletMetrics().
 * @returns {string|null} The filled pattern string, or null if any placeholders remain unfilled.
 */
export function tryFillPattern(pattern, metrics) {
  if (!pattern || !metrics) return null;

  // Collect all available values in order of priority
  const availableValues = [
    ...metrics.revenue,
    ...metrics.percentages,
    ...metrics.teamSizes,
    ...metrics.counts,
    ...metrics.rawNumbers,
  ];

  if (availableValues.length === 0) return null;

  let filled = pattern;
  let valueIdx = 0;

  // Replace bracket placeholders one by one
  // Match placeholders like [X], [Y], [Z], [N], [M], [system], [technique], etc.
  filled = filled.replace(/\[([^\]]+)\]/g, (match, placeholder) => {
    const pl = placeholder.toLowerCase();

    // Try to match by placeholder type
    if ((pl === 'x' || pl === 'y' || pl === 'z' || pl === 'n' || pl === 'm') && valueIdx < availableValues.length) {
      return availableValues[valueIdx++];
    }

    // Named placeholders (e.g. [system], [technique], [product]) can't be
    // filled from numbers — skip them and the pattern will be rejected
    return match;
  });

  // Check if any placeholders remain unfilled
  if (/\[[^\]]+\]/.test(filled)) {
    return null;
  }

  return filled;
}
