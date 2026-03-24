// import.js — Import/Upload page for Resume Forge SPA

import { extractPDFText, parseResumeText } from '../parser.js';
import { detectIndustries } from '../analyzer.js';
import { saveOriginalSnapshot } from '../app.js';

// ── Helpers ──────────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'className') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'htmlFor') {
      node.setAttribute('for', value);
    } else {
      node.setAttribute(key, value);
    }
  }

  if (typeof children === 'string') {
    node.textContent = children;
  } else if (Array.isArray(children)) {
    children.forEach((child) => {
      if (!child) return;
      if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    });
  }

  return node;
}

// ── State local to this page (not persisted) ─────────────────────────

let importStatus = 'idle'; // idle | loading | success | error
let importError = '';
let parsedResult = null;

// Export reset function for clearing cache
export function resetImportCache() {
  importStatus = 'idle';
  importError = '';
  parsedResult = null;
}

// Expose reset function on window for app.js clearAll()
window.resetImportCache = resetImportCache;

// ── Main render ──────────────────────────────────────────────────────

export function renderImport(container, state) {
  const page = el('div', { className: 'page' });
  const content = el('div', { className: 'page-content' });
  page.appendChild(content);

  // 1. Page Header
  content.appendChild(renderPageHeader());

  // 2. Warning Banner (if data exists)
  if (state.hasResumeData()) {
    content.appendChild(renderWarningBanner());
  }

  // 3. Drag & Drop Upload Area
  content.appendChild(renderUploadArea(state));

  // 4. Success Result Panel
  if (importStatus === 'success' && parsedResult) {
    content.appendChild(renderSuccessPanel(state));
  }

  // 5. Error Panel
  if (importStatus === 'error') {
    content.appendChild(renderErrorPanel());
  }

  // 6. Your Information Form
  content.appendChild(renderInfoForm(state));

  // 7. Detected Industries
  const industries = detectIndustriesSafe(state);
  if (industries.length > 0) {
    content.appendChild(renderIndustries(industries));
  }

  // 8. Navigation Buttons
  content.appendChild(renderNavButtons(state));

  container.appendChild(page);
}

// ── 1. Page Header ───────────────────────────────────────────────────

function renderPageHeader() {
  const header = el('div', { className: 'page-header' });

  header.appendChild(el('h1', { className: 'page-title' }, 'Import Your Resume'));
  header.appendChild(
    el('p', { className: 'page-subtitle' }, 'Upload a PDF or TXT file to get started'),
  );

  return header;
}

// ── 2. Warning Banner ───────────────────────────────────────────────

function renderWarningBanner() {
  const banner = el('div', {
    className: 'glass',
    style: {
      background: 'rgba(201, 123, 123, 0.06)',
      border: '1px solid rgba(201, 123, 123, 0.25)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 20px',
      marginBottom: '24px',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
  });

  banner.appendChild(
    el('span', { style: { fontSize: '18px' } }, '\u26A0\uFE0F'),
  );

  const text = el('div');
  text.appendChild(
    el(
      'span',
      { style: { fontWeight: '600', color: 'var(--accent-rose)', fontSize: '13px' } },
      'Warning: ',
    ),
  );
  text.appendChild(
    el(
      'span',
      { style: { color: 'var(--text-body)', fontSize: '13px' } },
      'You already have data loaded. Importing a file will overwrite it.',
    ),
  );

  banner.appendChild(text);
  return banner;
}

// ── 3. Upload Area ──────────────────────────────────────────────────

function renderUploadArea(state) {
  const isLoading = importStatus === 'loading';

  const fileInput = el('input', {
    type: 'file',
    accept: '.pdf,.txt',
    style: { display: 'none' },
  });

  const zone = el('div', {
    style: {
      border: '2px dashed var(--border)',
      borderRadius: 'var(--radius-xl)',
      padding: '48px 32px',
      textAlign: 'center',
      cursor: isLoading ? 'default' : 'pointer',
      transition: 'all 0.25s ease',
      marginBottom: '24px',
      background: 'var(--bg-card)',
    },
  });

  // Icon
  zone.appendChild(
    el('div', { style: { fontSize: '48px', marginBottom: '12px' } }, isLoading ? '\u23F3' : '\uD83D\uDCC4'),
  );

  // Primary text
  zone.appendChild(
    el(
      'div',
      {
        style: {
          fontSize: '16px',
          fontWeight: '600',
          color: 'var(--text-primary)',
          marginBottom: '6px',
        },
      },
      isLoading ? 'Importing your resume...' : 'Drag & drop your resume here',
    ),
  );

  // Secondary text
  if (!isLoading) {
    zone.appendChild(
      el(
        'div',
        { style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' } },
        'or click to browse your files',
      ),
    );
  } else {
    zone.appendChild(
      el(
        'div',
        {
          className: 'animate-pulse',
          style: { fontSize: '13px', color: 'var(--text-muted)', marginBottom: '16px' },
        },
        'Parsing content with AI...',
      ),
    );
  }

  // File type badges
  const badges = el('div', {
    style: { display: 'flex', justifyContent: 'center', gap: '8px' },
  });
  badges.appendChild(el('span', { className: 'tag tag-teal' }, 'PDF'));
  badges.appendChild(el('span', { className: 'tag tag-lavender' }, 'TXT'));
  zone.appendChild(badges);

  // Append hidden input
  zone.appendChild(fileInput);

  // ── Click handler ─────────────────────────────────────────────────

  if (!isLoading) {
    zone.addEventListener('click', () => fileInput.click());
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file, state);
  });

  // ── Drag & Drop handlers ──────────────────────────────────────────

  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.style.borderColor = 'var(--accent-teal)';
    zone.style.background = 'rgba(123, 165, 165, 0.06)';
  });

  zone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.style.borderColor = 'var(--border)';
    zone.style.background = 'var(--bg-card)';
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zone.style.borderColor = 'var(--border)';
    zone.style.background = 'var(--bg-card)';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file, state);
  });

  return zone;
}

