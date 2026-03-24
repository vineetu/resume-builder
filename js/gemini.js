/**
 * gemini.js — ES module wrapping the Gemini API for Resume Forge.
 *
 * Provides helpers for parsing resumes, analysing job descriptions,
 * enhancing bullet points, generating summaries, tailoring resumes,
 * analysing job fit, and generating stand-out suggestions.
 *
 * Model: gemini-3.1-flash-lite-preview
 */

import { findMatchingPatterns } from './pattern-matcher.js';

// ---------------------------------------------------------------------------
// Response Cache
// ---------------------------------------------------------------------------

const CACHE_PREFIX = 'gemini_cache_';
const CACHE_INDEX_KEY = 'gemini_cache_index';
const MAX_CACHE_SIZE = 20;

function _hashPrompt(prompt) {
  const key = prompt.substring(0, 200) + '|' + prompt.length + '|' + prompt.substring(prompt.length - 100);
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const chr = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return CACHE_PREFIX + hash;
}

function _getCacheIndex() {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_INDEX_KEY) || '[]');
  } catch { return []; }
}

function _setCacheIndex(index) {
  try { sessionStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index)); } catch {}
}

function _cacheGet(key) {
  try {
    const val = sessionStorage.getItem(key);
    return val !== null ? val : undefined;
  } catch { return undefined; }
}

function _cacheSet(key, value) {
  try {
    sessionStorage.setItem(key, value);
    const index = _getCacheIndex();
    if (!index.includes(key)) index.push(key);
    // Evict oldest if over limit
    while (index.length > MAX_CACHE_SIZE) {
      const oldest = index.shift();
      sessionStorage.removeItem(oldest);
    }
    _setCacheIndex(index);
  } catch {
    // Quota exceeded — evict half the cache and retry
    try {
      const index = _getCacheIndex();
      const half = Math.ceil(index.length / 2);
      for (let i = 0; i < half; i++) {
        sessionStorage.removeItem(index[i]);
      }
      _setCacheIndex(index.slice(half));
      sessionStorage.setItem(key, value);
    } catch {}
  }
}

/** Clear the Gemini response cache. */
export function clearGeminiCache() {
  const index = _getCacheIndex();
  for (const key of index) {
    sessionStorage.removeItem(key);
  }
  sessionStorage.removeItem(CACHE_INDEX_KEY);
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'resume_forge_gemini_key';
const MODEL = 'gemini-3.1-flash-lite-preview';
const API_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 30_000; // 30-second timeout
const MAX_RETRIES = 1;     // one automatic retry on failure

// ---------------------------------------------------------------------------
// API-key management
// ---------------------------------------------------------------------------

/** Check localStorage for an API key. Returns true if one exists. */
export function initGemini() {
  return hasApiKey();
}

/** Return the stored API key (or null). */
export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY);
}

/** Persist an API key to localStorage. */
export function setApiKey(key) {
  localStorage.setItem(STORAGE_KEY, key);
}

