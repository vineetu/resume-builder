/**
 * parser.js — ES module for resume text extraction and parsing.
 *
 * Handles:
 *  1. PDF text extraction (client-side via pdf.js from CDN)
 *  2. Resume text parsing (Gemini-first with comprehensive regex fallback)
 *
 * Exports:
 *  - extractPDFText(file)                 — extract text from a PDF File object
 *  - parseResumeText(rawText, useGemini)  — parse raw text into structured resume data
 */

import { parseResumeWithGemini } from './gemini.js';
import { ACTION_VERBS } from './constants.js';

// ---------------------------------------------------------------------------
// PDF.js CDN URL
// ---------------------------------------------------------------------------

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';

// ---------------------------------------------------------------------------
// PDF Text Extraction
// ---------------------------------------------------------------------------

/**
 * Dynamically load pdf.js from CDN if it isn't already available.
 * Sets disableWorker and clears workerSrc so everything runs on the main thread.
 */
async function ensurePdfJs() {
  if (window.pdfjsLib) return;

  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_CDN;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load pdf.js from CDN'));
    document.head.appendChild(script);
  });

  if (!window.pdfjsLib) {
    throw new Error('pdf.js loaded but pdfjsLib not found on window');
  }

  window.pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

/**
 * Raw-byte fallback: attempt to extract text by scanning TJ operators
 * in the raw PDF byte stream. This is a last resort when pdf.js yields
 * too little text (e.g. scanned / image-heavy PDFs with some embedded text).
 *
 * @param {ArrayBuffer} buffer - The raw PDF file bytes.
 * @returns {string} Extracted text (may be empty).
 */
function extractTextFromRawBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  let raw = '';
  for (let i = 0; i < bytes.length; i++) {
    raw += String.fromCharCode(bytes[i]);
  }

  const chunks = [];
  // Match TJ operator arrays: [ (text) ... ] TJ
  const tjRegex = /\[(.*?)\]\s*TJ/g;
  let match;
  while ((match = tjRegex.exec(raw)) !== null) {
    const inner = match[1];
    // Extract parenthesised string segments
    const strRegex = /\(([^)]*)\)/g;
    let strMatch;
    while ((strMatch = strRegex.exec(inner)) !== null) {
      chunks.push(strMatch[1]);
    }
  }

  // Also try Tj operator (single string): (text) Tj
  const tjSingleRegex = /\(([^)]*)\)\s*Tj/g;
  while ((match = tjSingleRegex.exec(raw)) !== null) {
    chunks.push(match[1]);
  }

  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract all text from a PDF File object.
 *
 * Uses pdf.js to iterate through each page and concatenate text items.
 * Handles y-coordinate changes to insert line breaks, and removes
 * `(cid:X)` artifacts. Falls back to raw-byte TJ scanning if pdf.js
 * returns fewer than 30 characters.
 *
 * @param {File} file - A PDF File object (from <input type="file"> or drag-drop).
 * @returns {Promise<string>} The extracted plain text.
 */
export async function extractPDFText(file) {
  await ensurePdfJs();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({
    data: arrayBuffer,
    disableWorker: true,
  }).promise;

  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    let lastY = null;
    let lineBuffer = '';

    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;

      // Detect line break via y-coordinate change
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) {
        if (lineBuffer.trim()) {
          pageTexts.push(lineBuffer.trim());
        }
        lineBuffer = '';
      }

      lineBuffer += item.str;
      lastY = y;
    }

    // Push the last line of the page
    if (lineBuffer.trim()) {
      pageTexts.push(lineBuffer.trim());
    }
  }

  let text = pageTexts.join('\n');

  // Remove (cid:X) artifacts — these appear when fonts can't be decoded
  text = text.replace(/\(cid:\d+\)/g, '');

  // If pdf.js extraction yielded very little, try raw-byte fallback
  if (text.replace(/\s/g, '').length < 30) {
    const rawText = extractTextFromRawBytes(arrayBuffer);
    if (rawText.length > text.replace(/\s/g, '').length) {
      text = rawText;
    }
  }

  return text;
}