// ── 4. File Handler ─────────────────────────────────────────────────

async function handleFile(file, state) {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (ext !== 'pdf' && ext !== 'txt') {
    importStatus = 'error';
    importError = `Unsupported file type ".${ext}". Please upload a PDF or TXT file.`;
    rerender(state);
    return;
  }

  importStatus = 'loading';
  importError = '';
  parsedResult = null;
  rerender(state);

  try {
    let rawText = '';

    if (ext === 'pdf') {
      rawText = await extractPDFText(file);
    } else {
      rawText = await file.text();
    }

    if (!rawText || rawText.trim().length === 0) {
      throw new Error('Could not extract any text from the file.');
    }

    const parsed = await parseResumeText(rawText);

    if (!parsed) {
      throw new Error('Failed to parse resume content. Please try a different file.');
    }

    // Merge parsed data into state
    parsedResult = parsed;
    state.updateData({
      fullName: parsed.fullName || state.data.fullName || '',
      email: parsed.email || state.data.email || '',
      phone: parsed.phone || state.data.phone || '',
      location: parsed.location || state.data.location || '',
      linkedin: parsed.linkedin || state.data.linkedin || '',
      portfolio: parsed.portfolio || state.data.portfolio || '',
      summary: parsed.summary || state.data.summary || '',
      experiences: parsed.experiences?.length
        ? parsed.experiences.map((exp) => ({
            company: exp.company || '',
            title: exp.title || '',
            startDate: exp.startDate || '',
            endDate: exp.endDate || '',
            current: exp.current || false,
            bullets: exp.bullets?.length ? exp.bullets : [''],
            narrativeCore: exp.narrativeCore || '',
            softSignals: exp.softSignals || [],
            evidenceLinks: exp.evidenceLinks || [],
            impactScore: exp.impactScore || 0,
          }))
        : state.data.experiences,
      education: parsed.education?.length
        ? parsed.education.map((edu) => ({
            school: edu.school || '',
            degree: edu.degree || '',
            field: edu.field || '',
            year: edu.year || '',
          }))
        : state.data.education,
      skills: parsed.skills?.length ? parsed.skills : state.data.skills,
      certifications: parsed.certifications || state.data.certifications || '',
    });

    importStatus = 'success';

    // Save a deep copy of the freshly-imported data as the "original" snapshot
    saveOriginalSnapshot(structuredClone(state.data));
  } catch (err) {
    console.error('[import] File handling error:', err);
    importStatus = 'error';
    importError = err.message || 'An unexpected error occurred during import.';
  }

  rerender(state);
}

// ── 5. Success Result Panel ─────────────────────────────────────────

