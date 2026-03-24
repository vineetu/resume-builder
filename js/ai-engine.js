/**
 * ai-engine.js — AI-powered resume enhancement engine for Resume Forge.
 *
 * Provides functions that generate suggestions, enhance bullet points,
 * tailor resumes, and produce stand-out recommendations.  Each function
 * attempts Gemini first and falls back to deterministic logic when the
 * API key is unavailable or the call fails.
 *
 * @module ai-engine
 */

import { ACTION_VERBS, WINNING_BULLETS, LEARNING_PATHS } from './constants.js';
import {
  askGemini,
  enhanceBulletWithGemini,
  generateSummaryWithGemini,
  tailorResumeWithGemini,
  generateStandOutWithGemini,
  hasApiKey,
} from './gemini.js';
import {
  extractMetrics,
  detectIndustries,
  analyzeCompanyCulture,
  findPivot,
} from './analyzer.js';
import {
  findMatchingPatterns,
  extractBulletMetrics,
  tryFillPattern,
} from './pattern-matcher.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic hash for a string.  Used wherever we need repeatable
 * pseudo-random selection (verb / metric choices) without Math.random.
 *
 * @param {string} text
 * @returns {number} A 32-bit integer hash.
 */
function deterministicHash(text) {
  return text.split('').reduce(
    (acc, ch) => ((acc << 5) - acc + ch.charCodeAt(0)) | 0,
    0,
  );
}

/**
 * Pick an element from an array using a deterministic hash.
 *
 * @param {Array} arr  - The source array.
 * @param {string} seed - A seed string for the hash.
 * @returns {*} The selected element.
 */
function pickByHash(arr, seed) {
  if (!arr || arr.length === 0) return undefined;
  const idx = Math.abs(deterministicHash(seed)) % arr.length;
  return arr[idx];
}

/**
 * Check whether a bullet begins with a strong action verb (past tense).
 *
 * @param {string} text
 * @returns {boolean}
 */
function startsWithActionVerb(text) {
  if (!text) return false;
  const firstWord = text.trim().split(/\s+/)[0].toLowerCase();
  return ACTION_VERBS.some((v) => v.toLowerCase() === firstWord);
}

/**
 * Return true if the text contains at least one numeric token.
 *
 * @param {string} text
 * @returns {boolean}
 */
function containsNumber(text) {
  return /\d/.test(text);
}

/**
 * Collect all bullet text from the resume into a single string for mining.
 *
 * @param {Object} data - Resume data.
 * @returns {string}
 */
function allBulletText(data) {
  return (data.experiences || [])
    .flatMap((exp) => exp.bullets || [])
    .join(' ');
}

/**
 * Mine real metrics from the entire CV text.
 * Returns an object with arrays of revenue figures, percentages, team sizes,
 * and scale indicators found in the resume.
 *
 * @param {Object} data
 * @returns {{ revenue: string[], percentages: string[], teamSizes: string[], scale: string[] }}
 */
function mineMetrics(data) {
  const text = `${data.summary || ''} ${allBulletText(data)}`;

  const revenue = [...text.matchAll(/\$[\d,.]+[MBKmk]?/g)].map((m) => m[0]);
  const percentages = [...text.matchAll(/\d+%/g)].map((m) => m[0]);
  const teamSizes = [...text.matchAll(/(?:team of |led |managed )(\d+)/gi)].map(
    (m) => m[1],
  );
  const scale = [
    ...text.matchAll(/(\d[\d,]*\+?\s*(?:users|customers|clients|endpoints|servers|transactions|records|requests))/gi),
  ].map((m) => m[0]);

  return { revenue, percentages, teamSizes, scale };
}

/**
 * Extract career-level data from the resume: titles, companies, and an
 * estimated total years of experience.
 *
 * @param {Object} data
 * @returns {{ titles: string[], companies: string[], yearsOfExperience: number }}
 */
function extractCareerData(data) {
  const experiences = data.experiences || [];
  const titles = experiences.map((e) => e.title).filter(Boolean);
  const companies = experiences.map((e) => e.company).filter(Boolean);

  // Estimate years from start/end dates
  let totalMonths = 0;
  for (const exp of experiences) {
    if (!exp.startDate) continue;
    const start = new Date(exp.startDate);
    const end = exp.current || !exp.endDate ? new Date() : new Date(exp.endDate);
    if (!isNaN(start) && !isNaN(end)) {
      totalMonths += Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30));
    }
  }
  const yearsOfExperience = Math.round(totalMonths / 12);

  return { titles, companies, yearsOfExperience };
}

/**
 * Extract JD themes using regex patterns.
 * Returns an object with arrays of required skills, soft skills, tools,
 * and action phrases found in the JD text.
 *
 * @param {string} jdText
 * @returns {{ skills: string[], softSkills: string[], tools: string[], actionPhrases: string[] }}
 */
function extractJDThemes(jdText) {
  if (!jdText) return { skills: [], softSkills: [], tools: [], actionPhrases: [] };

  const lower = jdText.toLowerCase();

  // Technical skills & tools — words near "experience with", "proficiency in", etc.
  const skillPatterns = [
    /(?:experience (?:with|in)|proficiency in|knowledge of|skilled in|expertise in)\s+([^.,;\n]+)/gi,
    /(?:familiar(?:ity)? with)\s+([^.,;\n]+)/gi,
  ];
  const skills = [];
  for (const pat of skillPatterns) {
    for (const m of jdText.matchAll(pat)) {
      skills.push(m[1].trim());
    }
  }

  // Soft skills
  const softSkillKeywords = [
    'communication', 'leadership', 'collaboration', 'teamwork',
    'problem-solving', 'critical thinking', 'adaptability', 'time management',
    'attention to detail', 'creativity', 'self-motivated', 'initiative',
    'interpersonal', 'organizational', 'analytical', 'strategic',
    'mentoring', 'coaching', 'presentation', 'negotiation',
  ];
  const softSkills = softSkillKeywords.filter((s) => lower.includes(s));

  // Tools / technologies — capitalized words or common tech patterns
  const toolPatterns = /\b(?:AWS|GCP|Azure|Docker|Kubernetes|React|Angular|Vue|Node\.?js|Python|Java|SQL|NoSQL|MongoDB|PostgreSQL|Redis|Kafka|Terraform|Jenkins|Git|CI\/CD|REST|GraphQL|TypeScript|JavaScript|Go|Rust|Scala|Spark|Hadoop|Tableau|Power\s?BI|Figma|Jira|Confluence|Slack|Salesforce|SAP|Snowflake)\b/gi;
  const tools = [...new Set([...jdText.matchAll(toolPatterns)].map((m) => m[0]))];

  // Action phrases (requirements-style)
  const actionPhrasePatterns = /(?:ability to|proven|demonstrated|track record of|responsible for|experience in)\s+([^.,;\n]+)/gi;
  const actionPhrases = [];
  for (const m of jdText.matchAll(actionPhrasePatterns)) {
    actionPhrases.push(m[1].trim());
  }

  return { skills, softSkills, tools, actionPhrases };
}