// ---------------------------------------------------------------------------
// Resume Parsing — Gemini-first with regex fallback
// ---------------------------------------------------------------------------

/**
 * Parse raw resume text into structured data.
 *
 * Attempts Gemini-based parsing first (if useGemini is true and an API key
 * is configured), then falls back to comprehensive regex-based parsing.
 *
 * @param {string}  rawText    - Plain-text resume content.
 * @param {boolean} useGemini  - Whether to attempt Gemini parsing first (default true).
 * @returns {Promise<Object>} Structured resume data object.
 */
export async function parseResumeText(rawText, useGemini = true) {
  // --- Gemini-first attempt ---
  if (useGemini) {
    try {
      const geminiResult = await parseResumeWithGemini(rawText);

      if (geminiResult && validateGeminiResult(geminiResult)) {
        return normalizeResult(geminiResult);
      }
    } catch (err) {
      console.warn('[parser] Gemini parsing failed, falling back to regex:', err.message);
    }
  }

  // --- Regex fallback ---
  return parseWithRegex(rawText);
}

/**
 * Validate that a Gemini result has the minimum expected fields.
 */
function validateGeminiResult(result) {
  if (!result || typeof result !== 'object') return false;
  // Must have at least a name or experiences
  if (!result.fullName && (!result.experiences || result.experiences.length === 0)) {
    return false;
  }
  return true;
}

/**
 * Ensure the result conforms to the expected output shape.
 */
function normalizeResult(data) {
  return {
    fullName: data.fullName || '',
    email: data.email || '',
    phone: data.phone || '',
    location: data.location || '',
    linkedin: data.linkedin || '',
    portfolio: data.portfolio || '',
    summary: data.summary || '',
    experiences: (data.experiences || []).map((exp) => ({
      company: exp.company || '',
      title: exp.title || '',
      startDate: exp.startDate || '',
      endDate: exp.endDate || '',
      current: Boolean(exp.current),
      bullets: Array.isArray(exp.bullets) ? exp.bullets : [],
      narrativeCore: exp.narrativeCore || '',
      softSignals: Array.isArray(exp.softSignals) ? exp.softSignals : [],
      evidenceLinks: Array.isArray(exp.evidenceLinks) ? exp.evidenceLinks : [],
      impactScore: exp.impactScore || 0,
    })),
    education: (data.education || []).map((edu) => ({
      school: edu.school || '',
      degree: edu.degree || '',
      field: edu.field || '',
      year: edu.year || '',
    })),
    skills: Array.isArray(data.skills) ? data.skills : [],
    certifications: data.certifications || '',
  };
}

// ---------------------------------------------------------------------------
// Regex-based Resume Parser
// ---------------------------------------------------------------------------

// ── Contact patterns ──────────────────────────────────────────────────

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_RE = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
const LINKEDIN_RE = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[\w-]+\/?/i;
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[\w-]+\/?/i;
const LOCATION_RE = /([A-Z][a-zA-Z\s]+,\s*[A-Z]{2}(?:\s+\d{5})?)/;

// ── Date patterns ─────────────────────────────────────────────────────

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_ABBREVS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const MONTH_PATTERN = '(?:' +
  MONTH_NAMES.join('|') + '|' +
  MONTH_ABBREVS.join('|') +
  ')\\.?';

// Date range: "Jan 2020 – Present" or "January 2020 - December 2023" or "2020 - 2023"
const DATE_RANGE_RE = new RegExp(
  '(' + MONTH_PATTERN + '\\s+\\d{4}|\\d{4})' +
  '\\s*[-–—]\\s*' +
  '(' + MONTH_PATTERN + '\\s+\\d{4}|\\d{4}|present|current)',
  'gi'
);

// ── Bullet detection ──────────────────────────────────────────────────

const BULLET_CHARS_RE = /^[\s]*[•·▪▸\-–—*●○►➤⬥]\s*/;

