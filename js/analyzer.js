/**
 * analyzer.js — ES module for resume analysis, job fit scoring, and career
 * trajectory detection in Resume Forge.
 *
 * Handles:
 *  - Industry detection from experience entries
 *  - Company culture profiling from job descriptions
 *  - Impact scoring of resume bullets
 *  - Metric extraction from text
 *  - Semantic pivot finding (stretch skill matching)
 *  - Role velocity / career trajectory calculation
 *  - Full job-fit analysis (Gemini + deterministic fallback)
 *  - JD metadata extraction (company name, role title, etc.)
 *  - Job URL fetching via CORS proxies
 */

import {
  INDUSTRY_KEYWORDS,
  ROLE_MAP,
  ACTION_VERBS,
  COMPANY_CULTURE_PROFILES,
  SEMANTIC_PIVOTS,
  LEARNING_PATHS,
} from './constants.js';

import {
  analyzeJDWithGemini,
  analyzeJobFitWithGemini,
} from './gemini.js';

// ---------------------------------------------------------------------------
// Vibe definitions for company cultures
// ---------------------------------------------------------------------------

const VIBE_MAP = {
  'chaotic-startup': {
    label: 'Chaotic Startup',
    emoji: '🚀',
    desc: 'They want builders who thrive in ambiguity and can wear many hats.',
    color: '#c97b7b',
  },
  'scale-up': {
    label: 'Growth-Stage Scale-Up',
    emoji: '📈',
    desc: 'They\'re scaling fast and need people who can build process while shipping.',
    color: '#c4a265',
  },
  'big-tech': {
    label: 'Big Tech / FAANG',
    emoji: '🏢',
    desc: 'They want system thinkers who can operate at massive scale with rigorous standards.',
    color: '#7ba5a5',
  },
  'enterprise': {
    label: 'Enterprise / Corporate',
    emoji: '🏛️',
    desc: 'They value rigor, compliance, and methodical execution in established systems.',
    color: '#8fb8c9',
  },
  'consulting': {
    label: 'Consulting / Advisory',
    emoji: '🎯',
    desc: 'They want structured thinkers who can drive client outcomes and communicate clearly.',
    color: '#9b8ec4',
  },
  'mission-driven': {
    label: 'Mission-Driven / Impact',
    emoji: '🌍',
    desc: 'They want people who care deeply about the mission and can balance purpose with execution.',
    color: '#7bab8e',
  },
};

// ---------------------------------------------------------------------------
// Seniority map for role velocity
// ---------------------------------------------------------------------------

const SENIORITY_MAP = {
  intern: 1,
  junior: 2,
  associate: 3,
  analyst: 3,
  coordinator: 3,
  specialist: 4,
  engineer: 4,
  consultant: 4,
  senior: 5,
  lead: 6,
  manager: 6,
  principal: 7,
  director: 8,
  head: 8,
  vp: 9,
  'c-suite': 10,
  founder: 10,
};

// ---------------------------------------------------------------------------
// Skill keywords for JD matching
// ---------------------------------------------------------------------------

const SKILL_KEYWORDS = [
  'python', 'javascript', 'typescript', 'java', 'c\\+\\+', 'c#', 'go',
  'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'r\\b', 'matlab',
  'react', 'angular', 'vue', 'svelte', 'next\\.?js', 'node\\.?js',
  'express', 'django', 'flask', 'spring', 'rails', 'laravel',
  'sql', 'nosql', 'mongodb', 'postgres', 'mysql', 'redis', 'elasticsearch',
  'aws', 'azure', 'gcp', 'google cloud', 'docker', 'kubernetes', 'terraform',
  'ci/cd', 'jenkins', 'github actions', 'gitlab',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'ai',
  'data science', 'data engineering', 'etl', 'data pipeline',
  'agile', 'scrum', 'kanban', 'jira', 'confluence',
  'figma', 'sketch', 'adobe', 'photoshop',
  'product management', 'project management', 'stakeholder',
  'rest', 'graphql', 'grpc', 'microservices', 'api',
  'html', 'css', 'sass', 'tailwind',
  'git', 'linux', 'bash',
  'tableau', 'power bi', 'looker',
  'salesforce', 'hubspot',
  'blockchain', 'web3', 'solidity',
];

// ---------------------------------------------------------------------------
// detectIndustries
// ---------------------------------------------------------------------------

/**
 * Scan experience entries against INDUSTRY_KEYWORDS and ROLE_MAP to identify
 * the candidate's likely industries.
 *
 * @param {Array<Object>} experiences - Array of experience objects with
 *   `title`, `company`, and `bullets` fields.
 * @returns {Array<{industry: string, confidence: number}>} Ranked list of
 *   industries with confidence scores (0-100).
 */