/**
 * Infer a plausible metric suffix for a bullet based on its content.
 *
 * @param {string} text
 * @param {string} seed - hash seed for deterministic selection
 * @returns {string} A metric clause to append.
 */
function inferMetric(text, seed) {
  const lower = text.toLowerCase();

  const metricOptions = [];

  if (/(?:reduc|improv|increas|optimiz|enhanc|accelerat)/i.test(lower)) {
    metricOptions.push(
      ', resulting in a 15% improvement',
      ', achieving a 20% increase in efficiency',
      ', reducing processing time by 30%',
    );
  }
  if (/(?:led|managed|coordinated|directed|oversaw)/i.test(lower)) {
    metricOptions.push(
      ' across a cross-functional team of 5+',
      ', managing 3 concurrent workstreams',
    );
  }
  if (/(?:develop|built|created|designed|implemented|launched)/i.test(lower)) {
    metricOptions.push(
      ', serving 1,000+ users',
      ', adopted by 3 internal teams',
    );
  }
  if (/(?:automat|streamlin|migrat)/i.test(lower)) {
    metricOptions.push(
      ', saving 10+ hours per week',
      ', eliminating 4 manual steps',
    );
  }

  // Fallback generic metrics
  if (metricOptions.length === 0) {
    metricOptions.push(
      ', contributing to team KPI targets',
      ', supporting quarterly business objectives',
    );
  }

  return pickByHash(metricOptions, seed);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract exact JD phrases for mirroring.
 * Finds action-oriented requirements and bullet requirements from the JD text,
 * deduplicates them, and limits the result to 20 phrases.
 *
 * Port from JSX lines 696-704.
 *
 * @param {string} jdText - Raw job description text.
 * @returns {string[]} Up to 20 unique JD phrases.
 */
export function extractJDPhrases(jdText) {
  if (!jdText) return [];

  const phrases = [];

  // Action-oriented requirements
  const actionPatterns = /(?:ability to|proven|demonstrated|track record of|experience (?:with|in)|responsible for|skilled in|expertise in|proficiency in)\s+([^.,;\n]+)/gi;
  for (const m of jdText.matchAll(actionPatterns)) {
    const phrase = m[1].trim();
    if (phrase.length > 5 && phrase.length < 120) {
      phrases.push(phrase);
    }
  }

  // Bullet requirements — lines starting with bullet chars
  const bulletLines = jdText.split('\n')
    .filter((line) => /^\s*[\u2022\-\*\u25CF\u25CB\u25AA\u2023]\s*/.test(line))
    .map((line) => line.replace(/^\s*[\u2022\-\*\u25CF\u25CB\u25AA\u2023]\s*/, '').trim())
    .filter((line) => line.length > 10 && line.length < 150);

  phrases.push(...bulletLines);

  // Deduplicate (case-insensitive) and limit to 20
  const seen = new Set();
  const unique = [];
  for (const phrase of phrases) {
    const key = phrase.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(phrase);
    }
    if (unique.length >= 20) break;
  }

  return unique;
}

/**
 * Enhance a single resume bullet point.
 * Tries Gemini first for a contextual rewrite; falls back to deterministic
 * improvements (prepending an action verb if missing, appending an inferred
 * metric if no numbers are present).
 *
 * @param {string} text            - The original bullet text.
 * @param {Object} [context={}]    - Optional context.
 * @param {string} [context.title] - Job title for this experience.
 * @param {string} [context.company] - Company name.
 * @param {string} [context.jdText]  - Job description text for tailoring.
 * @returns {Promise<string>} The enhanced bullet text.
 */
export async function enhanceBullet(text, context = {}, options = {}) {
  if (!text || !text.trim()) return text;
  const { skipCache } = options;

  // --- Gemini path ---
  if (hasApiKey()) {
    try {
      const result = await enhanceBulletWithGemini(text, context, { skipCache });
      if (result) return result;
    } catch (err) {
      console.warn('[ai-engine] Gemini enhanceBullet failed, using fallback:', err.message);
    }
  }

  // --- Deterministic fallback ---
  let enhanced = text.trim();

  // 1. Prepend an action verb if the bullet doesn't start with one
  if (!startsWithActionVerb(enhanced)) {
    const verb = pickByHash(ACTION_VERBS, enhanced);
    if (verb) {
      // Lower-case the first letter of the existing text to merge naturally
      enhanced = `${verb} ${enhanced.charAt(0).toLowerCase()}${enhanced.slice(1)}`;
    }
  }

  // 2. Append an inferred metric if the bullet has no numbers
  if (!containsNumber(enhanced)) {
    const metric = inferMetric(enhanced, text);
    if (metric) {
      // Strip trailing period before appending
      enhanced = enhanced.replace(/\.\s*$/, '') + metric;
    }
  }

  // Ensure it ends with a period
  if (!/[.!]$/.test(enhanced.trim())) {
    enhanced = enhanced.trim() + '.';
  }

  return enhanced;
}

/**
 * Generate per-section AI suggestions for an entire resume.
 * Tries Gemini for a holistic analysis; falls back to deterministic logic
 * that mines the user's real metrics and cross-references JD keywords.
 *
 * Port from JSX lines 706-956.
 *
 * @param {Object} data       - Full structured resume data.
 * @param {Object} jobContext  - { jdText, jdInfo: { companyName, roleTitle, requirements, skills, ... } }.
 * @returns {Promise<Object>} Suggestions object (see module JSDoc for shape).
 */