/** Returns true when an API key is present in localStorage. */
export function hasApiKey() {
  const key = getApiKey();
  return Boolean(key && key.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Low-level API call
// ---------------------------------------------------------------------------

/**
 * Call the Gemini generateContent endpoint.
 *
 * @param {string}  prompt                 - The user prompt text.
 * @param {Object}  [options]              - Optional configuration.
 * @param {number}  [options.temperature]  - Sampling temperature (0-1).
 * @param {number}  [options.maxTokens]    - Max output tokens.
 * @param {string}  [options.responseFormat] - 'text' (default) or 'json'.
 * @param {boolean} [options.skipCache]    - If true, bypass the response cache.
 * @returns {Promise<string|null>} The model's text reply, or null on error.
 */
export async function askGemini(prompt, options = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[gemini] No API key found — call setApiKey() first.');
    return null;
  }

  const { temperature, maxTokens, responseFormat = 'text', skipCache = false } = options;

  // --- Cache lookup ---
  const cacheKey = _hashPrompt(prompt);
  if (!skipCache) {
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) return cached;
  }

  // Build the request body
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {},
  };

  if (temperature !== undefined) body.generationConfig.temperature = temperature;
  if (maxTokens !== undefined) body.generationConfig.maxOutputTokens = maxTokens;
  if (responseFormat === 'json') {
    body.generationConfig.responseMimeType = 'application/json';
  }

  const url = `${API_BASE}?key=${apiKey}`;

  // Attempt the call (with one retry on failure)
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`HTTP ${res.status}: ${errBody}`);
      }

      const json = await res.json();

      // Extract the text from the first candidate
      const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      // Store in cache
      if (text) {
        _cacheSet(cacheKey, text);
      }

      return text;
    } catch (err) {
      console.warn(
        `[gemini] Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        err.message,
      );

      // If we've exhausted retries, give up
      if (attempt === MAX_RETRIES) {
        return null;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// JSON-response helper
// ---------------------------------------------------------------------------

/**
 * Parse a JSON value from the model's response text.
 * Handles raw JSON as well as markdown-fenced code blocks (```json ... ```).
 */
function extractJSON(text) {
  if (!text) return null;

  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();

  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[gemini] Failed to parse JSON from response.');
    return null;
  }
}

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

/**
 * Parse raw resume text into structured data.
 *
 * @param {string} rawText - Plain-text resume content.
 * @returns {Promise<Object|null>} Structured resume object or null.
 */
export async function parseResumeWithGemini(rawText, { skipCache } = {}) {
  const prompt = `You are an expert resume parser. Extract the following structured data from this resume text. Return ONLY valid JSON with no explanation.

JSON schema:
{
  "fullName": "string",
  "email": "string or null",
  "phone": "string or null",
  "location": "string or null",
  "linkedin": "string or null",
  "portfolio": "string or null",
  "summary": "string or null",
  "experiences": [
    {
      "company": "string",
      "title": "string",
      "startDate": "string",
      "endDate": "string or null",
      "current": false,
      "bullets": ["string"]
    }
  ],
  "education": [
    {
      "school": "string",
      "degree": "string",
      "field": "string or null",
      "year": "string or null"
    }
  ],
  "skills": ["string"],
  "certifications": "string or null"
}

Resume text:
"""
${rawText}
"""`;

  const response = await askGemini(prompt, {
    temperature: 0.3,
    responseFormat: 'json',
    skipCache,
  });

  return extractJSON(response);
}

/**
 * Analyse a job description and extract key information.
 *
 * @param {string} jdText - The job description text.
 * @returns {Promise<Object|null>} Structured JD object or null.
 */
export async function analyzeJDWithGemini(jdText, { skipCache } = {}) {
  const prompt = `You are an expert job-description analyst. Extract the following structured information from this job description. Return ONLY valid JSON with no explanation.

JSON schema:
{
  "companyName": "string or null",
  "roleTitle": "string or null",
  "companyDoes": "string — one-sentence description of what the company does",
  "requirements": ["string — each key requirement"],
  "skills": ["string — each required or preferred skill"],
  "culture": "string or null — brief description of company culture cues"
}

Job Description:
"""
${jdText}
"""`;

  const response = await askGemini(prompt, {
    temperature: 0.3,
    responseFormat: 'json',
    skipCache,
  });

  return extractJSON(response);
}

/**
 * Rewrite a single bullet point to be more impactful.
 *
 * @param {string} bullet         - The original bullet text.
 * @param {Object} context        - Supporting context.
 * @param {string} context.title  - Job title for this experience.
 * @param {string} context.company - Company name.
 * @param {string} [context.jdText] - Optional job description for tailoring.
 * @returns {Promise<string|null>} The enhanced bullet or null.
 */
export async function enhanceBulletWithGemini(bullet, context = {}, { skipCache } = {}) {
  const { title, company, jdText, industries } = context;

  const jdSection = jdText
    ? `\nTarget job description for context:\n"""${jdText}"""\n`
    : '';

  // Find matching winning patterns for this bullet
  let patternsSection = '';
  if (industries && industries.length > 0) {
    const matchedPatterns = findMatchingPatterns(bullet, industries, 3);
    if (matchedPatterns.length > 0) {
      const patternLines = matchedPatterns
        .map((p) => `- "${p.pattern}"`)
        .join('\n');
      patternsSection = `
PROVEN PATTERNS FOR THIS INDUSTRY (use as structural guidance, not verbatim):
${patternLines}

RULES:
- Follow one of these patterns IF it naturally fits. Do NOT force a pattern that doesn't match.
- Use ONLY facts from the user's original bullet. Do NOT fabricate numbers or metrics.
- If the user's bullet has no numbers, use qualitative impact instead. Never invent statistics.
`;
    }
  }

  const prompt = `You are an expert resume writer. Rewrite the following resume bullet point to be more impactful, using strong action verbs, quantifiable results where possible, and concise professional language.

Role: ${title || 'N/A'} at ${company || 'N/A'}
${jdSection}${patternsSection}
Original bullet:
"${bullet}"

Return ONLY the rewritten bullet text — no quotes, no explanation, no preamble.`;

  const response = await askGemini(prompt, { temperature: 0.7, skipCache });
  return response?.trim() || null;
}

/**
 * Generate a professional summary paragraph.
 *
 * @param {Object}  data       - The candidate's resume data.
 * @param {Object}  jobContext - { companyName, roleTitle, companyDoes, requirements, skills }.
 * @param {string}  style      - One of 'xyz', 'impact-first', 'narrative', 'achievement-led', 'concise'.
 * @returns {Promise<string|null>} Generated summary text or null.
 */
export async function generateSummaryWithGemini(data, jobContext = {}, style = 'impact-first', { skipCache } = {}) {
  const styleDescriptions = {
    xyz: 'Use the XYZ formula: "Accomplished [X] as measured by [Y], by doing [Z]." Weave accomplishments into a flowing summary.',
    'impact-first': 'Lead with the candidate\'s most impressive impact or result, then provide supporting context.',
    narrative: 'Write in a brief narrative style that tells the candidate\'s professional story in 3-4 sentences.',
    'achievement-led': 'Open with a headline-worthy achievement, then summarize experience and skills.',
    concise: 'Write a punchy 1-2 sentence summary focusing on years of experience, core expertise, and key differentiator.',
  };

  const experienceSnippet = (data.experiences || [])
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company}`)
    .join('; ');

  const skillsSnippet = (data.skills || []).join(', ');

  const jdThemes = jobContext.requirements
    ? `Target role: ${jobContext.roleTitle || 'N/A'} at ${jobContext.companyName || 'N/A'}.
Key requirements: ${jobContext.requirements.join(', ')}.
Desired skills: ${(jobContext.skills || []).join(', ')}.`
    : '';

  const prompt = `You are an expert resume writer. Generate a professional summary for a resume.

Style instruction: ${styleDescriptions[style] || styleDescriptions['impact-first']}

Candidate info:
- Name: ${data.fullName || 'N/A'}
- Recent roles: ${experienceSnippet || 'N/A'}
- Skills: ${skillsSnippet || 'N/A'}
- Current summary (if any): ${data.summary || 'None'}

${jdThemes}

Return ONLY the summary text — no quotes, no labels, no explanation.`;

  const response = await askGemini(prompt, { temperature: 0.7, skipCache });
  return response?.trim() || null;
}