// ── Section header patterns ───────────────────────────────────────────

const SECTION_PATTERNS = {
  experience: /^(?:work\s+)?(?:professional\s+)?(?:experience|employment|work\s+history|career\s+history|professional\s+background|relevant\s+experience|professional\s+experience)/i,
  education: /^(?:education|academic\s+background|academic\s+history|educational\s+background|qualifications|academic\s+qualifications)/i,
  skills: /^(?:skills|technical\s+skills|core\s+competencies|competencies|areas\s+of\s+expertise|expertise|proficiencies|technical\s+proficiencies|technologies|tools\s*(?:&|and)\s*technologies|programming\s+languages|languages\s*(?:&|and)\s*tools)/i,
  summary: /^(?:summary|professional\s+summary|executive\s+summary|profile|professional\s+profile|objective|career\s+objective|about\s+me|overview|career\s+summary|personal\s+statement)/i,
  certifications: /^(?:certifications?|licenses?\s*(?:&|and)\s*certifications?|professional\s+certifications?|credentials|accreditations?)/i,
  projects: /^(?:projects|personal\s+projects|key\s+projects|selected\s+projects|notable\s+projects|side\s+projects)/i,
};

// ── Company-likelihood scoring ────────────────────────────────────────

const COMPANY_SUFFIXES = /\b(?:inc\.?|llc\.?|ltd\.?|corp\.?|corporation|group|co\.?|company|plc|gmbh|ag|sa|s\.?a\.?|limited|associates|consulting|solutions|technologies|systems|services|partners|labs?|studio|studios)\b/i;
const TITLE_KEYWORDS = /\b(?:manager|engineer|developer|analyst|director|lead|senior|junior|associate|intern|specialist|coordinator|administrator|architect|consultant|designer|officer|president|vice\s+president|vp|cto|ceo|cfo|cio|head|principal|staff|fellow)\b/i;
const NOISE_WORDS = /^(?:the|a|an|and|or|of|at|in|for|to|by|with)\b/i;

/**
 * Score how likely a string is to be a company name.
 *
 * @param {string} text - Candidate text.
 * @returns {number} Score (higher = more likely to be a company name).
 */
function companyLikelihoodScore(text) {
  if (!text || text.trim().length === 0) return -100;

  let score = 0;
  const trimmed = text.trim();

  // Professional suffixes are strong company indicators (+20)
  if (COMPANY_SUFFIXES.test(trimmed)) score += 20;

  // Title case is a mild company indicator (+10)
  if (/^[A-Z]/.test(trimmed)) score += 10;

  // Noise words at the start reduce likelihood (-50)
  if (NOISE_WORDS.test(trimmed)) score -= 50;

  // Title keywords make it less likely to be a company (-15)
  if (TITLE_KEYWORDS.test(trimmed)) score -= 15;

  return score;
}

/**
 * Normalise a date string like "January 2020" or "Jan 2020" to "2020-01" format.
 * Returns the original string if it cannot be parsed.
 *
 * @param {string} dateStr - A date string.
 * @returns {string} Normalised date in YYYY-MM format, or the original string.
 */