export async function generateAISuggestions(data, jobContext = {}, options = {}) {
  const jdText = jobContext.jdText || '';
  const jdInfo = jobContext.jdInfo || {};
  const { skipCache } = options;

  // --- Gemini path ---
  if (hasApiKey() && jdText) {
    try {
      // Build a structured prompt and ask Gemini for JSON suggestions
      const experiencesBlock = (data.experiences || [])
        .map((exp, idx) => {
          const bullets = (exp.bullets || []).map((b) => `  - ${b}`).join('\n');
          return `Experience #${idx}: ${exp.title} at ${exp.company}\n${bullets}`;
        })
        .join('\n\n');

      const prompt = `You are an expert resume coach. Analyse this resume against the job description and provide specific improvement suggestions. Return ONLY valid JSON.

Resume:
- Summary: ${data.summary || 'None'}
- Skills: ${(data.skills || []).join(', ')}
- Experiences:
${experiencesBlock}

Job Description:
"""
${jdText}
"""

JSON schema:
{
  "summary": {
    "current": "current summary or empty string",
    "suggested": "improved summary tailored to job",
    "roleName": "target role title",
    "companyName": "target company name"
  },
  "experience": [
    {
      "expIdx": 0,
      "title": "job title",
      "company": "company name",
      "suggestions": [
        {
          "type": "rewrite|new|gap",
          "originalBulletIdx": null,
          "original": "original bullet or null",
          "text": "suggested bullet text",
          "bulletTemplate": null
        }
      ]
    }
  ],
  "skills": [
    { "skill": "skill name", "reason": "why it matters", "inCV": false }
  ],
  "needsMoreContext": [],
  "missingCount": 0,
  "matchedCount": 0,
  "overallFit": "brief fit assessment"
}`;

      const response = await askGemini(prompt, {
        temperature: 0.5,
        responseFormat: 'json',
        skipCache,
      });

      if (response) {
        // Try to parse the JSON response
        const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/);
        const raw = fenced ? fenced[1].trim() : response.trim();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.summary) return parsed;
          console.warn('[ai-engine] Parsed OK but no .summary field. Keys:', Object.keys(parsed || {}));
        } catch (parseErr) {
          console.warn('[ai-engine] Failed to parse Gemini suggestions JSON. Raw response:', raw?.substring(0, 500));
          console.warn('[ai-engine] Parse error:', parseErr.message);
        }
      }
    } catch (err) {
      console.warn('[ai-engine] Gemini generateAISuggestions failed:', err.message);
    }
  }

  // --- Deterministic fallback ---
  return _generateSuggestionsDeterministic(data, jdText, jdInfo);
}

/**
 * Deterministic suggestion generator (fallback).
 * @private
 */