/**
 * Tailor an entire resume toward a specific job description.
 *
 * @param {Object} data       - Full structured resume data.
 * @param {Object} jobContext - Analysed JD context.
 * @returns {Promise<Object|null>} Tailored result object or null.
 */
export async function tailorResumeWithGemini(data, jobContext, { skipCache } = {}) {
  const experiencesBlock = (data.experiences || [])
    .map((exp, idx) => {
      const bullets = (exp.bullets || []).map((b) => `  - ${b}`).join('\n');
      return `Experience #${idx}: ${exp.title} at ${exp.company}\n${bullets}`;
    })
    .join('\n\n');

  // Gather all bullet text to find industry-relevant patterns
  const allBullets = (data.experiences || [])
    .flatMap((exp) => exp.bullets || [])
    .join(' ');
  const industries = jobContext.industries || [];
  let patternsSection = '';

  if (industries.length > 0) {
    const matchedPatterns = findMatchingPatterns(allBullets, industries, 3);
    if (matchedPatterns.length > 0) {
      const patternLines = matchedPatterns
        .map((p) => `- "${p.pattern}" (${p.context})`)
        .join('\n');
      patternsSection = `
PROVEN PATTERNS FOR THIS INDUSTRY (use as structural guidance for bullet rewrites, not verbatim):
${patternLines}

PATTERN RULES:
- Follow one of these patterns IF it naturally fits a bullet. Do NOT force a pattern that doesn't match.
- Use ONLY facts from the candidate's original bullets. Do NOT fabricate numbers or metrics.
- If a bullet has no numbers, use qualitative impact instead. Never invent statistics.
`;
    }
  }

  const prompt = `You are an expert resume tailoring assistant. Given a candidate's resume data and a target job description context, rewrite the resume to better match the job.

Candidate resume:
- Summary: ${data.summary || 'None'}
- Skills: ${(data.skills || []).join(', ')}
- Experiences:
${experiencesBlock}

Target job:
- Role: ${jobContext.roleTitle || 'N/A'} at ${jobContext.companyName || 'N/A'}
- Company does: ${jobContext.companyDoes || 'N/A'}
- Requirements: ${(jobContext.requirements || []).join(', ')}
- Desired skills: ${(jobContext.skills || []).join(', ')}
${patternsSection}
Return ONLY valid JSON matching this schema:
{
  "summary": "string — rewritten professional summary",
  "experiences": [
    {
      "expIdx": 0,
      "bullets": [
        {
          "original": "original bullet text",
          "rewritten": "improved bullet text",
          "changed": true
        }
      ]
    }
  ],
  "skills": ["string — full tailored skills list"],
  "skillsAdded": ["string — newly suggested skills"],
  "changeCount": 0
}

Guidelines:
- Keep truthful to the candidate's actual experience — do not fabricate.
- Incorporate keywords from the job description naturally.
- Use strong action verbs and quantify impact where possible.
- Mark "changed" as false for bullets that are already strong.
- changeCount should reflect total bullets + summary changes made.`;

  const response = await askGemini(prompt, {
    temperature: 0.7,
    responseFormat: 'json',
    skipCache,
  });

  return extractJSON(response);
}