export function detectIndustries(experiences) {
  if (!experiences || experiences.length === 0) return [];

  const scores = {};

  for (const exp of experiences) {
    const title = (exp.title || '').toLowerCase();
    const company = (exp.company || '').toLowerCase();
    const bullets = (exp.bullets || []).map((b) => b.toLowerCase()).join(' ');
    const combined = `${title} ${company} ${bullets}`;

    // Check ROLE_MAP keywords — title matches get 3x weight
    // ROLE_MAP format: { "keyword": ["Industry1", "Industry2", ...] }
    for (const [roleKeyword, industries] of Object.entries(ROLE_MAP)) {
      const kwLower = roleKeyword.toLowerCase();

      if (combined.includes(kwLower)) {
        const weight = title.includes(kwLower) ? 3 : 1;
        for (const ind of industries) {
          scores[ind] = (scores[ind] || 0) + weight;
        }
      }
    }

    // Check INDUSTRY_KEYWORDS
    for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
      const kws = Array.isArray(keywords) ? keywords : [keywords];

      for (const kw of kws) {
        const kwLower = kw.toLowerCase();

        if (title.includes(kwLower)) {
          scores[industry] = (scores[industry] || 0) + 3;
        } else if (combined.includes(kwLower)) {
          scores[industry] = (scores[industry] || 0) + 1;
        }
      }
    }
  }

  // Normalize: find the maximum score and scale to 0-100
  const maxScore = Math.max(...Object.values(scores), 1);

  return Object.entries(scores)
    .map(([industry, raw]) => ({
      industry,
      confidence: Math.min(Math.round((raw / maxScore) * 100), 100),
    }))
    .sort((a, b) => b.confidence - a.confidence);
}

// ---------------------------------------------------------------------------
// analyzeCompanyCulture
// ---------------------------------------------------------------------------

/**
 * Match JD text against COMPANY_CULTURE_PROFILES signals to identify the
 * company's culture type and "vibe".
 *
 * @param {string} jdText - Raw job description text.
 * @returns {Object} Culture analysis result with primary/secondary culture,
 *   vibe details, prioritized signals, scores, and confidence level.
 */
export function analyzeCompanyCulture(jdText) {
  if (!jdText) {
    return {
      primaryCulture: null,
      secondaryCulture: null,
      vibe: null,
      prioritizedSignals: [],
      scores: [],
      confidence: 'low',
    };
  }

  const textLower = jdText.toLowerCase();
  const cultureScores = {};

  // Score each culture profile by counting signal matches
  for (const [cultureKey, profile] of Object.entries(COMPANY_CULTURE_PROFILES)) {
    const signals = profile.signals || profile.keywords || [];
    let score = 0;
    const matchedSignals = [];

    for (const signal of signals) {
      const signalLower = signal.toLowerCase();
      if (textLower.includes(signalLower)) {
        score += 1;
        matchedSignals.push(signal);
      }
    }

    cultureScores[cultureKey] = {
      score,
      matchedSignals,
      total: signals.length,
    };
  }

  // Sort cultures by score
  const ranked = Object.entries(cultureScores)
    .map(([key, data]) => ({ culture: key, ...data }))
    .sort((a, b) => b.score - a.score);

  const primary = ranked[0] || null;
  const secondary = ranked[1] || null;

  const primaryKey = primary?.culture || null;
  const secondaryKey = secondary?.culture || null;

  // Collect all matched signals, prioritized by culture rank
  const prioritizedSignals = [];
  for (const entry of ranked) {
    for (const sig of entry.matchedSignals) {
      prioritizedSignals.push(sig);
    }
  }

  // Determine confidence based on the primary score
  let confidence = 'low';
  if (primary && primary.score >= 5) {
    confidence = 'high';
  } else if (primary && primary.score >= 3) {
    confidence = 'medium';
  }

  // Build the scores array for transparency
  const scores = ranked.map((entry) => ({
    culture: entry.culture,
    score: entry.score,
    matchedSignals: entry.matchedSignals,
  }));

  return {
    primaryCulture: primaryKey,
    secondaryCulture: secondaryKey,
    vibe: primaryKey ? VIBE_MAP[primaryKey] || null : null,
    prioritizedSignals,
    scores,
    confidence,
  };
}

// ---------------------------------------------------------------------------
// calculateImpactScore
// ---------------------------------------------------------------------------