function normalizeDate(dateStr) {
  if (!dateStr) return '';

  const trimmed = dateStr.trim();

  // Handle "Present" / "Current"
  if (/^(?:present|current)$/i.test(trimmed)) return 'Present';

  // Handle bare year: "2020"
  if (/^\d{4}$/.test(trimmed)) return trimmed;

  // Handle "Month YYYY"
  const monthYearMatch = trimmed.match(
    new RegExp('^(' + MONTH_PATTERN + ')\\s+(\\d{4})$', 'i')
  );
  if (monthYearMatch) {
    const monthStr = monthYearMatch[1].replace('.', '').toLowerCase();
    const year = monthYearMatch[2];
    let monthIdx = MONTH_NAMES.indexOf(monthStr);
    if (monthIdx === -1) monthIdx = MONTH_ABBREVS.indexOf(monthStr);
    if (monthIdx !== -1) {
      return `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
    }
  }

  return trimmed;
}

/**
 * Determine whether a line is a section header.
 * Headers are typically short, may be ALL CAPS, and match known patterns.
 *
 * @param {string} line - A line of text.
 * @returns {string|null} The section key ('experience', 'education', etc.) or null.
 */
function detectSection(line) {
  const trimmed = line.trim()
    .replace(/^[#\-=_*]+\s*/, '')   // Strip leading markdown / decoration
    .replace(/\s*[#\-=_*:]+$/, '')  // Strip trailing decoration
    .trim();

  // Section headers are usually short
  if (trimmed.length > 60) return null;
  // Skip if it looks like a bullet point
  if (BULLET_CHARS_RE.test(trimmed)) return null;

  for (const [section, pattern] of Object.entries(SECTION_PATTERNS)) {
    if (pattern.test(trimmed)) return section;
  }

  return null;
}

/**
 * Check whether a line looks like it starts with an action verb (bullet content).
 *
 * @param {string} line - A line of text (bullet prefix already stripped).
 * @returns {boolean}
 */
function startsWithActionVerb(line) {
  const firstWord = line.trim().split(/\s+/)[0]?.toLowerCase();
  if (!firstWord) return false;
  return ACTION_VERBS.includes(firstWord);
}

/**
 * Detect whether a line begins with a bullet character or an action verb.
 *
 * @param {string} line - A raw line of text.
 * @returns {boolean}
 */
function isBulletLine(line) {
  if (BULLET_CHARS_RE.test(line)) return true;
  return startsWithActionVerb(line.replace(BULLET_CHARS_RE, ''));
}

/**
 * Extract a date range from a line, if present.
 *
 * @param {string} line - A line of text.
 * @returns {{ start: string, end: string } | null}
 */
function extractDateRange(line) {
  DATE_RANGE_RE.lastIndex = 0;
  const m = DATE_RANGE_RE.exec(line);
  if (!m) return null;

  return {
    start: normalizeDate(m[1]),
    end: normalizeDate(m[2]),
  };
}

/**
 * Remove the date range from a line (for cleaner company/title extraction).
 *
 * @param {string} line - A line of text.
 * @returns {string} Line with date range removed.
 */
function stripDateRange(line) {
  DATE_RANGE_RE.lastIndex = 0;
  return line.replace(DATE_RANGE_RE, '').trim();
}

/**
 * Parse experience entries from a block of lines.
 *
 * Implements four strategies:
 *  1. Split by date ranges
 *  2. Handle "Title — Company" and "Company | Title" separators
 *  3. Use company-likelihood scoring for ambiguous lines
 *  4. Look ahead for company/title on subsequent lines
 *
 * @param {string[]} lines - Lines belonging to the experience section.
 * @returns {Array<Object>} Array of experience objects.
 */
function parseExperiences(lines) {
  if (!lines || lines.length === 0) return [];

  const experiences = [];
  let currentExp = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip sub-section headers
    if (detectSection(line)) continue;

    const dateRange = extractDateRange(line);
    const isBullet = isBulletLine(line);

    // --- Strategy 1: Line contains a date range → new experience entry ---
    if (dateRange) {
      // Save previous experience
      if (currentExp) {
        experiences.push(currentExp);
      }

      const cleaned = stripDateRange(line);
      const { company, title } = extractCompanyAndTitle(cleaned, lines, i);

      currentExp = {
        company,
        title,
        startDate: dateRange.start,
        endDate: dateRange.end,
        current: /present|current/i.test(dateRange.end),
        bullets: [],
        narrativeCore: '',
        softSignals: [],
        evidenceLinks: [],
        impactScore: 0,
      };
      continue;
    }

    // --- Bullet line → add to current experience ---
    if (isBullet && currentExp) {
      const bulletText = line.replace(BULLET_CHARS_RE, '').trim();
      if (bulletText) {
        currentExp.bullets.push(bulletText);
      }
      continue;
    }

    // --- Non-bullet, non-date line: could be a company/title header ---
    if (!currentExp) {
      // No current experience yet; this might be company/title before dates
      // Look ahead for a date on the next line
      if (i + 1 < lines.length && extractDateRange(lines[i + 1])) {
        const nextDateRange = extractDateRange(lines[i + 1]);
        const nextCleaned = stripDateRange(lines[i + 1]);
        const combined = line + (nextCleaned ? ' ' + nextCleaned : '');
        const { company, title } = extractCompanyAndTitle(combined, lines, i);

        currentExp = {
          company,
          title,
          startDate: nextDateRange.start,
          endDate: nextDateRange.end,
          current: /present|current/i.test(nextDateRange.end),
          bullets: [],
          narrativeCore: '',
          softSignals: [],
          evidenceLinks: [],
          impactScore: 0,
        };
        i++; // skip the date line
        continue;
      }

      // Stand-alone company/title line with no date nearby — create entry anyway
      const { company, title } = extractCompanyAndTitle(line, lines, i);
      if (company || title) {
        currentExp = {
          company,
          title,
          startDate: '',
          endDate: '',
          current: false,
          bullets: [],
          narrativeCore: '',
          softSignals: [],
          evidenceLinks: [],
          impactScore: 0,
        };
      }
      continue;
    }

    // If we have a current experience and this line is not a bullet,
    // it might be a new company/title for a new entry (look ahead for date)
    if (currentExp) {
      if (i + 1 < lines.length && extractDateRange(lines[i + 1])) {
        // Save current, start new
        experiences.push(currentExp);
        const nextDateRange = extractDateRange(lines[i + 1]);
        const nextCleaned = stripDateRange(lines[i + 1]);
        const combined = line + (nextCleaned ? ' ' + nextCleaned : '');
        const { company, title } = extractCompanyAndTitle(combined, lines, i);

        currentExp = {
          company,
          title,
          startDate: nextDateRange.start,
          endDate: nextDateRange.end,
          current: /present|current/i.test(nextDateRange.end),
          bullets: [],
          narrativeCore: '',
          softSignals: [],
          evidenceLinks: [],
          impactScore: 0,
        };
        i++; // skip the date line
        continue;
      }

      // It might be a continuation or additional info — check if it looks
      // like a company/title that starts a new entry
      const { company, title } = extractCompanyAndTitle(line, lines, i);
      if ((company && companyLikelihoodScore(company) > 5) || TITLE_KEYWORDS.test(line)) {
        // Likely a new entry without an explicit date range
        experiences.push(currentExp);
        currentExp = {
          company,
          title,
          startDate: '',
          endDate: '',
          current: false,
          bullets: [],
          narrativeCore: '',
          softSignals: [],
          evidenceLinks: [],
          impactScore: 0,
        };
        continue;
      }

      // Otherwise treat as a bullet (some resumes don't use bullet chars)
      if (line.length > 15) {
        currentExp.bullets.push(line);
      }
    }
  }

  // Push the last experience
  if (currentExp) {
    experiences.push(currentExp);
  }

  return experiences;
}

/**
 * Extract company and title from a cleaned line (date range already removed).
 *
 * Tries multiple separator strategies:
 *  - "Title — Company" (em dash, en dash, double hyphen)
 *  - "Company | Title" (pipe)
 *  - "Title, Company" (comma)
 *  - Look-ahead for company/title on next lines
 *  - Company-likelihood scoring to disambiguate
 *
 * @param {string} text     - The text to parse.
 * @param {string[]} lines  - All section lines (for look-ahead).
 * @param {number} lineIdx  - Current line index (for look-ahead).
 * @returns {{ company: string, title: string }}
 */
function extractCompanyAndTitle(text, lines, lineIdx) {
  if (!text || !text.trim()) return { company: '', title: '' };

  const trimmed = text.trim();

  // --- Strategy 2a: "Title — Company" or "Title – Company" ---
  const dashSep = trimmed.match(/^(.+?)\s*[—–]\s*(.+)$/);
  if (dashSep) {
    const left = dashSep[1].trim();
    const right = dashSep[2].trim();

    const leftCompanyScore = companyLikelihoodScore(left);
    const rightCompanyScore = companyLikelihoodScore(right);

    if (rightCompanyScore >= leftCompanyScore) {
      return { company: right, title: left };
    } else {
      return { company: left, title: right };
    }
  }

  // --- Strategy 2b: "Company | Title" or "Title | Company" ---
  const pipeSep = trimmed.match(/^(.+?)\s*\|\s*(.+)$/);
  if (pipeSep) {
    const left = pipeSep[1].trim();
    const right = pipeSep[2].trim();

    const leftCompanyScore = companyLikelihoodScore(left);
    const rightCompanyScore = companyLikelihoodScore(right);

    if (leftCompanyScore >= rightCompanyScore) {
      return { company: left, title: right };
    } else {
      return { company: right, title: left };
    }
  }

  // --- Strategy 4: Look ahead for company/title on next line ---
  if (lines && lineIdx !== undefined) {
    const nextLineIdx = lineIdx + 1;
    // Skip blank lines
    let lookIdx = nextLineIdx;
    while (lookIdx < lines.length && !lines[lookIdx].trim()) lookIdx++;

    if (lookIdx < lines.length) {
      const nextLine = lines[lookIdx].trim();
      // If next line has no date and is not a bullet, it could be a title or company
      if (!extractDateRange(nextLine) && !isBulletLine(nextLine) && nextLine.length < 60) {
        const currentIsCompany = companyLikelihoodScore(trimmed) > companyLikelihoodScore(nextLine);
        if (currentIsCompany) {
          return { company: trimmed, title: nextLine };
        }
        // Don't consume the look-ahead line here; we'll handle it in the main loop
      }
    }
  }

  // --- Strategy 2c: "Title, Company" (comma-separated fallback) ---
  const commaSep = trimmed.match(/^(.+?),\s+(.+)$/);
  if (commaSep) {
    const left = commaSep[1].trim();
    const right = commaSep[2].trim();

    const leftCompanyScore = companyLikelihoodScore(left);
    const rightCompanyScore = companyLikelihoodScore(right);

    if (rightCompanyScore > leftCompanyScore) {
      return { company: right, title: left };
    } else if (leftCompanyScore > rightCompanyScore) {
      return { company: left, title: right };
    }
    // If equal, assume "Title, Company" convention
    return { company: right, title: left };
  }

  // --- Fallback: if the line contains a title keyword, treat the whole thing
  //     as a title; otherwise treat as company ---
  if (TITLE_KEYWORDS.test(trimmed)) {
    return { company: '', title: trimmed };
  }

  return { company: trimmed, title: '' };
}

// ── Education parsing ─────────────────────────────────────────────────

/**
 * Degree abbreviations and patterns for education parsing.
 */
const DEGREE_PATTERNS = [
  // Doctoral
  /\b(?:ph\.?d\.?|doctor(?:ate)?(?:\s+of)?)\b/i,
  // Master's
  /\b(?:m\.?s\.?|m\.?a\.?|m\.?b\.?a\.?|m\.?eng\.?|m\.?ed\.?|m\.?f\.?a\.?|master(?:'?s)?(?:\s+of)?)\b/i,
  // Bachelor's
  /\b(?:b\.?s\.?|b\.?a\.?|b\.?eng\.?|b\.?f\.?a\.?|b\.?b\.?a\.?|bachelor(?:'?s)?(?:\s+of)?)\b/i,
  // Associate's
  /\b(?:a\.?s\.?|a\.?a\.?|associate(?:'?s)?(?:\s+of)?)\b/i,
  // Generic
  /\b(?:diploma|certificate|certification|ged|high\s+school)\b/i,
];

const SCHOOL_KEYWORDS = /\b(?:university|college|institute|school|academy|polytechnic|conservatory)\b/i;

/**
 * Parse education entries from a block of lines.
 *
 * @param {string[]} lines - Lines belonging to the education section.
 * @returns {Array<Object>} Array of education objects.
 */
function parseEducation(lines) {
  if (!lines || lines.length === 0) return [];

  const education = [];
  let currentEdu = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (detectSection(line)) continue;

    // Try to detect a degree on this line
    let degreeMatch = null;
    for (const pattern of DEGREE_PATTERNS) {
      const m = line.match(pattern);
      if (m) {
        degreeMatch = m[0];
        break;
      }
    }

    // Try to detect a school name
    const isSchoolLine = SCHOOL_KEYWORDS.test(line);

    // Try to extract a year
    const yearMatch = line.match(/\b((?:19|20)\d{2})\b/);

    // If we find a degree or school keyword, this is likely a new education entry
    if (degreeMatch || isSchoolLine) {
      if (currentEdu && (currentEdu.school || currentEdu.degree)) {
        education.push(currentEdu);
      }

      currentEdu = {
        school: '',
        degree: '',
        field: '',
        year: '',
      };

      if (degreeMatch) {
        currentEdu.degree = degreeMatch;

        // Try to extract field of study — text after "in" or "of" following the degree
        const fieldMatch = line.match(
          new RegExp(degreeMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+(?:in|of)\\s+(.+?)(?:,|$|\\s+(?:from|at))', 'i')
        );
        if (fieldMatch) {
          currentEdu.field = fieldMatch[1].trim();
        }
      }

      if (isSchoolLine && !currentEdu.school) {
        // Extract school name: often the whole line or part before/after a comma
        if (degreeMatch) {
          // School might be on same line — look for it
          const parts = line.split(/[,|–—]/);
          for (const part of parts) {
            if (SCHOOL_KEYWORDS.test(part) && !part.includes(degreeMatch)) {
              currentEdu.school = part.trim();
              break;
            }
          }
          if (!currentEdu.school) {
            currentEdu.school = line.replace(degreeMatch, '').replace(/[,|–—]/g, ' ').trim();
          }
        } else {
          currentEdu.school = line.trim();
        }
      }

      if (yearMatch) {
        currentEdu.year = yearMatch[1];
      }
      continue;
    }

    // If we have a current education entry, fill in missing fields
    if (currentEdu) {
      if (!currentEdu.school && SCHOOL_KEYWORDS.test(line)) {
        currentEdu.school = line.trim();
      } else if (!currentEdu.school && !currentEdu.degree && line.length < 80) {
        // Could be a school name without keyword
        currentEdu.school = line.trim();
      }
      if (!currentEdu.year && yearMatch) {
        currentEdu.year = yearMatch[1];
      }
      if (!currentEdu.field) {
        const fieldMatch = line.match(/(?:in|of)\s+(.+?)(?:,|$)/i);
        if (fieldMatch) {
          currentEdu.field = fieldMatch[1].trim();
        }
      }
      continue;
    }

    // No current education — start one if the line is not a bullet
    if (!isBulletLine(line) && line.length < 80) {
      currentEdu = {
        school: isSchoolLine ? line.trim() : line.trim(),
        degree: degreeMatch || '',
        field: '',
        year: yearMatch ? yearMatch[1] : '',
      };
    }
  }

  // Push the last entry
  if (currentEdu && (currentEdu.school || currentEdu.degree)) {
    education.push(currentEdu);
  }

  return education;
}

// ── Skills parsing ────────────────────────────────────────────────────

/**
 * Parse skills from a block of lines.
 *
 * Splits by common delimiters: comma, semicolon, pipe, bullet characters.
 *
 * @param {string[]} lines - Lines belonging to the skills section.
 * @returns {string[]} Array of individual skill strings.
 */
function parseSkills(lines) {
  if (!lines || lines.length === 0) return [];

  const allText = lines
    .map((l) => l.trim())
    .filter((l) => l && !detectSection(l))
    .join(' ');

  // Split by common delimiters
  const skills = allText
    .split(/[,;|•·▪▸●○►➤⬥]+/)
    .map((s) => s.replace(BULLET_CHARS_RE, '').trim())
    .filter((s) => s.length > 0 && s.length < 60); // filter out empty and suspiciously long entries

  // Deduplicate
  return [...new Set(skills)];
}

// ── Certification parsing ─────────────────────────────────────────────

/**
 * Extract certifications from a block of lines.
 *
 * @param {string[]} lines - Lines belonging to the certifications section.
 * @returns {string} Certifications as a single string (newline-separated).
 */
function parseCertifications(lines) {
  if (!lines || lines.length === 0) return '';

  return lines
    .map((l) => l.replace(BULLET_CHARS_RE, '').trim())
    .filter((l) => l && !detectSection(l))
    .join('\n');
}

// ── Main regex parser ─────────────────────────────────────────────────

/**
 * Parse raw resume text using regex patterns.
 *
 * This is the comprehensive fallback parser that works without any API.
 *
 * @param {string} rawText - Plain-text resume content.
 * @returns {Object} Structured resume data.
 */
function parseWithRegex(rawText) {
  const lines = rawText.split(/\n/);

  // ── Step 1: Extract contact information ──
  const fullText = rawText;

  const emailMatch = fullText.match(EMAIL_RE);
  const email = emailMatch ? emailMatch[0] : '';

  const phoneMatch = fullText.match(PHONE_RE);
  const phone = phoneMatch ? phoneMatch[0] : '';

  const linkedinMatch = fullText.match(LINKEDIN_RE);
  const linkedin = linkedinMatch ? linkedinMatch[0] : '';

  const githubMatch = fullText.match(GITHUB_RE);
  const portfolio = githubMatch ? githubMatch[0] : '';

  const locationMatch = fullText.match(LOCATION_RE);
  const location = locationMatch ? locationMatch[1] : '';

  // ── Step 2: Extract name ──
  // The name is typically the first non-contact, non-header line in the first 8 lines
  let fullName = '';
  const contactValues = [email, phone, linkedin, portfolio, location].filter(Boolean);

  for (let i = 0; i < Math.min(8, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Skip if this line is a contact line
    const isContactLine = contactValues.some((cv) => line.includes(cv));
    if (isContactLine) continue;

    // Skip if this line is a section header
    if (detectSection(line)) continue;

    // Skip if line is just a URL
    if (/^https?:\/\//i.test(line)) continue;

    // Skip very long lines (likely a summary, not a name)
    if (line.length > 50) continue;

    // This is likely the name
    fullName = line;
    break;
  }

  // ── Step 3: Segment the resume into sections ──
  const sections = {};
  let currentSection = null;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const detected = detectSection(line);

    if (detected) {
      // Save previous section
      if (currentSection) {
        sections[currentSection] = currentLines;
      }
      currentSection = detected;
      currentLines = [];
      continue;
    }

    if (currentSection) {
      currentLines.push(line);
    }
  }

  // Save the last section
  if (currentSection) {
    sections[currentSection] = currentLines;
  }

  // ── Step 4: Parse summary ──
  let summary = '';
  if (sections.summary) {
    summary = sections.summary
      .map((l) => l.trim())
      .filter((l) => l)
      .join(' ')
      .trim();
  }

  // ── Step 5: Parse experiences ──
  const experiences = parseExperiences(sections.experience || []);

  // ── Step 6: Parse education ──
  const education = parseEducation(sections.education || []);

  // ── Step 7: Parse skills ──
  const skills = parseSkills(sections.skills || []);

  // ── Step 8: Parse certifications ──
  const certifications = parseCertifications(sections.certifications || []);

  // ── Build and return result ──
  return normalizeResult({
    fullName,
    email,
    phone,
    location,
    linkedin,
    portfolio,
    summary,
    experiences,
    education,
    skills,
    certifications,
  });
}
