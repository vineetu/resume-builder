/**
 * Integration test script — exercises every exported function with realistic
 * mock data and reports type/shape mismatches at every call site.
 *
 * Run: node test-integration.mjs
 */

// ── Mock browser APIs ────────────────────────────────────────────────
globalThis.window = { location: { hash: '' } };
globalThis.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
};
globalThis.document = {
  createElement(tag) {
    return {
      tagName: tag.toUpperCase(), style: {}, children: [], className: '',
      textContent: '', innerHTML: '', dataset: {},
      appendChild(c) { this.children.push(c); return c; },
      addEventListener() {}, setAttribute() {}, classList: { add() {}, remove() {}, toggle() {} },
      querySelectorAll() { return []; }, querySelector() { return null; },
      remove() {},
    };
  },
  createTextNode(t) { return { textContent: t, nodeType: 3 }; },
  getElementById() { return null; },
  querySelector() { return null; },
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.HTMLElement = class {};
globalThis.Node = class {};
globalThis.DOMParser = class {
  parseFromString() {
    return {
      body: { textContent: '', innerText: '', querySelectorAll() { return []; } },
      querySelectorAll() { return []; },
    };
  }
};
globalThis.fetch = async () => ({ ok: false, text: async () => '', json: async () => ({}) });
globalThis.AbortSignal = { timeout: () => ({}) };
globalThis.Blob = class { constructor() {} };
globalThis.URL = { createObjectURL() { return ''; }, revokeObjectURL() {} };

// ── Test harness ─────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      return result.then(() => {
        passed++;
        console.log(`  ✓ ${name}`);
      }).catch(err => {
        failed++;
        failures.push({ name, error: err.message, stack: err.stack?.split('\n')[1]?.trim() });
        console.log(`  ✗ ${name}: ${err.message}`);
      });
    }
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message, stack: err.stack?.split('\n')[1]?.trim() });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

// ── Realistic mock data ──────────────────────────────────────────────
const MOCK_EXPERIENCES = [
  {
    company: 'Google', title: 'Senior Software Engineer',
    startDate: '2020-01', endDate: '', current: true,
    bullets: ['Led team of 12 engineers to deliver $3M project', 'Reduced latency by 40% using React and Node.js', 'Built microservices architecture serving 10M users'],
    narrativeCore: 'Joined small team, scaled to 50 people',
    softSignals: ['High Autonomy', 'Scale Operator'],
    evidenceLinks: ['https://github.com/example'],
    impactScore: 0,
  },
  {
    company: 'Startup Inc', title: 'Product Manager',
    startDate: '2017-06', endDate: '2019-12', current: false,
    bullets: ['Launched MVP in 3 months', 'Managed roadmap for 5 product lines', 'Grew user base from 0 to 50K'],
    narrativeCore: '', softSignals: [], evidenceLinks: [], impactScore: 0,
  },
];

const MOCK_DATA = {
  template: 'faang',
  fullName: 'John Smith',
  email: 'john@example.com',
  phone: '+1 555 123 4567',
  location: 'San Francisco, CA',
  linkedin: 'linkedin.com/in/johnsmith',
  portfolio: 'github.com/johnsmith',
  summary: 'Senior Software Engineer with 8+ years of experience in building scalable systems.',
  experiences: MOCK_EXPERIENCES,
  education: [{ school: 'MIT', degree: "Bachelor's", field: 'Computer Science', year: '2015' }],
  skills: ['JavaScript', 'React', 'Node.js', 'Python', 'AWS', 'SQL'],
  certifications: 'AWS Solutions Architect Associate',
};

const MOCK_JD = `Senior Software Engineer at TechCorp

We are a fast-paced startup looking for a senior engineer to lead our platform team.

Requirements:
- 5+ years experience in software engineering
- Proficiency in Python, Go, or Java
- Experience with AWS or GCP cloud platforms
- Strong knowledge of distributed systems
- Experience leading cross-functional teams
- Excellent communication and stakeholder management skills

Nice to have:
- Experience with Kubernetes and Docker
- Machine learning experience
- MBA or advanced degree`;