function _generateSuggestionsDeterministic(data, jdText, jdInfo) {
  // 1. Mine user's real metrics
  const metrics = mineMetrics(data);
  const career = extractCareerData(data);
  const jdThemes = extractJDThemes(jdText);
  const jdPhrases = extractJDPhrases(jdText);

  const roleName = jdInfo.roleTitle || career.titles[0] || 'the target role';
  const companyName = jdInfo.companyName || '';

  // Combine all JD keywords for matching
  const jdKeywords = [
    ...jdThemes.skills,
    ...jdThemes.tools,
    ...jdThemes.softSkills,
    ...(jdInfo.skills || []),
  ].map((s) => s.toLowerCase());
  const uniqueJDKeywords = [...new Set(jdKeywords)];

  // All resume text for matching
  const resumeTextLower = `${data.summary || ''} ${allBulletText(data)} ${(data.skills || []).join(' ')}`.toLowerCase();

  // Track matched and missing
  let matchedCount = 0;
  let missingCount = 0;
  const missingKeywords = [];

  for (const kw of uniqueJDKeywords) {
    if (resumeTextLower.includes(kw)) {
      matchedCount++;
    } else {
      missingCount++;
      missingKeywords.push(kw);
    }
  }

  // 4. Generate tailored summary
  const summaryParts = [];
  if (career.yearsOfExperience > 0) {
    summaryParts.push(`${career.yearsOfExperience}+ years of experience`);
  }
  if (career.titles.length > 0) {
    summaryParts.push(`as a ${career.titles[0]}`);
  }
  if (metrics.revenue.length > 0) {
    summaryParts.push(`driving ${metrics.revenue[0]}+ in business impact`);
  }
  if (jdThemes.tools.length > 0) {
    summaryParts.push(`with expertise in ${jdThemes.tools.slice(0, 3).join(', ')}`);
  }
  if (jdThemes.actionPhrases.length > 0) {
    summaryParts.push(`and a track record of ${jdThemes.actionPhrases[0].toLowerCase()}`);
  }
  if (companyName) {
    summaryParts.push(`seeking to contribute to ${companyName}`);
  }

  const suggestedSummary = summaryParts.length > 0
    ? `Results-driven professional with ${summaryParts.join(', ')}.`
    : data.summary || '';

  // 5. Per-experience bullet suggestions
  const experienceSuggestions = [];

  for (let expIdx = 0; expIdx < (data.experiences || []).length; expIdx++) {
    const exp = data.experiences[expIdx];
    if (!exp.title && !exp.company) continue;

    const bullets = exp.bullets || [];
    const expTextLower = bullets.join(' ').toLowerCase();

    // Find JD keywords missing from this experience
    const missingFromExp = missingKeywords.filter(
      (kw) => !expTextLower.includes(kw),
    );

    // Find JD phrases this experience could address
    const relevantPhrases = jdPhrases.filter((phrase) => {
      const phraseLower = phrase.toLowerCase();
      // Check if any word in the experience text overlaps with the phrase
      const expWords = expTextLower.split(/\s+/);
      return expWords.some((w) => w.length > 3 && phraseLower.includes(w));
    });

    const suggestions = [];

    // Rewrite weak bullets with JD-mirrored language
    for (let bIdx = 0; bIdx < bullets.length; bIdx++) {
      const bullet = bullets[bIdx];
      if (!bullet || !bullet.trim()) continue;

      const isWeak = !startsWithActionVerb(bullet) || !containsNumber(bullet);

      if (isWeak) {
        // Build a rewritten version
        let rewritten = bullet.trim();

        // Add action verb if missing
        if (!startsWithActionVerb(rewritten)) {
          const verb = pickByHash(ACTION_VERBS, `${rewritten}${expIdx}${bIdx}`);
          if (verb) {
            rewritten = `${verb} ${rewritten.charAt(0).toLowerCase()}${rewritten.slice(1)}`;
          }
        }

        // Inject a relevant JD phrase if available
        if (relevantPhrases.length > 0) {
          const phrase = pickByHash(relevantPhrases, `${rewritten}${bIdx}`);
          if (phrase && !rewritten.toLowerCase().includes(phrase.toLowerCase())) {
            rewritten = rewritten.replace(/\.\s*$/, '') + `, demonstrating ${phrase.toLowerCase()}.`;
          }
        }

        // Add metric if missing
        if (!containsNumber(rewritten)) {
          const metric = inferMetric(rewritten, `${bullet}${expIdx}`);
          if (metric) {
            rewritten = rewritten.replace(/\.\s*$/, '') + metric + '.';
          }
        }

        // Ensure period
        if (!/[.!]$/.test(rewritten.trim())) {
          rewritten = rewritten.trim() + '.';
        }

        if (rewritten !== bullet) {
          suggestions.push({
            type: 'rewrite',
            originalBulletIdx: bIdx,
            original: bullet,
            text: rewritten,
            bulletTemplate: null,
          });
        }
      }
    }

    // Suggest new bullets for major gaps
    const addressedGaps = new Set();
    for (const kw of missingFromExp.slice(0, 3)) {
      if (addressedGaps.has(kw)) continue;
      addressedGaps.add(kw);

      // Build a gap-filling bullet using the keyword and relevant context
      const verb = pickByHash(ACTION_VERBS, `gap-${kw}-${expIdx}`);
      let gapBullet = `${verb} ${kw}-related initiatives`;

      // Add context from user's metrics if available
      if (metrics.percentages.length > 0) {
        const pct = pickByHash(metrics.percentages, `pct-${kw}`);
        gapBullet += `, achieving ${pct} improvement in key outcomes`;
      } else if (metrics.teamSizes.length > 0) {
        const size = pickByHash(metrics.teamSizes, `team-${kw}`);
        gapBullet += ` across a team of ${size}`;
      }

      gapBullet += '.';

      suggestions.push({
        type: 'gap',
        originalBulletIdx: null,
        original: null,
        text: gapBullet,
        bulletTemplate: `[Action verb] [${kw}] [quantified result]`,
      });
    }

    if (suggestions.length > 0) {
      experienceSuggestions.push({
        expIdx,
        title: exp.title || '',
        company: exp.company || '',
        suggestions,
      });
    }
  }

  // 6. Skills suggestions — JD skills not in user's skills list
  const userSkillsLower = (data.skills || []).map((s) => s.toLowerCase());
  const skillSuggestions = [];

  for (const kw of uniqueJDKeywords) {
    if (!userSkillsLower.includes(kw) && !userSkillsLower.some((s) => s.includes(kw) || kw.includes(s))) {
      // Check if it appears somewhere in the resume text
      const inCV = resumeTextLower.includes(kw);
      skillSuggestions.push({
        skill: kw,
        reason: inCV
          ? 'Found in your experience but not listed as a skill'
          : 'Required in the job description but not found in your resume',
        inCV,
      });
    }
  }

  // Determine areas that need more context
  const needsMoreContext = [];
  if (!data.summary) needsMoreContext.push('Professional summary is missing');
  if ((data.skills || []).length < 3) needsMoreContext.push('Skills section needs more entries');
  if ((data.experiences || []).some((e) => (e.bullets || []).filter(Boolean).length < 2)) {
    needsMoreContext.push('Some experiences have fewer than 2 bullet points');
  }

  const overallFit = matchedCount + missingCount > 0
    ? `Your resume matches ${matchedCount} of ${matchedCount + missingCount} key JD requirements (${Math.round((matchedCount / (matchedCount + missingCount)) * 100)}% keyword match).`
    : 'Unable to assess fit — no JD keywords found.';

  return {
    summary: {
      current: data.summary || '',
      suggested: suggestedSummary,
      roleName,
      companyName,
    },
    experience: experienceSuggestions,
    skills: skillSuggestions,
    needsMoreContext,
    missingCount,
    matchedCount,
    overallFit,
  };
}

/**
 * Generate 5 summary style variants.
 * Tries Gemini for each style, falls back to template-string construction
 * using the user's real data.
 *
 * Styles:
 * 1. X-Y-Z (Laszlo Bock) -- Google-Approved
 * 2. Impact-First -- Recruiter-Optimized
 * 3. Narrative -- Career Story Arc
 * 4. Achievement-Led -- Data-Centric
 * 5. Concise Power Statement -- ATS-Optimized
 *
 * @param {Object} data       - Full structured resume data.
 * @param {Object} jobContext  - { jdText, jdInfo }.
 * @returns {Promise<Array<{ style: string, label: string, text: string }>>}
 */
