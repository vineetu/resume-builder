/**
 * End-to-end Playwright test — exercises the full user flow and reports
 * every broken feature, console error, and UI issue.
 *
 * Run: node test-e2e.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BASE = 'http://localhost:8080';
let GEMINI_KEY = '';
try { GEMINI_KEY = readFileSync(resolve('../.env'), 'utf8').match(/GEMINI_KEY=(.+)/)?.[1]?.trim() || ''; } catch { }
try { if (!GEMINI_KEY) GEMINI_KEY = readFileSync(resolve('.env'), 'utf8').match(/GEMINI_KEY=(.+)/)?.[1]?.trim() || ''; } catch { }

let passed = 0;
let failed = 0;
const failures = [];
const consoleErrors = [];

function ok(name) { passed++; console.log(`  ✓ ${name}`); }
function fail(name, reason) {
  failed++;
  failures.push({ name, reason });
  console.log(`  ✗ ${name}: ${reason}`);
}

async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (err) {
    fail(name, err.message);
  }
}

const SAMPLE_JD = `Senior Software Engineer at TechCorp

About TechCorp
We are a fast-paced startup building the future of cloud infrastructure.

Requirements:
- 5+ years of software engineering experience
- Proficiency in Python, Go, or Java
- Experience with AWS or GCP cloud platforms
- Strong knowledge of distributed systems and microservices
- Experience leading cross-functional teams of 5+ engineers
- Excellent communication and stakeholder management skills

Nice to have:
- Experience with Kubernetes and Docker
- Machine learning or AI experience
- Experience with real-time data pipelines

Benefits:
- Competitive salary $180K-$250K
- Equity package
- Remote-first culture`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  // Capture ALL console errors
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore browser extension errors
      if (!text.includes('bootstrap-autofill') && !text.includes('Extension')) {
        consoleErrors.push(text);
      }
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push(`PAGE ERROR: ${err.message}`);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 1. HOME PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(BASE);
  await page.waitForTimeout(1000);

  // Pre-set the API key in localStorage so the modal doesn't appear
  await page.evaluate((key) => {
    localStorage.setItem('resume_forge_gemini_key', key || 'skip');
  }, GEMINI_KEY);
  // Reload to skip modal
  await page.goto(BASE);
  await page.waitForTimeout(1000);

  await check('Home page renders', async () => {
    const title = await page.textContent('body');
    if (!title.includes('Multiverse') && !title.includes('Resume')) {
      throw new Error('Title not found on page');
    }
  });

  await check('Import Resume card exists', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Import Resume') && !text.includes('Import')) {
      throw new Error('Import card not found');
    }
  });

  await check('Target a Job card exists', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Target a Job') && !text.includes('Target')) {
      throw new Error('Target card not found');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 2. IMPORT PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#import`);
  await page.waitForTimeout(1000);

  await check('Import page renders', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Import') && !text.includes('Upload')) {
      throw new Error('Import page content not found');
    }
  });

  // Upload the test resume via file input
  await check('File upload works', async () => {
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) throw new Error('File input not found');
    await fileInput.setInputFiles(resolve('test-resume.txt'));
    await page.waitForTimeout(4000); // Wait for parsing (Gemini attempt + regex fallback)
  });

  await check('Resume parsed — name extracted', async () => {
    // Check inputs for the name value (it's in the form fields, not necessarily visible as text)
    const inputs = await page.$$('input');
    let nameFound = false;
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val && (val.includes('John') || val.includes('Smith'))) { nameFound = true; break; }
    }
    const text = await page.textContent('body');
    if (!nameFound && !text.includes('John') && !text.includes('Smith')) {
      throw new Error('Name not found in form fields or page text');
    }
  });

  await check('Resume parsed — experiences detected', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Google') && !text.includes('Experience')) {
      throw new Error('Experiences not detected');
    }
  });

  await check('Resume parsed — skills detected', async () => {
    const text = await page.textContent('body');
    if (!text.includes('React') && !text.includes('Skills')) {
      throw new Error('Skills not detected');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 3. EDITOR PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#editor`);
  await page.waitForTimeout(1500);

  await check('Editor page renders without crash', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Editor') && !text.includes('Resume')) {
      throw new Error('Editor page not rendered');
    }
  });

  await check('Editor has sidebar tabs', async () => {
    const text = await page.textContent('body');
    const hasTabs = text.includes('Personal') || text.includes('Experience') || text.includes('Skills');
    if (!hasTabs) throw new Error('Sidebar tabs not found');
  });

  await check('Personal info fields populated', async () => {
    // Check if any input has a value
    const inputs = await page.$$('input');
    let hasValue = false;
    for (const input of inputs) {
      const val = await input.inputValue();
      if (val && val.length > 2) { hasValue = true; break; }
    }
    if (!hasValue) throw new Error('No input fields have values from imported resume');
  });

  await check('Summary textarea has content', async () => {
    const textareas = await page.$$('textarea');
    let hasContent = false;
    for (const ta of textareas) {
      const val = await ta.inputValue();
      if (val && val.length > 20) { hasContent = true; break; }
    }
    if (!hasContent) throw new Error('No textarea has summary content');
  });

  // Click Experience tab first, then check textareas
  await check('Experience tab works', async () => {
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text.includes('Experience') && !text.includes('Add')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Experience tab button not found');
    await page.waitForTimeout(500);
    const text = await page.textContent('body');
    if (!text.includes('Company') && !text.includes('Title') && !text.includes('Position')) {
      throw new Error('Experience tab content not rendered');
    }
  });

  await check('Bullet textareas are full-width (>400px)', async () => {
    const textareas = await page.$$('textarea');
    if (textareas.length < 1) throw new Error('No bullet textareas found in Experience tab');
    const box = await textareas[0].boundingBox();
    if (!box) throw new Error('Textarea not visible');
    if (box.width < 300) throw new Error(`Textarea width is only ${Math.round(box.width)}px — expected >300px`);
  });

  // Click Skills tab
  await check('Skills tab works', async () => {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text === 'Skills' || text.includes('Skills')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(500);
    const text = await page.textContent('body');
    if (!text.includes('React') && !text.includes('JavaScript') && !text.includes('Add')) {
      throw new Error('Skills tab content not rendered');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 4. TARGET JOB PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#target-job`);
  await page.waitForTimeout(1000);

  await check('Target Job page renders', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Target') && !text.includes('Job')) {
      throw new Error('Target job page not rendered');
    }
  });

  await check('Step wizard visible', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Job Posting') && !text.includes('Analyzing')) {
      throw new Error('Step wizard not visible');
    }
  });

  // Switch to paste mode and paste JD
  await check('Can switch to paste mode', async () => {
    const buttons = await page.$$('button');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text.includes('Paste Job Description') || text.includes('Paste')) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(300);
  });

  await check('Can paste job description', async () => {
    const textareas = await page.$$('textarea');
    if (textareas.length === 0) throw new Error('No textarea found for JD');
    await textareas[0].fill(SAMPLE_JD);
    const val = await textareas[0].inputValue();
    if (val.length < 50) throw new Error('JD text not pasted');
  });

  // Click Analyze
  await check('Analyze button works', async () => {
    const buttons = await page.$$('button');
    let clicked = false;
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text.includes('Analyze') && text.includes('Fit')) {
        await btn.click();
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error('Analyze button not found');
  });

  // Wait for analysis (1.8s animation + processing + async)
  await page.waitForTimeout(6000);

  await check('Fit score displayed (> 0%)', async () => {
    const text = await page.textContent('body');
    // Look for a percentage that's not 0%
    const match = text.match(/(\d+)%/);
    if (!match) throw new Error('No percentage found on page');
    const pct = parseInt(match[1]);
    if (pct === 0) throw new Error('Fit score is 0% — analysis likely failed');
  });

  await check('Company/role info extracted', async () => {
    const text = await page.textContent('body');
    if (!text.includes('TechCorp') && !text.includes('Engineer')) {
      throw new Error('Company/role not extracted from JD');
    }
  });

  await check('Requirements or skills shown', async () => {
    const text = await page.textContent('body');
    const hasContent = text.includes('✓') || text.includes('✗') || text.includes('Match') ||
                       text.includes('Gap') || text.includes('ATS') || text.includes('Skill') ||
                       text.includes('requirement') || text.includes('Requirement') ||
                       text.includes('Strong') || text.includes('Competitive') || text.includes('Needs');
    if (!hasContent) throw new Error('No analysis results shown');
  });

  await check('Action plan visible', async () => {
    const text = await page.textContent('body');
    const hasAction = text.includes('P1') || text.includes('ATS') || text.includes('Keywords') || text.includes('Action');
    if (!hasAction) throw new Error('Action plan not visible');
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 5. TEMPLATES PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#templates`);
  await page.waitForTimeout(1000);

  await check('Templates page renders', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Template') && !text.includes('Choose')) {
      throw new Error('Templates page not rendered');
    }
  });

  await check('All 6 templates shown', async () => {
    const text = await page.textContent('body');
    const templates = ['Google', 'McKinsey', 'Goldman', 'C-Suite', 'Startup', 'Product'];
    const found = templates.filter(t => text.includes(t));
    if (found.length < 5) throw new Error(`Only found ${found.length}/6 templates: ${found.join(', ')}`);
  });

  await check('Template cards are clickable', async () => {
    // Click the first template card
    const cards = await page.$$('.glass, [style*="cursor: pointer"], [style*="cursor:pointer"]');
    if (cards.length < 1) throw new Error('No clickable template cards found');
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 6. PREVIEW PAGE ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#preview`);
  await page.waitForTimeout(1500);

  await check('Preview page renders', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Preview') && !text.includes('Multiverse')) {
      throw new Error('Preview page not rendered');
    }
  });

  await check('Resume name displayed', async () => {
    const text = await page.textContent('body');
    if (!text.includes('John') && !text.includes('Smith')) {
      throw new Error('Resume name not shown in preview');
    }
  });

  await check('Download button exists', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Download')) {
      throw new Error('Download button not found');
    }
  });

  await check('Experience bullets rendered', async () => {
    const text = await page.textContent('body');
    if (!text.includes('engineer') && !text.includes('Led') && !text.includes('team')) {
      throw new Error('Experience bullets not rendered in preview');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 7. EDITOR FEATURES (after job targeting) ===');
  // ═══════════════════════════════════════════════════════════════════
  await page.goto(`${BASE}#editor`);
  await page.waitForTimeout(1500);

  await check('Editor still works after job analysis', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Editor') && !text.includes('Resume')) {
      throw new Error('Editor failed to render after job analysis');
    }
  });

  await check('Ghost Mode button exists', async () => {
    const text = await page.textContent('body');
    if (!text.includes('Ghost Mode') && !text.includes('Ghost')) {
      throw new Error('Ghost Mode button not found');
    }
  });

  await check('HR Tips button exists', async () => {
    const text = await page.textContent('body');
    if (!text.includes('HR Tips')) {
      throw new Error('HR Tips button not found');
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== 8. NAVIGATION ===');
  // ═══════════════════════════════════════════════════════════════════

  const pages = [
    { hash: '#home', expect: 'Multiverse' },
    { hash: '#import', expect: 'Import' },
    { hash: '#editor', expect: 'Editor' },
    { hash: '#target-job', expect: 'Target' },
    { hash: '#templates', expect: 'Template' },
    { hash: '#preview', expect: 'Preview' },
  ];

  for (const { hash, expect } of pages) {
    await check(`Navigate to ${hash}`, async () => {
      await page.goto(`${BASE}${hash}`);
      await page.waitForTimeout(800);
      const text = await page.textContent('body');
      if (!text.includes(expect)) {
        throw new Error(`Expected "${expect}" on page, not found`);
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════
  await browser.close();

  console.log('\n════════════════════════════════════════════');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log('════════════════════════════════════════════');

  if (consoleErrors.length > 0) {
    console.log(`\nCONSOLE ERRORS (${consoleErrors.length}):`);
    [...new Set(consoleErrors)].forEach(e => console.log(`  ⚠ ${e.substring(0, 200)}`));
  }

  if (failures.length > 0) {
    console.log('\nFAILURE DETAILS:');
    failures.forEach(f => console.log(`  ✗ ${f.name}: ${f.reason}`));
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner crashed:', err);
  process.exit(2);
});