const MOCK_JOB_CONTEXT = {
  jdText: MOCK_JD,
  jdInfo: { companyName: 'TechCorp', roleTitle: 'Senior Software Engineer', companyDoes: 'platform engineering' },
  fitData: {
    overall: 72,
    met: ['5+ years experience', 'AWS cloud platforms'],
    missing: ['Python or Go', 'Kubernetes'],
    matchedSkills: ['aws', 'javascript', 'react'],
    stretchSkills: [{ skill: 'go', pivot: { userHas: 'python', jdWants: 'go', family: 'programming-langs' } }],
    missingSkills: ['kubernetes', 'docker', 'machine learning'],
    addToExperience: [],
    addToSkills: ['kubernetes', 'docker'],
    userProfile: { currentRoles: ['Senior Software Engineer'], currentCompany: 'Google', companies: ['Google', 'Startup Inc'], topSkills: ['JavaScript', 'React'], summary: 'Senior engineer...' },
    expEntries: MOCK_EXPERIENCES,
    roleVelocity: { score: 75, label: 'Fast Tracker', trend: '📈' },
  },
};

// ── Run tests ────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== CONSTANTS ===');
  const constants = await import('./js/constants.js');

  await test('INDUSTRY_KEYWORDS is object with 19 keys', () => {
    const keys = Object.keys(constants.INDUSTRY_KEYWORDS);
    if (keys.length < 15) throw new Error(`Only ${keys.length} industries`);
  });

  await test('ROLE_MAP values are arrays', () => {
    for (const [k, v] of Object.entries(constants.ROLE_MAP)) {
      if (!Array.isArray(v)) throw new Error(`ROLE_MAP["${k}"] is ${typeof v}, not array`);
    }
  });

  await test('TEMPLATES has 6 entries with required fields', () => {
    for (const [k, v] of Object.entries(constants.TEMPLATES)) {
      if (!v.accent) throw new Error(`TEMPLATES["${k}"] missing accent`);
      if (!v.headerStyle) throw new Error(`TEMPLATES["${k}"] missing headerStyle`);
      if (!v.font) throw new Error(`TEMPLATES["${k}"] missing font`);
    }
  });

  await test('SEMANTIC_PIVOTS is object of arrays', () => {
    for (const [k, v] of Object.entries(constants.SEMANTIC_PIVOTS)) {
      if (!Array.isArray(v)) throw new Error(`SEMANTIC_PIVOTS["${k}"] is ${typeof v}`);
    }
  });

  await test('COMMON_MISSPELLINGS is object', () => {
    if (typeof constants.COMMON_MISSPELLINGS !== 'object') throw new Error('not object');
  });

  await test('CONFUSABLES is array of {rx, tip}', () => {
    for (const c of constants.CONFUSABLES) {
      if (!c.rx) throw new Error('CONFUSABLE missing rx');
      if (!(c.rx instanceof RegExp)) throw new Error('CONFUSABLE rx is not RegExp');
    }
  });

  await test('WEAK_PHRASES is array of {rx, fix, tip}', () => {
    for (const w of constants.WEAK_PHRASES) {
      if (!w.rx) throw new Error('WEAK_PHRASE missing rx');
      if (!(w.rx instanceof RegExp)) throw new Error('WEAK_PHRASE rx is not RegExp');
    }
  });

  await test('BUZZWORDS is array of {rx, tip}', () => {
    for (const b of constants.BUZZWORDS) {
      if (!b.rx) throw new Error('BUZZWORD missing rx');
      if (!(b.rx instanceof RegExp)) throw new Error('BUZZWORD rx is not RegExp');
    }
  });

  await test('GRAMMAR_RULES is array of {rx, fix, tip}', () => {
    for (const g of constants.GRAMMAR_RULES) {
      if (!g.rx) throw new Error('GRAMMAR_RULE missing rx');
      if (!(g.rx instanceof RegExp)) throw new Error('GRAMMAR_RULE rx is not RegExp');
    }
  });

  await test('PASSIVE_RX is RegExp', () => {
    if (!(constants.PASSIVE_RX instanceof RegExp)) throw new Error('not RegExp');
  });

  await test('ACTION_VERBS is array of strings', () => {
    if (!Array.isArray(constants.ACTION_VERBS)) throw new Error('not array');
    if (typeof constants.ACTION_VERBS[0] !== 'string') throw new Error('not strings');
  });

  await test('LEARNING_PATHS is object', () => {
    const keys = Object.keys(constants.LEARNING_PATHS);
    if (keys.length < 10) throw new Error(`Only ${keys.length} paths`);
  });

  await test('HR_TIPS has 5 tabs', () => {
    const tabs = Object.keys(constants.HR_TIPS);
    if (tabs.length < 4) throw new Error(`Only ${tabs.length} tabs: ${tabs.join(', ')}`);
  });

  await test('WINNING_BULLETS has 9 categories', () => {
    const cats = Object.keys(constants.WINNING_BULLETS);
    if (cats.length < 8) throw new Error(`Only ${cats.length} categories`);
  });

  // ── ANALYZER ─────────────────────────────────────────────────────
  console.log('\n=== ANALYZER ===');
  const analyzer = await import('./js/analyzer.js');

  await test('detectIndustries(experiences) returns array', () => {
    const result = analyzer.detectIndustries(MOCK_EXPERIENCES);
    if (!Array.isArray(result)) throw new Error(`returned ${typeof result}`);
    if (result.length === 0) throw new Error('empty result');
    if (!result[0].industry) throw new Error('missing .industry');
    if (typeof result[0].confidence !== 'number') throw new Error('missing .confidence');
  });

  await test('detectIndustries(null) returns empty array', () => {
    const result = analyzer.detectIndustries(null);
    if (!Array.isArray(result) || result.length !== 0) throw new Error('should be []');
  });

  await test('analyzeCompanyCulture(string) returns vibe', () => {
    const result = analyzer.analyzeCompanyCulture(MOCK_JD);
    if (!result.vibe) throw new Error('missing .vibe');
    if (!result.vibe.label) throw new Error('missing .vibe.label');
    if (!result.prioritizedSignals) throw new Error('missing .prioritizedSignals');
  });

  await test('calculateImpactScore(bullets) returns number 0-100', () => {
    const score = analyzer.calculateImpactScore(MOCK_EXPERIENCES[0].bullets);
    if (typeof score !== 'number') throw new Error(`returned ${typeof score}`);
    if (score < 0 || score > 100) throw new Error(`score ${score} out of range`);
  });

  await test('calculateImpactScore(null) returns 0', () => {
    const score = analyzer.calculateImpactScore(null);
    if (score !== 0) throw new Error(`expected 0, got ${score}`);
  });

  await test('extractMetrics(string) returns array of {type, value}', () => {
    const result = analyzer.extractMetrics('Drove $4.2M revenue, leading 15-person team to 30% improvement');
    if (!Array.isArray(result)) throw new Error(`returned ${typeof result}`);
    if (result.length === 0) throw new Error('no metrics found');
    if (!result[0].type || !result[0].value) throw new Error('missing type/value');
  });

  await test('extractMetrics(null) returns []', () => {
    const result = analyzer.extractMetrics(null);
    if (!Array.isArray(result) || result.length !== 0) throw new Error('should be []');
  });

  await test('extractMetrics(object) returns [] (not crash)', () => {
    const result = analyzer.extractMetrics({ foo: 'bar' });
    if (!Array.isArray(result)) throw new Error('should return array');
  });

  await test('findPivot(skill, skills[], experiences[]) returns pivot or null', () => {
    const result = analyzer.findPivot('vue', ['react', 'python'], MOCK_EXPERIENCES);
    if (result === undefined) throw new Error('returned undefined, expected object or null');
    if (result && !result.family) throw new Error('missing .family');
    if (result && !result.userHas) throw new Error('missing .userHas');
  });

  await test('findPivot with no match returns null', () => {
    const result = analyzer.findPivot('blockchain', ['react'], MOCK_EXPERIENCES);
    if (result !== null) throw new Error(`expected null, got ${JSON.stringify(result)}`);
  });

  await test('calculateRoleVelocity(experiences[]) returns {score, label, trend}', () => {
    const result = analyzer.calculateRoleVelocity(MOCK_EXPERIENCES);
    if (typeof result.score !== 'number') throw new Error('missing .score');
    if (!result.label) throw new Error('missing .label');
    if (!result.trend) throw new Error('missing .trend');
  });

  await test('calculateRoleVelocity(null) returns default', () => {
    const result = analyzer.calculateRoleVelocity(null);
    if (typeof result.score !== 'number') throw new Error('should return default');
  });

  await test('calculateRoleVelocity("not array") returns default', () => {
    const result = analyzer.calculateRoleVelocity('oops');
    if (typeof result.score !== 'number') throw new Error('should return default');
  });

  await test('extractJDInfo(string) returns {companyName, roleTitle}', () => {
    const result = analyzer.extractJDInfo(MOCK_JD);
    if (!result.roleTitle) throw new Error('missing .roleTitle');
    if (!result.companyName) throw new Error('missing .companyName');
  });

  await test('analyzeJobFit(data, jdText) returns fit object', async () => {
    const result = await analyzer.analyzeJobFit(MOCK_DATA, MOCK_JD, false);
    if (typeof result.overall !== 'number') throw new Error('missing .overall');
    if (!Array.isArray(result.met)) throw new Error('.met not array');
    if (!Array.isArray(result.missing)) throw new Error('.missing not array');
    if (!result.jdInfo) throw new Error('missing .jdInfo');
  });

  // ── LINTER ───────────────────────────────────────────────────────
  console.log('\n=== LINTER ===');
  const linter = await import('./js/linter.js');

  await test('checkText(string) returns array of issues', () => {
    const issues = linter.checkText('I was responsible for managment of the the team. I am a detail-oriented self-starter.');
    if (!Array.isArray(issues)) throw new Error(`returned ${typeof issues}`);
    if (issues.length === 0) throw new Error('no issues found (expected several)');
    for (const issue of issues) {
      if (!issue.type) throw new Error('issue missing .type');
      if (!issue.tip) throw new Error('issue missing .tip');
      if (typeof issue.color !== 'string') throw new Error('issue missing .color');
    }
  });

  await test('checkText(null) returns []', () => {
    const result = linter.checkText(null);
    if (!Array.isArray(result) || result.length !== 0) throw new Error('should be []');
  });

  await test('checkText capped at 50 issues', () => {
    // Long text that would generate many hits
    const longText = 'I was responsible for various things etc etc. '.repeat(100);
    const result = linter.checkText(longText);
    if (result.length > 50) throw new Error(`${result.length} issues exceeds cap of 50`);
  });

  await test('calculateSignalScore(string) returns {score, label, color}', () => {
    const result = linter.calculateSignalScore('Led team of 12 to deliver $3M project ahead of schedule.');
    if (typeof result.score !== 'number') throw new Error('missing .score');
    if (!result.label) throw new Error('missing .label');
    if (!result.color) throw new Error('missing .color');
  });

  await test('fixAll(text, issues) returns string', () => {
    const issues = linter.checkText('I was responsible for managment.');
    const fixed = linter.fixAll('I was responsible for managment.', issues);
    if (typeof fixed !== 'string') throw new Error(`returned ${typeof fixed}`);
  });

  // ── AI ENGINE ────────────────────────────────────────────────────
  console.log('\n=== AI ENGINE ===');
  const aiEngine = await import('./js/ai-engine.js');

  await test('extractJDPhrases(string) returns array', () => {
    const result = aiEngine.extractJDPhrases(MOCK_JD);
    if (!Array.isArray(result)) throw new Error(`returned ${typeof result}`);
  });

  await test('enhanceBullet(string) returns string', async () => {
    const result = await aiEngine.enhanceBullet('managed team projects');
    if (typeof result !== 'string') throw new Error(`returned ${typeof result}`);
    if (result.length < 5) throw new Error('result too short');
  });

  await test('enhanceBullet(null) handles gracefully', async () => {
    const result = await aiEngine.enhanceBullet(null);
    // Should return null or empty string, not crash
    if (result === undefined) throw new Error('returned undefined');
  });

  await test('tailorResume(data, jobContext) returns tailor result', async () => {
    const result = await aiEngine.tailorResume(MOCK_DATA, MOCK_JOB_CONTEXT);
    if (!result) throw new Error('returned null/undefined');
    if (typeof result.summary !== 'string') throw new Error('missing .summary string');
    if (!Array.isArray(result.experiences)) throw new Error('.experiences not array');
    if (!Array.isArray(result.skills)) throw new Error('.skills not array');
    if (typeof result.changeCount !== 'number') throw new Error('missing .changeCount');
    // Check experience bullet shape
    if (result.experiences.length > 0) {
      const exp = result.experiences[0];
      if (typeof exp.expIdx !== 'number') throw new Error('exp missing .expIdx');
      if (!Array.isArray(exp.bullets)) throw new Error('exp.bullets not array');
      if (exp.bullets.length > 0) {
        const b = exp.bullets[0];
        if (typeof b.original !== 'string') throw new Error('bullet missing .original');
        if (typeof b.rewritten !== 'string') throw new Error('bullet missing .rewritten');
        if (typeof b.changed !== 'boolean') throw new Error('bullet missing .changed');
      }
    }
  });

  await test('generateStandOutSuggestions(data, jobContext) returns result', async () => {
    const result = await aiEngine.generateStandOutSuggestions(MOCK_DATA, MOCK_JOB_CONTEXT);
    if (!result) throw new Error('returned null/undefined');
    if (!Array.isArray(result.suggestions)) throw new Error('.suggestions not array');
    if (!Array.isArray(result.topCategories)) throw new Error('.topCategories not array');
    if (!Array.isArray(result.differentiators)) throw new Error('.differentiators not array');
  });

  await test('generateAISuggestions(data, jobContext) returns result', async () => {
    const result = await aiEngine.generateAISuggestions(MOCK_DATA, MOCK_JOB_CONTEXT);
    if (!result) throw new Error('returned null/undefined');
    if (!result.summary) throw new Error('missing .summary');
    if (!Array.isArray(result.experience)) throw new Error('.experience not array');
    if (!Array.isArray(result.skills)) throw new Error('.skills not array');
  });

  await test('generateSummaryVariations(data, jobContext) returns array', async () => {
    const result = await aiEngine.generateSummaryVariations(MOCK_DATA, MOCK_JOB_CONTEXT);
    if (!Array.isArray(result)) throw new Error(`returned ${typeof result}`);
    if (result.length < 3) throw new Error(`only ${result.length} variations`);
  });

  // ── EXPORT ───────────────────────────────────────────────────────
  console.log('\n=== EXPORT ===');
  const exportMod = await import('./js/export.js');

  await test('downloadPDF is a function', () => {
    if (typeof exportMod.downloadPDF !== 'function') throw new Error('not a function');
  });

  await test('downloadWord is a function', () => {
    if (typeof exportMod.downloadWord !== 'function') throw new Error('not a function');
  });

  await test('downloadHTML is a function', () => {
    if (typeof exportMod.downloadHTML !== 'function') throw new Error('not a function');
  });

  await test('printResume is a function', () => {
    if (typeof exportMod.printResume !== 'function') throw new Error('not a function');
  });

  // ── GEMINI ───────────────────────────────────────────────────────
  console.log('\n=== GEMINI ===');
  const gemini = await import('./js/gemini.js');

  await test('hasApiKey returns boolean', () => {
    if (typeof gemini.hasApiKey() !== 'boolean') throw new Error('not boolean');
  });

  await test('setApiKey/getApiKey roundtrip', () => {
    gemini.setApiKey('test-key-123');
    const key = gemini.getApiKey();
    if (key !== 'test-key-123') throw new Error(`got "${key}"`);
  });

  // ── CROSS-MODULE CALL SITES ──────────────────────────────────────
  // These test the exact calls that pages make to utility modules
  console.log('\n=== CROSS-MODULE CALL SITES (page→utility) ===');

  await test('target-job: calculateRoleVelocity(data.experiences)', () => {
    const result = analyzer.calculateRoleVelocity(MOCK_DATA.experiences);
    if (typeof result.score !== 'number') throw new Error('failed');
  });

  await test('target-job: extractMetrics(summary + bullets text)', () => {
    const allBulletText = MOCK_DATA.experiences.flatMap(e => e.bullets || []).join(' ');
    const text = `${MOCK_DATA.summary} ${allBulletText}`;
    const result = analyzer.extractMetrics(text);
    if (!Array.isArray(result)) throw new Error('failed');
  });

  await test('target-job: analyzeCompanyCulture(jdText string)', () => {
    const result = analyzer.analyzeCompanyCulture(MOCK_JD);
    if (!result.vibe) throw new Error('failed');
  });

  await test('target-job: extractJDInfo(jdText string)', () => {
    const result = analyzer.extractJDInfo(MOCK_JD);
    if (!result.roleTitle) throw new Error('failed');
  });

  await test('editor: detectIndustries(data.experiences)', () => {
    const result = analyzer.detectIndustries(MOCK_DATA.experiences);
    if (!Array.isArray(result)) throw new Error('failed');
  });

  await test('editor: calculateImpactScore(exp.bullets)', () => {
    const score = analyzer.calculateImpactScore(MOCK_EXPERIENCES[0].bullets);
    if (typeof score !== 'number') throw new Error('failed');
  });

  await test('editor: tailorResume(data, jobContext) for ghost mode', async () => {
    const result = await aiEngine.tailorResume(MOCK_DATA, MOCK_JOB_CONTEXT);
    if (!result || !result.summary) throw new Error('failed');
  });

  await test('preview: extractMetrics(bullet string)', () => {
    const result = analyzer.extractMetrics('Led team of 12 to deliver $3M project');
    if (!Array.isArray(result)) throw new Error('failed');
  });

  await test('preview: analyzeCompanyCulture(jobContext.jdText)', () => {
    const result = analyzer.analyzeCompanyCulture(MOCK_JOB_CONTEXT.jdText);
    if (!result.vibe) throw new Error('failed');
  });

  // ── RESULTS ──────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log('════════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\nFAILURE DETAILS:');
    failures.forEach(f => {
      console.log(`\n  ✗ ${f.name}`);
      console.log(`    Error: ${f.error}`);
      if (f.stack) console.log(`    At: ${f.stack}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