function renderSuccessPanel(state) {
  const data = state.data;
  const expCount = data.experiences.filter((e) => e.company || e.title).length;
  const eduCount = data.education.filter((e) => e.school || e.degree).length;
  const skillCount = data.skills.length;

  const panel = el('div', {
    className: 'glass animate-slide-up',
    style: {
      background: 'rgba(123, 171, 142, 0.06)',
      border: '1px solid rgba(123, 171, 142, 0.25)',
      borderRadius: 'var(--radius-lg)',
      padding: '24px',
      marginBottom: '24px',
    },
  });

  // Header
  panel.appendChild(
    el(
      'div',
      {
        style: {
          fontSize: '16px',
          fontWeight: '700',
          color: 'var(--accent-green)',
          marginBottom: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        },
      },
      [
        el('span', {}, '\u2705'),
        el('span', {}, 'Resume imported successfully!'),
      ],
    ),
  );

  // Stats row
  const stats = el('div', {
    style: {
      display: 'flex',
      gap: '16px',
      marginBottom: '20px',
      flexWrap: 'wrap',
    },
  });

  stats.appendChild(renderStatBadge('\uD83D\uDCBC', 'Experiences', expCount));
  stats.appendChild(renderStatBadge('\uD83C\uDF93', 'Education', eduCount));
  stats.appendChild(renderStatBadge('\u26A1', 'Skills', skillCount));

  panel.appendChild(stats);

  // Parsed Roles Preview (first 4)
  const visibleExps = data.experiences
    .filter((e) => e.title || e.company)
    .slice(0, 4);

  if (visibleExps.length > 0) {
    panel.appendChild(
      el(
        'div',
        {
          style: {
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--text-label)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          },
        },
        'Parsed Roles',
      ),
    );

    const rolesList = el('div', {
      style: { marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '4px' },
    });

    visibleExps.forEach((exp) => {
      const line = el('div', {
        style: { fontSize: '13px', color: 'var(--text-body)' },
      });
      line.appendChild(
        el('span', { style: { fontWeight: '600', color: 'var(--text-primary)' } }, exp.title || 'Untitled Role'),
      );
      if (exp.company) {
        line.appendChild(el('span', { style: { color: 'var(--text-muted)' } }, ` at ${exp.company}`));
      }
      rolesList.appendChild(line);
    });

    panel.appendChild(rolesList);
  }

  // Parsed Skills Preview (first 12 as tags)
  if (data.skills.length > 0) {
    panel.appendChild(
      el(
        'div',
        {
          style: {
            fontSize: '12px',
            fontWeight: '600',
            color: 'var(--text-label)',
            marginBottom: '8px',
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          },
        },
        'Parsed Skills',
      ),
    );

    const skillsWrap = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '20px' },
    });

    data.skills.slice(0, 12).forEach((skill) => {
      skillsWrap.appendChild(el('span', { className: 'tag tag-teal' }, skill));
    });

    if (data.skills.length > 12) {
      skillsWrap.appendChild(
        el('span', { className: 'tag tag-gold' }, `+${data.skills.length - 12} more`),
      );
    }

    panel.appendChild(skillsWrap);
  }

  // Action buttons
  const actions = el('div', {
    style: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
  });

  actions.appendChild(
    el(
      'button',
      {
        className: 'btn-primary',
        onClick: () => state.setPage('target-job'),
      },
      'Target a Job',
    ),
  );

  actions.appendChild(
    el(
      'button',
      {
        className: 'btn-secondary',
        onClick: () => state.setPage('editor'),
      },
      'Edit Details',
    ),
  );

  panel.appendChild(actions);
  return panel;
}