export async function generateSummaryVariations(data, jobContext = {}, options = {}) {
  const jdInfo = jobContext.jdInfo || {};
  const jdText = jobContext.jdText || '';

  const styles = [
    { key: 'xyz', label: 'Google-Approved (X-Y-Z)' },
    { key: 'impact-first', label: 'Recruiter-Optimized (Impact-First)' },
    { key: 'narrative', label: 'Career Story Arc (Narrative)' },
    { key: 'achievement-led', label: 'Data-Centric (Achievement-Led)' },
    { key: 'concise', label: 'ATS-Optimized (Concise Power Statement)' },
  ];

  const results = [];

  // Extract common data for fallback templates
  const career = extractCareerData(data);
  const metrics = mineMetrics(data);
  const jdThemes = extractJDThemes(jdText);
  const currentTitle = career.titles[0] || 'professional';
  const years = career.yearsOfExperience;
  const topCompanies = career.companies.slice(0, 2).join(' and ') || 'leading organizations';
  const topMetric = metrics.revenue[0] || metrics.percentages[0] || '';
  const topTools = jdThemes.tools.slice(0, 3).join(', ') || (data.skills || []).slice(0, 3).join(', ') || '';
  const roleName = jdInfo.roleTitle || currentTitle;
  const companyName = jdInfo.companyName || '';

  for (const { key, label } of styles) {
    // --- Gemini path ---
    if (hasApiKey()) {
      try {
        const geminiResult = await generateSummaryWithGemini(data, jdInfo, key, { skipCache: options.skipCache });
        if (geminiResult) {
          results.push({ style: key, label, text: geminiResult });
          continue;
        }
      } catch (err) {
        console.warn(`[ai-engine] Gemini summary variant "${key}" failed:`, err.message);
      }
    }

    // --- Deterministic fallback ---
    let text = '';

    switch (key) {
      case 'xyz':
        // X-Y-Z (Laszlo Bock): Accomplished [X] as measured by [Y], by doing [Z]
        text = _buildXYZSummary(currentTitle, years, topMetric, topTools, topCompanies, roleName, companyName, jdThemes);
        break;

      case 'impact-first':
        // Impact-First: lead with most impressive result
        text = _buildImpactFirstSummary(currentTitle, years, metrics, topTools, roleName, companyName, jdThemes);
        break;

      case 'narrative':
        // Narrative: career story arc
        text = _buildNarrativeSummary(currentTitle, years, career, metrics, topTools, roleName, companyName);
        break;

      case 'achievement-led':
        // Achievement-Led: data-centric
        text = _buildAchievementLedSummary(currentTitle, years, metrics, topTools, roleName, companyName, jdThemes);
        break;

      case 'concise':
        // Concise Power Statement: ATS-optimized
        text = _buildConciseSummary(currentTitle, years, topTools, roleName, companyName, jdThemes);
        break;

      default:
        text = data.summary || '';
    }

    results.push({ style: key, label, text });
  }

  return results;
}

// --- Summary template builders (private) ---

function _buildXYZSummary(currentTitle, years, topMetric, topTools, topCompanies, roleName, companyName, jdThemes) {
  const xPart = years > 0
    ? `Drove organizational growth over ${years}+ years as a ${currentTitle}`
    : `Delivered measurable impact as a ${currentTitle}`;
  const yPart = topMetric
    ? `as measured by ${topMetric} in business outcomes`
    : 'as measured by consistently exceeding performance targets';
  const zPart = topTools
    ? `by leveraging ${topTools} and cross-functional collaboration`
    : 'by applying strategic problem-solving and team leadership';

  const companyRef = companyName ? ` Eager to bring this impact to ${companyName}.` : '';
  return `${xPart}, ${yPart}, ${zPart}.${companyRef}`;
}

function _buildImpactFirstSummary(currentTitle, years, metrics, topTools, roleName, companyName, jdThemes) {
  let leadImpact = '';
  if (metrics.revenue.length > 0) {
    leadImpact = `Generated ${metrics.revenue[0]} in measurable business impact`;
  } else if (metrics.percentages.length > 0) {
    leadImpact = `Delivered ${metrics.percentages[0]} improvements in key performance areas`;
  } else if (metrics.scale.length > 0) {
    leadImpact = `Scaled systems serving ${metrics.scale[0]}`;
  } else {
    leadImpact = `Consistently delivered high-impact results`;
  }

  const yearsRef = years > 0 ? ` across ${years}+ years` : '';
  const toolsRef = topTools ? ` Skilled in ${topTools}.` : '';
  const themeRef = jdThemes.actionPhrases.length > 0
    ? ` Proven ability to ${jdThemes.actionPhrases[0].toLowerCase()}.`
    : '';
  const companyRef = companyName ? ` Ready to drive results at ${companyName} as ${roleName}.` : '';

  return `${leadImpact}${yearsRef} as a ${currentTitle}.${toolsRef}${themeRef}${companyRef}`;
}

function _buildNarrativeSummary(currentTitle, years, career, metrics, topTools, roleName, companyName) {
  const startPhrase = years > 5
    ? `What began as a passion for ${currentTitle.toLowerCase().includes('engineer') ? 'building software' : 'driving results'} has evolved into ${years}+ years of progressive impact`
    : `Over ${years || 'several'} years, I have honed my craft as a ${currentTitle}`;

  const companyPhrase = career.companies.length > 1
    ? `, spanning roles at ${career.companies.slice(0, 3).join(', ')}`
    : career.companies.length === 1
      ? ` at ${career.companies[0]}`
      : '';

  const metricPhrase = metrics.revenue.length > 0
    ? `. Along the way, I've driven ${metrics.revenue[0]}+ in business outcomes`
    : metrics.percentages.length > 0
      ? `. Along the way, I've achieved ${metrics.percentages[0]} improvements`
      : '';

  const futurePhrase = companyName
    ? `. Now, I'm eager to bring this experience to ${companyName} as ${roleName}.`
    : `. Now, I'm ready for the next chapter.`;

  return `${startPhrase}${companyPhrase}${metricPhrase}${futurePhrase}`;
}

function _buildAchievementLedSummary(currentTitle, years, metrics, topTools, roleName, companyName, jdThemes) {
  const achievements = [];
  if (metrics.revenue.length > 0) achievements.push(`${metrics.revenue[0]}+ revenue impact`);
  if (metrics.percentages.length > 0) achievements.push(`${metrics.percentages[0]} efficiency gains`);
  if (metrics.teamSizes.length > 0) achievements.push(`teams of ${metrics.teamSizes[0]}+`);
  if (metrics.scale.length > 0) achievements.push(`${metrics.scale[0]}`);

  const headline = achievements.length > 0
    ? achievements.join(' | ')
    : 'Track record of measurable impact';

  const body = `${currentTitle} with ${years || 'several'}+ years of experience${topTools ? ` in ${topTools}` : ''}. ${jdThemes.actionPhrases.length > 0 ? `Demonstrated ability to ${jdThemes.actionPhrases[0].toLowerCase()}.` : 'Proven track record of delivering results.'} ${companyName ? `Seeking to bring data-driven impact to ${companyName}.` : ''}`;

  return `${headline}. ${body}`.trim();
}