/**
 * Score a set of resume bullet points for impact quality (0-100).
 *
 * Scoring breakdown:
 *  - Metrics presence: up to 45 pts (15 per metric, max 3 counted)
 *  - Action verb start: 15 pts
 *  - Average bullet length > 60 chars: 10 pts; > 100 chars: another 10 pts
 *  - 3+ bullets: 10 pts
 *  - Any number in text: 10 pts
 *
 * @param {string[]} bullets - Array of bullet-point strings.
 * @returns {number} Impact score between 0 and 100.
 */
export function calculateImpactScore(bullets) {
  if (!bullets || bullets.length === 0) return 0;

  let score = 0;

  // --- Metrics presence (up to 45 pts) ---
  const allText = bullets.join(' ');
  const metrics = extractMetrics(allText);
  const metricCount = Math.min(metrics.length, 3);
  score += metricCount * 15;

  // --- Action verb start (15 pts) ---
  const actionVerbSet = new Set(
    (ACTION_VERBS || []).map((v) => v.toLowerCase())
  );
  const hasActionStart = bullets.some((b) => {
    const firstWord = b.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
    return actionVerbSet.has(firstWord);
  });
  if (hasActionStart) score += 15;

  // --- Average bullet length (up to 20 pts) ---
  const avgLen =
    bullets.reduce((sum, b) => sum + b.trim().length, 0) / bullets.length;
  if (avgLen > 100) {
    score += 20;
  } else if (avgLen > 60) {
    score += 10;
  }

  // --- 3+ bullets (10 pts) ---
  if (bullets.length >= 3) score += 10;

  // --- Any number in text (10 pts) ---
  if (/\d/.test(allText)) score += 10;

  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// extractMetrics
// ---------------------------------------------------------------------------

/**
 * Extract quantitative metrics from text.
 *
 * @param {string} text - Input text to scan.
 * @returns {Array<{type: string, value: string}>} Array of extracted metrics
 *   with type (revenue, percentage, team, scale, count, number) and value.
 */
export function extractMetrics(text) {
  if (!text || typeof text !== 'string') return [];

  const metrics = [];

  // Revenue: $X, $Xk, $XM, $XB, etc.
  const revenueRe = /\$[\d,]+(?:\.\d+)?(?:\s*(?:k|m|mm|b|bn|million|billion|thousand))?/gi;
  for (const match of text.matchAll(revenueRe)) {
    metrics.push({ type: 'revenue', value: match[0].trim() });
  }

  // Percentage: X%
  const pctRe = /\d+(?:\.\d+)?%/g;
  for (const match of text.matchAll(pctRe)) {
    metrics.push({ type: 'percentage', value: match[0] });
  }

  // Team: X people / engineers / developers / team members / direct reports
  const teamRe = /(\d+)\s*(?:\+\s*)?(?:people|engineers|developers|team\s*members|direct\s*reports|employees|staff|reports)/gi;
  for (const match of text.matchAll(teamRe)) {
    metrics.push({ type: 'team', value: match[0].trim() });
  }

  // Scale: X users / clients / customers / accounts / subscribers
  const scaleRe = /(\d[\d,]*)\s*(?:\+\s*)?(?:users|clients|customers|accounts|subscribers|visitors|downloads|installs)/gi;
  for (const match of text.matchAll(scaleRe)) {
    metrics.push({ type: 'scale', value: match[0].trim() });
  }

  // Count: X projects / initiatives / features / products / applications
  const countRe = /(\d+)\s*(?:\+\s*)?(?:projects|initiatives|features|products|applications|services|systems|platforms|integrations|campaigns)/gi;
  for (const match of text.matchAll(countRe)) {
    metrics.push({ type: 'count', value: match[0].trim() });
  }

  // Plain large numbers (1,000+) not already captured
  const numberRe = /\b\d{1,3}(?:,\d{3})+\b/g;
  for (const match of text.matchAll(numberRe)) {
    const alreadyCaptured = metrics.some((m) => m.value.includes(match[0]));
    if (!alreadyCaptured) {
      metrics.push({ type: 'number', value: match[0] });
    }
  }

  return metrics;
}

// ---------------------------------------------------------------------------
// findPivot
// ---------------------------------------------------------------------------

/**
 * Search SEMANTIC_PIVOTS for a "stretch" connection between the user's
 * existing skills and a target skill from a job description.
 *
 * If the user has skill A and the JD wants skill B, and both belong to
 * the same semantic family, return a pivot object the user can leverage.
 *
 * @param {string} targetSkill  - The skill the JD requires.
 * @param {string[]} userSkills - The candidate's listed skills.
 * @param {Array<Object>} userExperiences - The candidate's experience entries.
 * @returns {Object|null} Pivot object or null if no stretch found.
 */
export function findPivot(targetSkill, userSkills, userExperiences) {
  if (!targetSkill || typeof targetSkill !== 'string' || !SEMANTIC_PIVOTS) return null;

  const targetLower = targetSkill.toLowerCase().trim();
  const userSkillsLower = (userSkills || []).filter(s => typeof s === 'string').map((s) => s.toLowerCase().trim());

  // Also check experience text for implicit skills
  const expText = (userExperiences || [])
    .map((e) => {
      const parts = [e.title || '', e.company || '', ...(e.bullets || [])];
      return parts.join(' ').toLowerCase();
    })
    .join(' ');

  // SEMANTIC_PIVOTS is { "family-name": ["skill1", "skill2", ...], ... }
  for (const [family, members] of Object.entries(SEMANTIC_PIVOTS)) {
    const membersLower = members.map((s) => s.toLowerCase().trim());

    // Check if the target skill belongs to this family
    const targetInFamily = membersLower.some(
      (m) => m === targetLower || targetLower.includes(m) || m.includes(targetLower)
    );
    if (!targetInFamily) continue;

    // Check if the user has any other skill in the same family
    for (const member of membersLower) {
      if (member === targetLower) continue;

      const userHasSkill =
        userSkillsLower.some(
          (us) => us === member || us.includes(member) || member.includes(us)
        ) || expText.includes(member);

      if (userHasSkill) {
        return {
          userHas: member,
          jdWants: targetSkill,
          family,
          rewriteHint: `Leveraged ${member.charAt(0).toUpperCase() + member.slice(1)} expertise, directly transferable to ${targetSkill}-based environments`,
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// calculateRoleVelocity
// ---------------------------------------------------------------------------

/**
 * Measure career trajectory speed based on seniority progression over time.
 *
 * @param {Array<Object>} experiences - Experience entries with `title`,
 *   `startDate`, and `endDate` fields.
 * @returns {{score: number, label: string, trend: string}} Velocity result.
 */
export function calculateRoleVelocity(experiences) {
  if (!experiences || !Array.isArray(experiences) || experiences.length < 2) {
    return { score: 50, label: 'Steady Climber', trend: '↗' };
  }

  // Map each experience to a seniority level
  const entries = experiences
    .map((exp) => {
      const title = (exp.title || '').toLowerCase();
      let level = 4; // default to mid-level

      for (const [keyword, seniority] of Object.entries(SENIORITY_MAP)) {
        if (title.includes(keyword)) {
          level = Math.max(level, seniority);
        }
      }

      // Parse start date for ordering
      const startDate = parseDate(exp.startDate);
      return { title: exp.title, level, startDate };
    })
    .filter((e) => e.startDate)
    .sort((a, b) => a.startDate - b.startDate);

  if (entries.length < 2) {
    return { score: 50, label: 'Steady Climber', trend: '↗' };
  }

  // Calculate velocity based on level progression over time
  const first = entries[0];
  const last = entries[entries.length - 1];
  const levelDiff = last.level - first.level;
  const yearSpan = Math.max(
    (last.startDate - first.startDate) / (1000 * 60 * 60 * 24 * 365),
    0.5
  );

  // Base velocity: levels gained per year, scaled
  const levelsPerYear = levelDiff / yearSpan;

  // Score calculation: scale levelsPerYear to 0-100
  // 0 levels/yr = ~50, 0.5/yr = ~70, 1/yr = ~85, 1.5+/yr = ~95
  let score = 50 + levelsPerYear * 30;

  // Bonus for total seniority reached
  if (last.level >= 8) score += 10;
  else if (last.level >= 6) score += 5;

  // Bonus for number of distinct level changes
  let levelChanges = 0;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].level > entries[i - 1].level) levelChanges++;
  }
  score += levelChanges * 3;

  // Clamp
  score = Math.max(0, Math.min(100, Math.round(score)));

  // Determine label and trend
  let label, trend;
  if (score >= 90) {
    label = 'Rocket';
    trend = '🚀';
  } else if (score >= 75) {
    label = 'Fast Tracker';
    trend = '📈';
  } else if (score >= 55) {
    label = 'Steady Climber';
    trend = '↗';
  } else {
    label = 'Lateral Mover';
    trend = '→';
  }

  return { score, label, trend };
}

// ---------------------------------------------------------------------------
// analyzeJobFit (async — Gemini + deterministic fallback)
// ---------------------------------------------------------------------------

/**
 * Full job-fit analysis. Attempts Gemini-powered analysis first and falls back
 * to a deterministic scoring algorithm.
 *
 * @param {Object}  data       - Structured resume data.
 * @param {string}  jdText     - Raw job description text.
 * @param {boolean} [useGemini=true] - Whether to try Gemini first.
 * @returns {Promise<Object>} Comprehensive fit analysis result.
 */
export async function analyzeJobFit(data, jdText, useGemini = true, { skipCache } = {}) {
  const experiences = data.experiences || [];
  const skills = data.skills || [];

  // Always compute deterministic components
  const roleVelocity = calculateRoleVelocity(experiences);
  const jdInfo = extractJDInfo(jdText);

  // ----- Gemini path -----
  if (useGemini) {
    try {
      const geminiResult = await analyzeJobFitWithGemini(data, jdText, { skipCache });

      if (geminiResult) {
        // Compute deterministic score to blend with Gemini analysis
        const deterministicResult = _deterministicJobFit(data, jdText, jdInfo);

        return {
          overall: deterministicResult.overall,
          met: geminiResult.requirements?.met || deterministicResult.met,
          missing: geminiResult.requirements?.missing || deterministicResult.missing,
          jdInfo,
          matchedSkills: geminiResult.matchedSkills || deterministicResult.matchedSkills,
          stretchSkills: geminiResult.stretchSkills || deterministicResult.stretchSkills,
          missingSkills: geminiResult.missingSkills || deterministicResult.missingSkills,
          roleVelocity,
          addToExperience: deterministicResult.addToExperience,
          addToSkills: deterministicResult.addToSkills,
          userProfile: deterministicResult.userProfile,
          expEntries: experiences,
        };
      }
    } catch (err) {
      console.warn('[analyzer] Gemini job-fit failed, using deterministic fallback:', err.message);
    }
  }

  // ----- Deterministic fallback -----
  const result = _deterministicJobFit(data, jdText, jdInfo);

  return {
    ...result,
    jdInfo,
    roleVelocity,
    expEntries: experiences,
  };
}

// ---------------------------------------------------------------------------
// Deterministic job-fit scoring (private)
// ---------------------------------------------------------------------------

/**
 * Deterministic job-fit analysis — ported from JSX lines 2294-2441.
 *
 * @param {Object} data   - Structured resume data.
 * @param {string} jdText - Raw JD text.
 * @param {Object} jdInfo - Extracted JD info (company, role).
 * @returns {Object} Fit analysis result.
 * @private
 */
function _deterministicJobFit(data, jdText, jdInfo) {
  const experiences = data.experiences || [];
  const skills = data.skills || [];
  const textLower = jdText.toLowerCase();

  // Build user's full text for matching
  const userFullText = _buildUserFullText(data);

  // --- Extract structured requirements from JD ---
  const requirements = _extractRequirements(jdText);

  // --- Extract skill keywords from JD ---
  const jdSkills = _extractSkillKeywords(textLower);

  // --- Match requirements against user text ---
  const met = [];
  const missing = [];

  for (const req of requirements) {
    const reqWords = req.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    if (reqWords.length === 0) {
      met.push(req);
      continue;
    }

    const matchCount = reqWords.filter((w) => userFullText.includes(w)).length;
    const matchRatio = matchCount / reqWords.length;

    if (matchRatio >= 0.4) {
      met.push(req);
    } else {
      missing.push(req);
    }
  }

  // --- 3-tier skill matching ---
  const userSkillsLower = skills.map((s) => s.toLowerCase().trim());
  const matchedSkills = [];
  const stretchSkills = [];
  const missingSkills = [];

  for (const jdSkill of jdSkills) {
    // Direct match
    const directMatch = userSkillsLower.some(
      (us) => us === jdSkill || us.includes(jdSkill) || jdSkill.includes(us)
    ) || userFullText.includes(jdSkill);

    if (directMatch) {
      matchedSkills.push(jdSkill);
      continue;
    }

    // Stretch match via semantic pivot
    const pivot = findPivot(jdSkill, skills, experiences);
    if (pivot) {
      stretchSkills.push({
        skill: jdSkill,
        pivot,
      });
      continue;
    }

    // Absolute gap
    missingSkills.push(jdSkill);
  }

  // --- Blended fit score ---
  const reqScore =
    requirements.length > 0
      ? (met.length / requirements.length) * 100
      : 50;

  const totalSkills = jdSkills.length || 1;
  const skillScore =
    ((matchedSkills.length + stretchSkills.length * 0.5) / totalSkills) * 100;

  let overall = Math.round(reqScore * 0.6 + skillScore * 0.4);
  overall = Math.max(15, Math.min(95, overall));

  // --- Suggestions for improvement ---
  const addToExperience = missing.map((req) => ({
    suggestion: req,
    reason: 'Missing from your experience — consider adding relevant accomplishments.',
  }));

  const addToSkills = missingSkills.map((skill) => ({
    skill,
    reason: 'Listed in the JD but not found in your resume.',
  }));

  // --- User profile summary ---
  const userProfile = _buildUserProfile(data);

  return {
    overall,
    met,
    missing,
    matchedSkills,
    stretchSkills: stretchSkills.map((s) => s.skill),
    missingSkills,
    addToExperience,
    addToSkills,
    userProfile,
  };
}

// ---------------------------------------------------------------------------
// extractJDInfo
// ---------------------------------------------------------------------------

/**
 * Extract company name, role title, and company description from JD text.
 * Ported from JSX lines 2250-2289.
 *
 * @param {string} jdText - Raw job description text.
 * @returns {{companyName: string|null, roleTitle: string|null, companyDoes: string|null}}
 */
export function extractJDInfo(jdText) {
  if (!jdText) {
    return { companyName: null, roleTitle: null, companyDoes: null };
  }

  const lines = jdText.split('\n').map((l) => l.trim()).filter(Boolean);

  // --- Find role title ---
  const titleKeywords = [
    'manager', 'engineer', 'director', 'analyst', 'designer', 'developer',
    'architect', 'scientist', 'specialist', 'coordinator', 'consultant',
    'lead', 'head', 'vp', 'vice president', 'officer', 'associate',
    'administrator', 'strategist', 'producer', 'editor', 'writer',
    'recruiter', 'intern', 'fellow',
  ];

  let roleTitle = null;
  let companyName = null;

  // Scan the first 10 lines for a line containing a title keyword
  const scanLines = lines.slice(0, 10);
  for (const line of scanLines) {
    const lineLower = line.toLowerCase();
    const hasTitle = titleKeywords.some((kw) => lineLower.includes(kw));

    if (hasTitle) {
      // Handle "Title — Company" or "Title - Company" separators
      const dashSep = line.split(/\s*[—–-]\s*/);
      if (dashSep.length >= 2) {
        roleTitle = dashSep[0].trim();
        companyName = dashSep[1].trim();
        break;
      }

      // Handle "Title at Company"
      const atMatch = line.match(/^(.+?)\s+at\s+(.+)$/i);
      if (atMatch) {
        roleTitle = atMatch[1].trim();
        companyName = atMatch[2].trim();
        break;
      }

      // Just the title
      roleTitle = line.trim();
      break;
    }
  }

  // --- Find company name if not yet found ---
  if (!companyName) {
    const companyPatterns = [
      /(?:at|join|about)\s+([A-Z][A-Za-z0-9\s&.']+)/,
      /([A-Z][A-Za-z0-9\s&.']+)\s+is\s+(?:a|an|the)/,
      /(?:company|organization|firm):\s*(.+)/i,
    ];

    for (const line of lines) {
      for (const pattern of companyPatterns) {
        const match = line.match(pattern);
        if (match) {
          companyName = match[1].trim().replace(/[.,;:!?]+$/, '');
          break;
        }
      }
      if (companyName) break;
    }
  }

  // --- Find what the company does ---
  let companyDoes = null;
  const doesPatterns = [
    /(?:is\s+a|is\s+an|is\s+the)\s+(.{15,120}?)[.!]/i,
    /(?:we\s+are)\s+(.{15,120}?)[.!]/i,
    /(?:we\s+build|we\s+create|we\s+develop|we\s+provide)\s+(.{10,120}?)[.!]/i,
  ];

  const fullText = jdText;
  for (const pattern of doesPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      companyDoes = match[0].trim();
      break;
    }
  }

  return { companyName, roleTitle, companyDoes };
}

// ---------------------------------------------------------------------------
// fetchJobUrl (async)
// ---------------------------------------------------------------------------

/**
 * Fetch a job description from a URL using CORS proxies.
 *
 * Handles LinkedIn URLs specially (uses the guest API to fetch by job ID).
 * For generic URLs, tries multiple CORS proxies and parses the HTML for
 * job-description content.
 *
 * @param {string} url - The job posting URL.
 * @returns {Promise<string|null>} Plain-text job description or null.
 */
export async function fetchJobUrl(url) {
  if (!url) return null;

  try {
    // --- LinkedIn-specific handler ---
    if (url.includes('linkedin.com')) {
      return await _fetchLinkedIn(url);
    }

    // --- Generic handler: try CORS proxies ---
    return await _fetchGeneric(url);
  } catch (err) {
    console.warn('[analyzer] fetchJobUrl failed:', err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a LinkedIn job posting via the guest API.
 * @private
 */
async function _fetchLinkedIn(url) {
  // Extract job ID from URL — support multiple LinkedIn URL formats
  const jobIdMatch = url.match(/\/jobs\/view\/(\d+)/) ||
                     url.match(/currentJobId=(\d+)/) ||
                     url.match(/jobId=(\d+)/) ||
                     url.match(/\/jobs\/(\d+)/);
  if (!jobIdMatch) {
    console.warn('[analyzer] Could not extract LinkedIn job ID from URL.');
    return _fetchGeneric(url); // fallback to generic
  }

  const jobId = jobIdMatch[1];
  const apiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobId}`;

  try {
    const html = await _corsProxyFetch(apiUrl);
    if (html) {
      return _parseJobHTML(html);
    }
  } catch (err) {
    console.warn('[analyzer] LinkedIn guest API failed:', err.message);
  }

  return _fetchGeneric(url);
}

/**
 * Fetch a generic URL through CORS proxies.
 * @private
 */
async function _fetchGeneric(url) {
  const html = await _corsProxyFetch(url);
  if (!html) return null;
  return _parseJobHTML(html);
}

/**
 * Try multiple CORS proxies to fetch a URL.
 * @private
 */
async function _corsProxyFetch(url) {
  const proxies = [
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
    (u) => `https://corsproxy.io/?url=${encodeURIComponent(u)}`,
    (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u) => `https://thingproxy.freeboard.io/fetch/${u}`,
  ];

  for (const makeProxyUrl of proxies) {
    try {
      const proxyUrl = makeProxyUrl(url);
      const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });

      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';

      // allorigins /get endpoint returns JSON with { contents: "..." }
      if (contentType.includes('application/json') || proxyUrl.includes('/get?url=')) {
        try {
          const json = await res.json();
          const text = json.contents || json.data || '';
          if (text && text.length > 100) return text;
        } catch {
          // Not JSON, try as text
          continue;
        }
      }

      const text = await res.text();
      if (text && text.length > 100) return text;
    } catch {
      // try next proxy
    }
  }

  return null;
}

/**
 * Parse HTML to extract job description text.
 *
 * Strategy:
 *  1. Try JSON-LD structured data first
 *  2. Try common job-description container elements
 *  3. Fall back to body text
 *  4. Detect login walls and return null
 *
 * @param {string} html - Raw HTML string.
 * @returns {string|null} Extracted plain text.
 * @private
 */
function _parseJobHTML(html) {
  if (!html) return null;

  // Detect login walls
  const loginWallPatterns = [
    'sign in to continue',
    'log in to view',
    'create an account',
    'please log in',
    'join now to see',
  ];
  const htmlLower = html.toLowerCase();
  const isLoginWall = loginWallPatterns.some((p) => htmlLower.includes(p));

  // 1. Try JSON-LD structured data
  const jsonLdMatch = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (jsonLdMatch) {
    try {
      const ld = JSON.parse(jsonLdMatch[1]);
      const desc = ld.description || ld.jobDescription;
      if (desc) {
        return _stripHTML(desc);
      }
    } catch {
      // continue to other methods
    }
  }

  // 2. Try common job-description container selectors
  const containerPatterns = [
    /<div[^>]*class=["'][^"']*job[-_]?description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*description[-_]?content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']job[-_]?description["'][^>]*>([\s\S]*?)<\/div>/i,
    /<section[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/section>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
  ];

  for (const pattern of containerPatterns) {
    const match = html.match(pattern);
    if (match && match[1]) {
      const text = _stripHTML(match[1]);
      if (text.length > 100) return text;
    }
  }

  // 3. Fall back to body text
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const text = _stripHTML(bodyMatch[1]);
    if (text.length > 100 && !isLoginWall) return text;
  }

  // 4. Login wall detected with no usable content
  if (isLoginWall) {
    console.warn('[analyzer] Login wall detected — could not extract job description.');
    return null;
  }

  return null;
}

/**
 * Strip HTML tags and decode common entities.
 * @private
 */
function _stripHTML(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Build a single string of the user's full resume text for matching.
 * @private
 */
function _buildUserFullText(data) {
  const parts = [];

  if (data.summary) parts.push(data.summary);
  if (data.skills) parts.push(data.skills.join(' '));

  for (const exp of data.experiences || []) {
    if (exp.title) parts.push(exp.title);
    if (exp.company) parts.push(exp.company);
    if (exp.bullets) parts.push(exp.bullets.join(' '));
  }

  for (const edu of data.education || []) {
    if (edu.school) parts.push(edu.school);
    if (edu.degree) parts.push(edu.degree);
    if (edu.field) parts.push(edu.field);
  }

  return parts.join(' ').toLowerCase();
}

/**
 * Extract requirements from JD text using regex patterns.
 *
 * Looks for:
 *  - Bulleted/numbered list items
 *  - Lines starting with common requirement indicators
 *
 * @param {string} jdText - Raw JD text.
 * @returns {string[]} Array of requirement strings.
 * @private
 */
function _extractRequirements(jdText) {
  const requirements = [];
  const lines = jdText.split('\n').map((l) => l.trim()).filter(Boolean);

  let inReqSection = false;

  for (const line of lines) {
    const lineLower = line.toLowerCase();

    // Detect requirement section headers
    if (
      /^(?:requirements|qualifications|what you.?ll need|must have|minimum|preferred|nice to have)/i.test(line)
    ) {
      inReqSection = true;
      continue;
    }

    // Detect section end
    if (
      inReqSection &&
      /^(?:responsibilities|about|benefits|perks|what we offer|how to apply|company|our team)/i.test(line)
    ) {
      inReqSection = false;
      continue;
    }

    // Extract bullet-point lines
    if (inReqSection) {
      const bulletMatch = line.match(/^[\-•●○◦▪▸►\*]\s*(.+)/);
      const numberedMatch = line.match(/^\d+[.)]\s*(.+)/);

      if (bulletMatch) {
        requirements.push(bulletMatch[1].trim());
      } else if (numberedMatch) {
        requirements.push(numberedMatch[1].trim());
      } else if (line.length > 15 && line.length < 300) {
        // Plain line in requirements section
        requirements.push(line);
      }
    }

    // Also capture inline requirement patterns outside sections
    if (!inReqSection) {
      const inlineReq = line.match(
        /(?:experience (?:with|in)|proficiency in|knowledge of|familiarity with|background in)\s+(.{10,150})/i
      );
      if (inlineReq) {
        requirements.push(inlineReq[0].trim());
      }
    }
  }

  return requirements;
}

/**
 * Extract skill keywords from JD text.
 *
 * @param {string} textLower - Lowercased JD text.
 * @returns {string[]} Array of matched skill keywords.
 * @private
 */
function _extractSkillKeywords(textLower) {
  const found = [];

  for (const pattern of SKILL_KEYWORDS) {
    const re = new RegExp(`\\b${pattern}\\b`, 'i');
    if (re.test(textLower)) {
      // Use the cleaned-up pattern as the skill name
      const skillName = pattern
        .replace(/\\\+/g, '+')
        .replace(/\\\./g, '.')
        .replace(/\\b/g, '')
        .replace(/\?/g, '');
      found.push(skillName);
    }
  }

  return found;
}

/**
 * Build a user profile summary from resume data.
 *
 * @param {Object} data - Structured resume data.
 * @returns {Object} User profile summary.
 * @private
 */
function _buildUserProfile(data) {
  const experiences = data.experiences || [];
  const skills = data.skills || [];

  const currentExp = experiences.find(
    (e) => e.current || (e.endDate || '').toLowerCase().includes('present')
  );

  const currentRoles = currentExp ? currentExp.title : experiences[0]?.title || null;
  const currentCompany = currentExp ? currentExp.company : experiences[0]?.company || null;
  const companies = [...new Set(experiences.map((e) => e.company).filter(Boolean))];
  const topSkills = skills.slice(0, 8);

  // Build a one-line summary
  const yearsOfExp = experiences.length > 0
    ? `${experiences.length}+ roles`
    : 'Early career';

  const summary = [
    currentRoles && currentCompany
      ? `Currently ${currentRoles} at ${currentCompany}`
      : null,
    topSkills.length > 0
      ? `Key skills: ${topSkills.join(', ')}`
      : null,
    yearsOfExp,
  ]
    .filter(Boolean)
    .join('. ');

  return {
    currentRoles,
    currentCompany,
    companies,
    topSkills,
    summary,
  };
}

/**
 * Parse a date string into a Date object. Handles common resume date formats.
 *
 * @param {string} dateStr - Date string (e.g., "Jan 2020", "2020-01", "2020").
 * @returns {Date|null} Parsed Date or null.
 * @private
 */
function parseDate(dateStr) {
  if (!dateStr) return null;

  const str = dateStr.trim().toLowerCase();

  // Handle "present" / "current"
  if (str === 'present' || str === 'current') return new Date();

  // Try native parsing first
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;

  // Handle "Month Year" format
  const monthYearMatch = str.match(
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})$/
  );
  if (monthYearMatch) {
    const months = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    };
    return new Date(parseInt(monthYearMatch[2]), months[monthYearMatch[1].slice(0, 3)]);
  }

  // Handle plain year
  const yearMatch = str.match(/^(\d{4})$/);
  if (yearMatch) {
    return new Date(parseInt(yearMatch[1]), 0);
  }

  return null;
}
