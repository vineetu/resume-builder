/**
 * Impact Linter — real-time inline checker for resume text.
 * Runs spelling, grammar, style, and signal checks against resume content
 * and renders an inline panel with actionable suggestions.
 *
 * @module linter
 */

import {
  COMMON_MISSPELLINGS,
  CONFUSABLES,
  PASSIVE_RX,
  WEAK_PHRASES,
  BUZZWORDS,
  GRAMMAR_RULES,
} from './constants.js';

// ---------------------------------------------------------------------------
// Color palette for issue categories
// ---------------------------------------------------------------------------
const COLOR = {
  rose: '#c97b7b',
  gold: '#c4a265',
  sky: '#8fb8c9',
  lavender: '#9b8ec4',
};

// ---------------------------------------------------------------------------
// Filler words / phrases that add no signal to a resume
// ---------------------------------------------------------------------------
const FILLER_WORDS = new Map([
  ['successfully', 'Remove — the result speaks for itself.'],
  ['various', 'Be specific about what you mean.'],
  ['etc.', 'List the actual items instead of trailing off.'],
  ['etc', 'List the actual items instead of trailing off.'],
  ['a lot of', 'Quantify — how many?'],
  ['numerous', 'Quantify — how many?'],
  ['very', 'Delete or pick a stronger adjective.'],
  ['really', 'Delete or pick a stronger adjective.'],
  ['just', 'Usually unnecessary — try removing it.'],
  ['basically', 'Delete — it weakens your point.'],
  ['actually', 'Usually unnecessary — try removing it.'],
  ['in order to', 'Replace with "to".'],
  ['utilize', 'Replace with "use".'],
  ['utilized', 'Replace with "used".'],
]);

// ---------------------------------------------------------------------------
// Action verbs for weak-start replacement
// ---------------------------------------------------------------------------
const ACTION_VERBS = [
  'Led', 'Delivered', 'Drove', 'Built', 'Designed', 'Launched',
  'Implemented', 'Achieved', 'Optimized', 'Streamlined', 'Spearheaded',
  'Orchestrated', 'Accelerated', 'Transformed', 'Pioneered',
];

// ---------------------------------------------------------------------------
// checkText(text)
// ---------------------------------------------------------------------------

/**
 * Run all lint rules against the given text.
 *
 * @param {string} text - The resume text to analyse.
 * @returns {Array<{word: string, suggestion: string, type: string, tip: string, color: string, index: number}>}
 */