function _buildConciseSummary(currentTitle, years, topTools, roleName, companyName, jdThemes) {
  const coreSkills = topTools || (jdThemes.softSkills.length > 0 ? jdThemes.softSkills.slice(0, 3).join(', ') : 'cross-functional leadership');
  const differentiator = jdThemes.actionPhrases.length > 0
    ? jdThemes.actionPhrases[0].toLowerCase()
    : 'delivering measurable outcomes';

  const companyRef = companyName ? ` at ${companyName}` : '';
  return `${currentTitle} with ${years || 'several'}+ years of expertise in ${coreSkills}, known for ${differentiator}. Seeking a ${roleName} role${companyRef}.`;
}

/**
 * Auto-rewrite a resume to mirror a job description.
 * Tries Gemini for a holistic rewrite; falls back to deterministic
 * keyword-injection and bullet rewriting.
 *
 * Port from JSX lines 346-471.
 *
 * @param {Object} data       - Full structured resume data.
 * @param {Object} jobContext  - { jdText, jdInfo }.
 * @returns {Promise<Object>} Tailored result (see module JSDoc for shape).
 */
export async function tailorResume(data, jobContext = {}, options = {}) {
  const jdText = jobContext.jdText || '';
  const jdInfo = jobContext.jdInfo || {};
  const { skipCache } = options;

  // Detect industries for pattern matching
  const detectedIndustries = detectIndustries
    ? detectIndustries(data.experiences || [])
    : [];
  const industryNames = detectedIndustries.map((i) => i.industry);

  // --- Gemini path ---
  if (hasApiKey() && jdText) {
    try {
      const geminiContext = { ...jdInfo, industries: industryNames };
      const geminiResult = await tailorResumeWithGemini(data, geminiContext, { skipCache });
      if (geminiResult) {
        // Augment with role/company info if Gemini didn't include them
        return {
          ...geminiResult,
          roleName: geminiResult.roleName || jdInfo.roleTitle || '',
          companyName: geminiResult.companyName || jdInfo.companyName || '',
        };
      }
    } catch (err) {
      console.warn('[ai-engine] Gemini tailorResume failed, using fallback:', err.message);
    }
  }

  // --- Deterministic fallback ---
  return _tailorResumeDeterministic(data, jdText, jdInfo);
}

/**
 * Deterministic resume tailoring (fallback).
 * @private
 */
function _tailorResumeDeterministic(data, jdText, jdInfo) {
  const jdThemes = extractJDThemes(jdText);
  const jdPhrases = extractJDPhrases(jdText);
  const metrics = mineMetrics(data);
  const career = extractCareerData(data);

  const roleName = jdInfo.roleTitle || career.titles[0] || '';
  const companyName = jdInfo.companyName || '';

  // Detect industries for pattern matching
  const detectedIndustries = detectIndustries
    ? detectIndustries(data.experiences || [])
    : [];
  const industryNames = detectedIndustries.map((i) => i.industry);

  // 1. Build tailored summary with JD phrases embedded
  const summaryParts = [];
  if (career.yearsOfExperience > 0) {
    summaryParts.push(`${career.yearsOfExperience}+ years of experience`);
  }
  if (career.titles[0]) {
    summaryParts.push(`as a ${career.titles[0]}`);
  }
  if (jdThemes.tools.length > 0) {
    summaryParts.push(`specializing in ${jdThemes.tools.slice(0, 4).join(', ')}`);
  }
  if (metrics.revenue.length > 0) {
    summaryParts.push(`with ${metrics.revenue[0]}+ in proven business impact`);
  } else if (metrics.percentages.length > 0) {
    summaryParts.push(`with ${metrics.percentages[0]} demonstrated improvements`);
  }
  if (jdThemes.actionPhrases.length > 0) {
    summaryParts.push(`and a proven ability to ${jdThemes.actionPhrases[0].toLowerCase()}`);
  }
  if (companyName) {
    summaryParts.push(`ready to contribute to ${companyName}'s mission`);
  }

  const tailoredSummary = summaryParts.length > 0
    ? `Results-oriented professional with ${summaryParts.join(', ')}.`
    : data.summary || '';

  // 2. Rewrite each bullet
  let changeCount = 0;
  const experiences = [];

  for (let expIdx = 0; expIdx < (data.experiences || []).length; expIdx++) {
    const exp = data.experiences[expIdx];
    const bullets = exp.bullets || [];
    const rewrittenBullets = [];

    for (let bIdx = 0; bIdx < bullets.length; bIdx++) {
      const original = bullets[bIdx];
      if (!original || !original.trim()) {
        rewrittenBullets.push({ original, rewritten: original, changed: false });
        continue;
      }

      let rewritten = original.trim();
      let changed = false;

      // a. Find matching JD phrase
      const bulletLower = rewritten.toLowerCase();
      const matchingPhrase = jdPhrases.find((phrase) => {
        const words = phrase.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        return words.some((w) => bulletLower.includes(w));
      });

      // b. Find missing JD skills relevant to this bullet
      const missingSkills = jdThemes.tools.filter(
        (tool) => !bulletLower.includes(tool.toLowerCase()),
      );

      // c. Check for stretch / pivot opportunities
      const pivotOpp = findPivot ? findPivot(original, data.skills || [], data.experiences || []) : null;

      // d. Apply rewrite strategy
      // Add action verb if missing
      if (!startsWithActionVerb(rewritten)) {
        const verb = pickByHash(ACTION_VERBS, `tailor-${rewritten}-${expIdx}-${bIdx}`);
        if (verb) {
          rewritten = `${verb} ${rewritten.charAt(0).toLowerCase()}${rewritten.slice(1)}`;
          changed = true;
        }
      }

      // Inject JD phrase if available and not already present
      if (matchingPhrase && !bulletLower.includes(matchingPhrase.toLowerCase())) {
        rewritten = rewritten.replace(/\.\s*$/, '') + `, aligning with ${matchingPhrase.toLowerCase()}.`;
        changed = true;
      }

      // Inject a missing skill keyword if relevant
      if (missingSkills.length > 0) {
        const skill = pickByHash(missingSkills, `skill-${original}-${bIdx}`);
        if (skill && !rewritten.toLowerCase().includes(skill.toLowerCase())) {
          rewritten = rewritten.replace(/\.\s*$/, '') + ` using ${skill}.`;
          changed = true;
        }
      }

      // Add pivot context if detected
      if (pivotOpp && pivotOpp.suggestion) {
        rewritten = rewritten.replace(/\.\s*$/, '') + ` (${pivotOpp.suggestion}).`;
        changed = true;
      }

      // Add metric if missing
      if (!containsNumber(rewritten)) {
        const metric = inferMetric(rewritten, `tailor-metric-${original}`);
        if (metric) {
          rewritten = rewritten.replace(/\.\s*$/, '') + metric + '.';
          changed = true;
        }
      }

      // Try pattern-based rewrite using WINNING_BULLETS if a strong match exists
      if (industryNames.length > 0) {
        const matchedPatterns = findMatchingPatterns(original, industryNames, 1);
        if (matchedPatterns.length > 0 && matchedPatterns[0].score > 0.2) {
          const bulletMetrics = extractBulletMetrics(original);
          const hasMetrics = bulletMetrics.revenue.length > 0
            || bulletMetrics.percentages.length > 0
            || bulletMetrics.teamSizes.length > 0
            || bulletMetrics.counts.length > 0
            || bulletMetrics.rawNumbers.length > 0;

          if (hasMetrics) {
            const filled = tryFillPattern(matchedPatterns[0].pattern, bulletMetrics);
            if (filled) {
              rewritten = filled;
              changed = true;
            }
          }
        }
      }

      // Ensure period
      if (!/[.!]$/.test(rewritten.trim())) {
        rewritten = rewritten.trim() + '.';
      }

      if (changed) changeCount++;
      rewrittenBullets.push({ original, rewritten, changed });
    }

    experiences.push({
      expIdx,
      title: exp.title || '',
      company: exp.company || '',
      bullets: rewrittenBullets,
    });
  }

  // 3. Add missing JD skills to skills list
  const userSkillsLower = (data.skills || []).map((s) => s.toLowerCase());
  const skillsAdded = [];
  const allSkills = [...(data.skills || [])];

  const jdSkillCandidates = [...jdThemes.tools, ...(jdInfo.skills || [])];
  for (const skill of jdSkillCandidates) {
    const lower = skill.toLowerCase();
    if (!userSkillsLower.includes(lower) && !skillsAdded.map((s) => s.toLowerCase()).includes(lower)) {
      skillsAdded.push(skill);
      allSkills.push(skill);
    }
  }

  // Count summary change
  if (tailoredSummary !== (data.summary || '')) changeCount++;

  return {
    summary: tailoredSummary,
    experiences,
    skills: allSkills,
    skillsAdded,
    changeCount,
    roleName,
    companyName,
  };
}