function renderStatBadge(icon, label, count) {
  const isDetected = count > 0;
  const color = isDetected ? 'var(--accent-green)' : 'var(--accent-rose)';
  const bg = isDetected
    ? 'rgba(123, 171, 142, 0.1)'
    : 'rgba(201, 123, 123, 0.1)';
  const border = isDetected
    ? '1px solid rgba(123, 171, 142, 0.2)'
    : '1px solid rgba(201, 123, 123, 0.2)';

  return el(
    'div',
    {
      style: {
        background: bg,
        border: border,
        borderRadius: 'var(--radius-md)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      },
    },
    [
      el('span', { style: { fontSize: '18px' } }, icon),
      el('span', { style: { fontWeight: '700', fontSize: '16px', color } }, String(count)),
      el('span', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, label),
      !isDetected
        ? el(
            'span',
            { style: { fontSize: '11px', color: 'var(--accent-rose)', fontStyle: 'italic' } },
            'not detected',
          )
        : null,
    ],
  );
}

// ── 6. Error Panel ──────────────────────────────────────────────────

function renderErrorPanel() {
  const panel = el('div', {
    className: 'glass animate-slide-up',
    style: {
      background: 'rgba(201, 123, 123, 0.06)',
      border: '1px solid rgba(201, 123, 123, 0.25)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      marginBottom: '24px',
    },
  });

  panel.appendChild(
    el(
      'div',
      {
        style: {
          fontSize: '15px',
          fontWeight: '700',
          color: 'var(--accent-rose)',
          marginBottom: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        },
      },
      [
        el('span', {}, '\u274C'),
        el('span', {}, 'Import failed'),
      ],
    ),
  );

  panel.appendChild(
    el(
      'div',
      { style: { fontSize: '13px', color: 'var(--text-body)', lineHeight: '1.5' } },
      importError,
    ),
  );

  return panel;
}

// ── 7. Your Information Form ────────────────────────────────────────

function renderInfoForm(state) {
  const section = el('div', {
    className: 'glass',
    style: {
      borderRadius: 'var(--radius-lg)',
      padding: '24px',
      marginBottom: '24px',
    },
  });

  section.appendChild(
    el(
      'div',
      { className: 'section-title', style: { marginBottom: '18px' } },
      'Your Information',
    ),
  );

  // 2-column grid: Full Name, Email, Phone, Location
  const grid = el('div', { className: 'grid-2', style: { marginBottom: '14px' } });
  grid.appendChild(renderField('Full Name', 'text', state.data.fullName, (v) => state.updateData({ fullName: v })));
  grid.appendChild(renderField('Email', 'email', state.data.email, (v) => state.updateData({ email: v })));
  grid.appendChild(renderField('Phone', 'tel', state.data.phone, (v) => state.updateData({ phone: v })));
  grid.appendChild(renderField('Location', 'text', state.data.location, (v) => state.updateData({ location: v })));
  section.appendChild(grid);

  // Full-width: LinkedIn, Portfolio
  section.appendChild(
    renderField('LinkedIn', 'url', state.data.linkedin, (v) => state.updateData({ linkedin: v }), {
      placeholder: 'https://linkedin.com/in/...',
    }),
  );
  section.appendChild(
    renderField('Portfolio', 'url', state.data.portfolio, (v) => state.updateData({ portfolio: v }), {
      placeholder: 'https://...',
    }),
  );

  // Summary textarea
  const summaryGroup = el('div', { className: 'form-group' });
  summaryGroup.appendChild(el('label', { className: 'label' }, 'Summary'));
  const textarea = el('textarea', {
    className: 'glass-input',
    rows: '3',
    placeholder: 'A brief professional summary...',
    value: state.data.summary || '',
  });
  textarea.value = state.data.summary || '';
  textarea.addEventListener('input', (e) => state.updateData({ summary: e.target.value }));
  summaryGroup.appendChild(textarea);
  section.appendChild(summaryGroup);

  return section;
}

function renderField(label, type, value, onChange, opts = {}) {
  const group = el('div', { className: 'form-group' });
  group.appendChild(el('label', { className: 'label' }, label));

  const input = el('input', {
    className: 'glass-input',
    type,
    placeholder: opts.placeholder || label,
    value: value || '',
  });
  input.value = value || '';
  input.addEventListener('input', (e) => onChange(e.target.value));
  group.appendChild(input);
  return group;
}

// ── 8. Detected Industries ──────────────────────────────────────────

function detectIndustriesSafe(state) {
  try {
    return detectIndustries(state.data.experiences) || [];
  } catch {
    return [];
  }
}

function renderIndustries(industries) {
  const card = el('div', {
    className: 'glass animate-fade-in',
    style: {
      background: 'rgba(143, 184, 201, 0.06)',
      border: '1px solid rgba(143, 184, 201, 0.25)',
      borderRadius: 'var(--radius-lg)',
      padding: '20px 24px',
      marginBottom: '24px',
    },
  });

  card.appendChild(
    el(
      'div',
      {
        style: {
          fontSize: '14px',
          fontWeight: '700',
          color: 'var(--accent-sky)',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        },
      },
      [
        el('span', {}, '\uD83C\uDFAF'),
        el('span', {}, 'Detected Industries'),
      ],
    ),
  );

  const tagsWrap = el('div', {
    style: { display: 'flex', flexWrap: 'wrap', gap: '8px' },
  });

  industries.forEach(({ industry, confidence }) => {
    const pct = Math.round((confidence || 0) * 100);
    const tag = el('span', { className: 'tag tag-teal' }, `${industry} (${pct}%)`);
    tagsWrap.appendChild(tag);
  });

  card.appendChild(tagsWrap);
  return card;
}

// ── 9. Navigation Buttons ───────────────────────────────────────────

function renderNavButtons(state) {
  const row = el('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
    },
  });

  row.appendChild(
    el(
      'button',
      {
        className: 'btn-secondary',
        onClick: () => state.setPage('home'),
      },
      'Back to Home',
    ),
  );

  row.appendChild(
    el(
      'button',
      {
        className: 'btn-primary',
        onClick: () => state.setPage('editor'),
      },
      'Continue to Editor',
    ),
  );

  return row;
}

// ── Re-render helper ────────────────────────────────────────────────

function rerender(state) {
  const main = document.getElementById('app-main');
  if (!main) return;
  main.textContent = '';
  renderImport(main, state);
}