export function checkText(text) {
  if (!text || typeof text !== 'string') return [];

  const issues = [];

  // 1. Misspellings --------------------------------------------------------
  _checkMisspellings(text, issues);

  // 2. Double words --------------------------------------------------------
  _checkDoubleWords(text, issues);

  // 3. Confusable words ----------------------------------------------------
  _checkConfusables(text, issues);

  // 4. Passive voice -------------------------------------------------------
  _checkPassiveVoice(text, issues);

  // 5. Weak phrases --------------------------------------------------------
  _checkWeakPhrases(text, issues);

  // 6. Filler words --------------------------------------------------------
  _checkFillerWords(text, issues);

  // 7. Buzzwords -----------------------------------------------------------
  _checkBuzzwords(text, issues);

  // 8. Grammar rules -------------------------------------------------------
  _checkGrammar(text, issues);

  // Safety cap — never return more than 50 issues (prevents DOM explosion)
  return issues.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Individual rule checkers
// ---------------------------------------------------------------------------

/**
 * Check each word against the COMMON_MISSPELLINGS dictionary.
 */
function _checkMisspellings(text, issues) {
  const wordRx = /\b[a-zA-Z']+\b/g;
  let match;
  while ((match = wordRx.exec(text)) !== null) {
    const lower = match[0].toLowerCase();
    if (COMMON_MISSPELLINGS[lower]) {
      issues.push({
        word: match[0],
        suggestion: COMMON_MISSPELLINGS[lower],
        type: 'spelling',
        tip: `Did you mean "${COMMON_MISSPELLINGS[lower]}"?`,
        color: COLOR.rose,
        index: match.index,
      });
    }
  }
}

/**
 * Detect consecutive identical words (e.g. "the the").
 */
function _checkDoubleWords(text, issues) {
  const rx = /\b(\w+)\s+\1\b/gi;
  let match;
  while ((match = rx.exec(text)) !== null) {
    issues.push({
      word: match[0],
      suggestion: match[1],
      type: 'double',
      tip: `Remove the duplicate "${match[1]}".`,
      color: COLOR.rose,
      index: match.index,
    });
  }
}

/**
 * Flag confusable word pairs (their/there, your/you're, its/it's, etc.).
 */
function _checkConfusables(text, issues) {
  if (!CONFUSABLES || !Array.isArray(CONFUSABLES)) return;

  // CONFUSABLES entries have { rx: RegExp, word: string, fix: string, type: string, tip: string }
  for (const entry of CONFUSABLES) {
    const rx = entry.rx || entry.pattern;
    if (!rx) continue;

    if (rx instanceof RegExp) rx.lastIndex = 0;
    const regex = rx instanceof RegExp ? rx : new RegExp(`\\b${rx}\\b`, 'gi');

    let match;
    while ((match = regex.exec(text)) !== null) {
      issues.push({
        word: match[0],
        suggestion: entry.fix || '',
        type: entry.type || 'grammar',
        tip: entry.tip || `Check usage of "${match[0]}" — common mix-up.`,
        color: COLOR.gold,
        index: match.index,
      });
    }
  }
}

/**
 * Detect passive voice constructions ("was achieved", "were managed", etc.).
 */
function _checkPassiveVoice(text, issues) {
  const rx = PASSIVE_RX instanceof RegExp
    ? PASSIVE_RX
    : /\b(was|were|been|being|is|are|am)\s+(\w+ed)\b/gi;

  let match;
  rx.lastIndex = 0;
  while ((match = rx.exec(text)) !== null) {
    const verb = match[2] || match[0];
    issues.push({
      word: match[0],
      suggestion: verb.replace(/ed$/i, ''),
      type: 'passive',
      tip: `Passive voice detected. Try an active verb instead of "${match[0]}".`,
      color: COLOR.sky,
      index: match.index,
    });
  }
}

/**
 * Flag weak phrases ("responsible for", "helped with", "worked on", etc.).
 */
function _checkWeakPhrases(text, issues) {
  if (!WEAK_PHRASES) return;

  // WEAK_PHRASES entries have { rx: RegExp, fix: string, tip: string, type: string }
  for (const entry of WEAK_PHRASES) {
    const rx = entry.rx;
    if (!rx) continue;
    rx.lastIndex = 0;
    let match;
    while ((match = rx.exec(text)) !== null) {
      issues.push({
        word: match[0],
        suggestion: entry.fix || '',
        type: entry.type || 'style',
        tip: entry.tip || `"${match[0]}" is vague. Try: "${entry.fix}".`,
        color: COLOR.lavender,
        index: match.index,
      });
    }
  }
}

/**
 * Flag filler words ("successfully", "various", "etc.", "a lot of", etc.).
 */
function _checkFillerWords(text, issues) {
  for (const [filler, tip] of FILLER_WORDS) {
    const rx = new RegExp(`\\b${_escapeRegex(filler)}\\b`, 'gi');
    let match;
    while ((match = rx.exec(text)) !== null) {
      issues.push({
        word: match[0],
        suggestion: '',
        type: 'filler',
        tip,
        color: COLOR.gold,
        index: match.index,
      });
    }
  }
}

/**
 * Flag buzzwords ("passionate", "detail-oriented", "results-driven", etc.).
 */
function _checkBuzzwords(text, issues) {
  if (!BUZZWORDS) return;

  for (const entry of BUZZWORDS) {
    // BUZZWORDS entries have { rx: RegExp, tip: string }
    const rx = entry.rx;
    const coaching = entry.tip || '"' + (entry.word || 'this term') + '" is overused. Show, don\'t tell.';

    if (!rx) continue;

    // Reset lastIndex for global regex
    rx.lastIndex = 0;
    let match;
    while ((match = rx.exec(text)) !== null) {
      issues.push({
        word: match[0],
        suggestion: '',
        type: 'buzzword',
        tip: coaching,
        color: COLOR.lavender,
        index: match.index,
      });
    }
  }
}

/**
 * Run grammar rules: lowercase "i", double spaces/periods/commas, "alot",
 * "could of", etc.
 */
function _checkGrammar(text, issues) {
  // Lowercase standalone "i"
  const iRx = /(?<=\s|^)i(?=\s|[.,!?;:]|$)/g;
  let match;
  while ((match = iRx.exec(text)) !== null) {
    issues.push({
      word: 'i',
      suggestion: 'I',
      type: 'grammar',
      tip: 'Capitalize "I".',
      color: COLOR.gold,
      index: match.index,
    });
  }

  // Double spaces
  const dblSpace = /  +/g;
  while ((match = dblSpace.exec(text)) !== null) {
    issues.push({
      word: match[0],
      suggestion: ' ',
      type: 'grammar',
      tip: 'Remove extra space.',
      color: COLOR.gold,
      index: match.index,
    });
  }

  // Double periods
  const dblPeriod = /\.{2}(?!\.)/g;
  while ((match = dblPeriod.exec(text)) !== null) {
    issues.push({
      word: '..',
      suggestion: '.',
      type: 'grammar',
      tip: 'Remove duplicate period.',
      color: COLOR.gold,
      index: match.index,
    });
  }

  // Double commas
  const dblComma = /,,+/g;
  while ((match = dblComma.exec(text)) !== null) {
    issues.push({
      word: match[0],
      suggestion: ',',
      type: 'grammar',
      tip: 'Remove duplicate comma.',
      color: COLOR.gold,
      index: match.index,
    });
  }

  // "alot" -> "a lot"
  const alot = /\balot\b/gi;
  while ((match = alot.exec(text)) !== null) {
    issues.push({
      word: match[0],
      suggestion: 'a lot',
      type: 'grammar',
      tip: '"alot" is not a word. Use "a lot".',
      color: COLOR.gold,
      index: match.index,
    });
  }

  // "could of" / "should of" / "would of" -> "could have" etc.
  const ofRx = /\b(could|should|would|must)\s+of\b/gi;
  while ((match = ofRx.exec(text)) !== null) {
    const verb = match[1];
    issues.push({
      word: match[0],
      suggestion: `${verb} have`,
      type: 'grammar',
      tip: `"${match[0]}" should be "${verb} have".`,
      color: COLOR.gold,
      index: match.index,
    });
  }

  // External GRAMMAR_RULES from constants — entries have { rx, fix, type, tip }
  if (GRAMMAR_RULES && Array.isArray(GRAMMAR_RULES)) {
    for (const rule of GRAMMAR_RULES) {
      const rx = rule.rx;
      if (!rx || !(rx instanceof RegExp)) continue; // skip invalid entries
      rx.lastIndex = 0;
      while ((match = rx.exec(text)) !== null) {
        if (match[0].length === 0) { rx.lastIndex++; continue; } // prevent infinite loop on zero-width match
        const fixVal = typeof rule.fix === 'function' ? rule.fix(match[0]) : (rule.fix || '');
        issues.push({
          word: match[0],
          suggestion: fixVal,
          type: rule.type || 'grammar',
          tip: rule.tip || `Grammar issue: "${match[0]}".`,
          color: COLOR.gold,
          index: match.index,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// calculateSignalScore(text)
// ---------------------------------------------------------------------------

/**
 * Calculate a 0-100 signal score for the given text.
 *
 * Penalties:
 *  - Spelling / grammar error: -15
 *  - Passive voice / weak phrase: -10
 *  - Buzzword / filler: -5
 *
 * @param {string} text
 * @returns {{ score: number, label: string, color: string }}
 */
export function calculateSignalScore(text) {
  const issues = checkText(text);
  let score = 100;

  for (const issue of issues) {
    switch (issue.type) {
      case 'spelling':
      case 'grammar':
      case 'double':
        score -= 15;
        break;
      case 'passive':
      case 'style':
        score -= 10;
        break;
      case 'buzzword':
      case 'filler':
        score -= 5;
        break;
      default:
        score -= 5;
    }
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  let label, color;
  if (score >= 70) {
    label = 'Strong Signal';
    color = '#4caf50'; // green
  } else if (score >= 40) {
    label = 'Needs Work';
    color = COLOR.gold;
  } else {
    label = 'Weak Signal';
    color = COLOR.rose;
  }

  return { score, label, color };
}

// ---------------------------------------------------------------------------
// fixAll(text, issues)
// ---------------------------------------------------------------------------

/**
 * Apply all auto-fixable suggestions to the text.
 *
 * Fixes are applied in reverse-index order so that earlier indices remain
 * valid as we splice characters out.
 *
 * @param {string} text
 * @param {Array} issues - Issues from checkText().
 * @returns {string} The corrected text.
 */
export function fixAll(text, issues) {
  if (!issues || issues.length === 0) return text;

  // Collect fixable issues (those with a non-empty suggestion)
  const fixable = issues
    .filter((i) => i.suggestion && i.suggestion !== i.word)
    .slice()
    .sort((a, b) => b.index - a.index); // reverse order for safe splicing

  let result = text;

  for (const issue of fixable) {
    const before = result.slice(0, issue.index);
    const after = result.slice(issue.index + issue.word.length);
    result = before + issue.suggestion + after;
  }

  // Weak-start verb replacement: if the first word is not an action verb,
  // prepend one.
  result = _fixWeakStart(result);

  return result;
}

/**
 * If the first word of the text is not a strong action verb, prepend one.
 */
function _fixWeakStart(text) {
  const trimmed = text.trimStart();
  if (!trimmed) return text;

  const firstWord = trimmed.split(/\s/)[0].replace(/[^a-zA-Z]/g, '');
  const actionSet = new Set(ACTION_VERBS.map((v) => v.toLowerCase()));

  if (!firstWord || actionSet.has(firstWord.toLowerCase())) {
    return text;
  }

  // Only prepend if the line looks like a bullet / description (starts lowercase
  // or with a weak word). Avoid mangling names / headings.
  const isLower = firstWord[0] === firstWord[0].toLowerCase();
  if (isLower) {
    const verb = ACTION_VERBS[Math.floor(Math.random() * ACTION_VERBS.length)];
    const leading = text.length - trimmed.length;
    return text.slice(0, leading) + verb + ' ' + trimmed;
  }

  return text;
}

// ---------------------------------------------------------------------------
// renderLinterPanel(container, text, fieldKey, onFix)
// ---------------------------------------------------------------------------

/**
 * Render the Impact Linter inline panel below a text field.
 *
 * The panel is fully built with DOM createElement calls — no innerHTML is used
 * for user-supplied content.
 *
 * @param {HTMLElement} container - Parent element to mount the panel into.
 * @param {string} text - Current text of the field.
 * @param {string} fieldKey - Identifier for the text field (for callbacks).
 * @param {(fixedText: string, fieldKey: string) => void} onFix - Called with the corrected text.
 */
export function renderLinterPanel(container, text, fieldKey, onFix) {
  // Clear previous panel
  container.innerHTML = '';

  const issues = checkText(text);

  // If no issues, don't render anything
  if (issues.length === 0) return;

  const { score, label, color: scoreColor } = calculateSignalScore(text);

  // -- Wrapper -------------------------------------------------------------
  const panel = document.createElement('div');
  panel.className = 'linter-panel';
  Object.assign(panel.style, {
    marginTop: '6px',
    borderRadius: '8px',
    border: '1px solid rgba(155, 142, 196, 0.25)',
    background: 'linear-gradient(135deg, rgba(75, 50, 120, 0.06), rgba(45, 30, 80, 0.03))',
    overflow: 'hidden',
    fontSize: '13px',
    lineHeight: '1.5',
  });

  // -- Header --------------------------------------------------------------
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    cursor: 'pointer',
    userSelect: 'none',
    background: 'linear-gradient(90deg, rgba(108, 78, 172, 0.12), rgba(75, 50, 120, 0.06))',
  });

  // Title
  const titleSpan = document.createElement('span');
  titleSpan.textContent = 'Impact Linter';
  Object.assign(titleSpan.style, {
    fontWeight: '600',
    background: 'linear-gradient(135deg, #9b8ec4, #6c4eac)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  });

  // Score badge
  const badge = document.createElement('span');
  badge.textContent = `${score} — ${label}`;
  Object.assign(badge.style, {
    fontSize: '11px',
    fontWeight: '600',
    padding: '2px 8px',
    borderRadius: '10px',
    color: '#fff',
    backgroundColor: scoreColor,
  });

  header.appendChild(titleSpan);
  header.appendChild(badge);
  panel.appendChild(header);

  // -- Issue list (collapsible body) ---------------------------------------
  const body = document.createElement('div');
  body.className = 'linter-body';
  Object.assign(body.style, {
    padding: '8px 12px',
  });

  // Toggle collapse on header click
  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'block';
  });

  for (const issue of issues) {
    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '4px 0',
      borderBottom: '1px solid rgba(155, 142, 196, 0.1)',
    });

    // Colored dot
    const dot = document.createElement('span');
    Object.assign(dot.style, {
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      backgroundColor: issue.color,
      flexShrink: '0',
      marginTop: '6px',
    });
    row.appendChild(dot);

    // Description
    const desc = document.createElement('span');
    desc.style.flex = '1';

    const wordNode = document.createElement('strong');
    wordNode.textContent = issue.word;
    desc.appendChild(wordNode);

    const tipNode = document.createTextNode(` — ${issue.tip}`);
    desc.appendChild(tipNode);

    row.appendChild(desc);

    // Fix button (only for auto-fixable issues)
    if (issue.suggestion && issue.suggestion !== issue.word) {
      const fixBtn = document.createElement('button');
      fixBtn.textContent = 'Fix';
      Object.assign(fixBtn.style, {
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '4px',
        border: '1px solid rgba(155, 142, 196, 0.3)',
        background: 'rgba(155, 142, 196, 0.1)',
        cursor: 'pointer',
        flexShrink: '0',
        color: 'inherit',
      });
      fixBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const before = text.slice(0, issue.index);
        const after = text.slice(issue.index + issue.word.length);
        const fixed = before + issue.suggestion + after;
        if (typeof onFix === 'function') {
          onFix(fixed, fieldKey);
        }
      });
      row.appendChild(fixBtn);
    }

    body.appendChild(row);
  }

  // -- Fix All button ------------------------------------------------------
  const fixAllBtn = document.createElement('button');
  fixAllBtn.textContent = 'Fix All';
  Object.assign(fixAllBtn.style, {
    marginTop: '8px',
    width: '100%',
    padding: '6px',
    borderRadius: '6px',
    border: '1px solid rgba(155, 142, 196, 0.3)',
    background: 'linear-gradient(135deg, rgba(108, 78, 172, 0.15), rgba(75, 50, 120, 0.08))',
    cursor: 'pointer',
    fontWeight: '600',
    fontSize: '12px',
    color: 'inherit',
  });
  fixAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const fixed = fixAll(text, issues);
    if (typeof onFix === 'function') {
      onFix(fixed, fieldKey);
    }
  });
  body.appendChild(fixAllBtn);

  panel.appendChild(body);
  container.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Escape special regex characters in a string.
 */
function _escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