/**
 * Generate winning bullet patterns and stand-out suggestions.
 * Tries Gemini for personalised recommendations; falls back to deterministic
 * pattern matching against WINNING_BULLETS categories.
 *
 * Port from JSX lines 477-612.
 *
 * @param {Object} data       - Full structured resume data.
 * @param {Object} jobContext  - { jdText, jdInfo }.
 * @returns {Promise<Object>} Stand-out suggestions (see module JSDoc for shape).
 */
export async function generateStandOutSuggestions(data, jobContext = {}, options = {}) {
  const jdText = jobContext.jdText || '';
  const jdInfo = jobContext.jdInfo || {};
  const { skipCache } = options;

  // --- Gemini path ---
  if (hasApiKey() && jdText) {
    try {
      const geminiResult = await generateStandOutWithGemini(data, jdInfo, { skipCache });
      if (geminiResult) {
        // Gemini returns free text; wrap it into the expected structure
        // We still run deterministic to get the structured data and merge
        const deterministicResult = _generateStandOutDeterministic(data, jdText, jdInfo);
        return {
          ...deterministicResult,
          geminiInsights: geminiResult,
        };
      }
    } catch (err) {
      console.warn('[ai-engine] Gemini generateStandOut failed:', err.message);
    }
  }

  // --- Deterministic fallback ---
  return _generateStandOutDeterministic(data, jdText, jdInfo);
}

/**
 * Deterministic stand-out suggestion generator (fallback).
 * @private
 */