/**
 * Analyse how well a resume matches a job description.
 *
 * @param {Object} data   - Structured resume data.
 * @param {string} jdText - Raw job description text.
 * @returns {Promise<Object|null>} Fit-analysis result or null.
 */
export async function analyzeJobFitWithGemini(data, jdText, { skipCache } = {}) {
  const experiencesBlock = (data.experiences || [])
    .map((exp) => {
      const bullets = (exp.bullets || []).map((b) => `  - ${b}`).join('\n');
      return `${exp.title} at ${exp.company}\n${bullets}`;
    })
    .join('\n\n');

  const prompt = `You are an expert career coach. Analyse how well this candidate's resume fits the given job description.

Candidate resume:
- Summary: ${data.summary || 'None'}
- Skills: ${(data.skills || []).join(', ')}
- Experiences:
${experiencesBlock}
- Education: ${(data.education || []).map((e) => `${e.degree} in ${e.field || 'N/A'} from ${e.school}`).join('; ')}

Job Description:
"""
${jdText}
"""

Return ONLY valid JSON matching this schema:
{
  "overall": "string — brief overall fit assessment (1-2 sentences)",
  "matchedSkills": ["string — skills the candidate has that match the JD"],
  "stretchSkills": ["string — skills the candidate partially has or could argue"],
  "missingSkills": ["string — skills from the JD that the candidate lacks"],
  "requirements": {
    "met": ["string — JD requirements the candidate meets"],
    "missing": ["string — JD requirements the candidate does not clearly meet"]
  },
  "cultureFit": "string — brief culture-fit assessment based on available info"
}`;

  const response = await askGemini(prompt, {
    temperature: 0.3,
    responseFormat: 'json',
    skipCache,
  });

  return extractJSON(response);
}

/**
 * Generate "stand-out" suggestions — personalised winning bullet ideas
 * that could help the candidate differentiate themselves.
 *
 * @param {Object} data       - Structured resume data.
 * @param {Object} jobContext - Analysed JD context.
 * @returns {Promise<string|null>} Stand-out suggestions text or null.
 */
export async function generateStandOutWithGemini(data, jobContext, { skipCache } = {}) {
  const experiencesBlock = (data.experiences || [])
    .map((exp) => {
      const bullets = (exp.bullets || []).map((b) => `  - ${b}`).join('\n');
      return `${exp.title} at ${exp.company}\n${bullets}`;
    })
    .join('\n\n');

  const prompt = `You are a career strategist helping a candidate stand out for a specific role. Based on their resume and the target job, suggest personalised "winning bullet" ideas — concrete accomplishments or framing strategies the candidate could highlight to differentiate themselves.

Candidate resume:
- Name: ${data.fullName || 'N/A'}
- Summary: ${data.summary || 'None'}
- Skills: ${(data.skills || []).join(', ')}
- Experiences:
${experiencesBlock}

Target role: ${jobContext.roleTitle || 'N/A'} at ${jobContext.companyName || 'N/A'}
Company does: ${jobContext.companyDoes || 'N/A'}
Key requirements: ${(jobContext.requirements || []).join(', ')}
Desired skills: ${(jobContext.skills || []).join(', ')}
Culture: ${jobContext.culture || 'N/A'}

Provide 4-6 personalised, actionable suggestions. For each, explain WHY it would resonate with this employer and give a sample bullet the candidate could adapt. Be specific to their actual experience — do not fabricate accomplishments, but suggest how to reframe or quantify existing ones.`;

  const response = await askGemini(prompt, { temperature: 0.7, skipCache });
  return response?.trim() || null;
}