function _generateStandOutDeterministic(data, jdText, jdInfo) {
  const jdThemes = extractJDThemes(jdText);
  const metrics = mineMetrics(data);
  const career = extractCareerData(data);
  const industries = detectIndustries ? detectIndustries(allBulletText(data)) : [];

  const roleName = jdInfo.roleTitle || career.titles[0] || '';

  // 1. Score which WINNING_BULLETS categories apply
  //    Each category in WINNING_BULLETS has a name and keyword associations.
  const categoryKeywordMaps = {
    'Revenue & Growth': ['revenue', 'sales', 'growth', 'pipeline', 'conversion', 'roi', 'profit', 'deals', 'quota', 'arpu'],
    'Cost Reduction': ['cost', 'savings', 'budget', 'efficiency', 'reduce', 'optimize', 'cut', 'consolidate', 'eliminate'],
    'Scale & Performance': ['scale', 'performance', 'latency', 'uptime', 'throughput', 'availability', 'sla', 'capacity', 'load'],
    'Team & Leadership': ['team', 'led', 'managed', 'hired', 'mentored', 'coached', 'cross-functional', 'org', 'reports'],
    'Product & Innovation': ['product', 'launch', 'feature', 'users', 'adoption', 'release', 'roadmap', 'mvp', 'a/b test'],
    'Process & Operations': ['process', 'automation', 'workflow', 'streamline', 'cicd', 'devops', 'sop', 'compliance', 'audit'],
    'Customer Success': ['customer', 'nps', 'satisfaction', 'retention', 'churn', 'support', 'onboarding', 'csat'],
    'Data & Analytics': ['data', 'analytics', 'dashboard', 'reporting', 'insight', 'ml', 'model', 'prediction', 'bi'],
  };

  const resumeTextLower = `${data.summary || ''} ${allBulletText(data)}`.toLowerCase();
  const jdLower = jdText.toLowerCase();

  const categoryScores = [];

  for (const [category, keywords] of Object.entries(categoryKeywordMaps)) {
    let score = 0;

    // Score based on resume text (user's experience)
    for (const kw of keywords) {
      if (resumeTextLower.includes(kw)) score += 2;
    }

    // Score based on JD text (employer's needs)
    for (const kw of keywords) {
      if (jdLower.includes(kw)) score += 3;
    }

    // Score based on detected industries
    if (industries.length > 0) {
      for (const ind of industries) {
        const indLower = ind.toLowerCase();
        if (keywords.some((kw) => indLower.includes(kw))) score += 1;
      }
    }

    if (score > 0) {
      categoryScores.push({ category, score });
    }
  }

  // Sort and pick top 3
  categoryScores.sort((a, b) => b.score - a.score);
  const topCategories = categoryScores.slice(0, 3).map((c) => c.category);

  // 2. Cross-reference experiences against winning patterns
  const experienceSuggestions = [];
  let totalPatterns = 0;

  for (let expIdx = 0; expIdx < (data.experiences || []).length; expIdx++) {
    const exp = data.experiences[expIdx];
    if (!exp.title && !exp.company) continue;

    const bullets = exp.bullets || [];
    const expTextLower = bullets.join(' ').toLowerCase();

    const winningPatterns = [];

    for (const category of topCategories) {
      // Get patterns from WINNING_BULLETS for this category
      const patterns = (WINNING_BULLETS && WINNING_BULLETS[category]) || [];

      for (const pattern of patterns) {
        // Check if this pattern is relevant to the experience
        const patternWords = (typeof pattern === 'string' ? pattern : pattern.template || '')
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);

        const isRelevant = patternWords.some((w) => expTextLower.includes(w)) ||
                           patternWords.some((w) => jdLower.includes(w));

        if (!isRelevant && patternWords.length > 0) continue;

        const templateStr = typeof pattern === 'string' ? pattern : pattern.template || pattern;

        // Fill placeholders with real metrics
        let filled = String(templateStr);
        let hasPlaceholders = false;

        // Replace common placeholders
        if (filled.includes('[X%]') || filled.includes('[percentage]')) {
          if (metrics.percentages.length > 0) {
            const pct = pickByHash(metrics.percentages, `pct-${category}-${expIdx}`);
            filled = filled.replace(/\[X%\]|\[percentage\]/g, pct);
          } else {
            hasPlaceholders = true;
          }
        }

        if (filled.includes('[revenue]') || filled.includes('[$X]')) {
          if (metrics.revenue.length > 0) {
            const rev = pickByHash(metrics.revenue, `rev-${category}-${expIdx}`);
            filled = filled.replace(/\[revenue\]|\[\$X\]/g, rev);
          } else {
            hasPlaceholders = true;
          }
        }

        if (filled.includes('[team size]') || filled.includes('[N]')) {
          if (metrics.teamSizes.length > 0) {
            const size = pickByHash(metrics.teamSizes, `team-${category}-${expIdx}`);
            filled = filled.replace(/\[team size\]|\[N\]/g, size);
          } else {
            hasPlaceholders = true;
          }
        }

        if (filled.includes('[scale]') || filled.includes('[users]')) {
          if (metrics.scale.length > 0) {
            const scaleVal = pickByHash(metrics.scale, `scale-${category}-${expIdx}`);
            filled = filled.replace(/\[scale\]|\[users\]/g, scaleVal);
          } else {
            hasPlaceholders = true;
          }
        }

        winningPatterns.push({
          pattern: String(templateStr),
          filled,
          context: `Recommended for ${category.toLowerCase()} achievements`,
          category,
          hasPlaceholders,
        });

        totalPatterns++;

        // Limit patterns per experience
        if (winningPatterns.length >= 6) break;
      }

      if (winningPatterns.length >= 6) break;
    }

    // 3. Find weak bullets (no numbers, no action verb)
    const weakBullets = [];
    for (let bIdx = 0; bIdx < bullets.length; bIdx++) {
      const b = bullets[bIdx];
      if (!b || !b.trim()) continue;
      if (!startsWithActionVerb(b) || !containsNumber(b)) {
        weakBullets.push({
          bulletIdx: bIdx,
          text: b,
          issues: [
            ...(!startsWithActionVerb(b) ? ['Missing action verb'] : []),
            ...(!containsNumber(b) ? ['No quantifiable metric'] : []),
          ],
        });
      }
    }

    if (winningPatterns.length > 0 || weakBullets.length > 0) {
      experienceSuggestions.push({
        expIdx,
        title: exp.title || '',
        company: exp.company || '',
        winningPatterns,
        weakBullets,
      });
    }
  }

  // 4. Generate differentiator tips based on JD themes
  const differentiators = [];

  if (jdThemes.softSkills.length > 0) {
    differentiators.push({
      tip: `Highlight your ${jdThemes.softSkills.slice(0, 2).join(' and ')} skills with specific examples — these are explicitly valued in the JD.`,
      category: 'Soft Skills',
    });
  }

  if (jdThemes.tools.length > 3) {
    const userTools = (data.skills || []).map((s) => s.toLowerCase());
    const uniqueJDTools = jdThemes.tools.filter((t) => !userTools.includes(t.toLowerCase()));
    if (uniqueJDTools.length > 0) {
      differentiators.push({
        tip: `Consider showcasing experience with ${uniqueJDTools.slice(0, 3).join(', ')} — these technologies are mentioned in the JD but not in your resume.`,
        category: 'Technical Alignment',
      });
    }
  }

  if (jdThemes.actionPhrases.length > 0) {
    differentiators.push({
      tip: `Mirror the JD's language by demonstrating your ability to "${jdThemes.actionPhrases[0]}" — use this exact framing in a bullet point.`,
      category: 'Language Mirroring',
    });
  }

  if (metrics.revenue.length === 0 && metrics.percentages.length === 0) {
    differentiators.push({
      tip: 'Add quantifiable metrics to your bullets. Even rough estimates (e.g., "reduced by ~20%") dramatically increase impact.',
      category: 'Quantification',
    });
  }

  if (industries.length > 0) {
    differentiators.push({
      tip: `Your ${industries[0]} industry experience is a differentiator — make sure domain expertise is visible in your summary and bullets.`,
      category: 'Industry Expertise',
    });
  }

  return {
    suggestions: experienceSuggestions,
    topCategories,
    differentiators,
    totalPatterns,
    roleName,
  };
}
