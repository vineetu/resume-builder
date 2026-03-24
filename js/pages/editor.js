/**
 * Editor page — 5-tab resume editor with AI advisor, ghost mode,
 * linting, and industry-aware suggestions.
 *
 * @module pages/editor
 */

import { detectIndustries, calculateImpactScore, analyzeCompanyCulture } from '../analyzer.js';
import { generateAISuggestions, generateSummaryVariations, tailorResume } from '../ai-engine.js';
import { renderLinterPanel } from '../linter.js';
import { showProgress, hideProgress } from '../progress.js';
import {
  INDUSTRY_KEYWORDS,
  RECOMMENDED_CERTS,
  BULLET_TIPS,
  HR_TIPS,
  SOFT_SIGNAL_OPTIONS,
  ACTION_VERBS,
} from '../constants.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABS = [
  { key: 'personal', label: 'Personal Info' },
  { key: 'experience', label: 'Experience' },
  { key: 'education', label: 'Education' },
  { key: 'skills', label: 'Skills' },
  { key: 'training', label: 'Training & Certs' },
];

const TAB_TO_TIPS_KEY = {
  personal: 'personal',
  experience: 'experience',
  education: 'education',
  skills: 'skills',
  training: 'training',
};

const SUMMARY_MAX = 500;
const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
    } else if (k === 'className') {
      node.className = v;
    } else if (k === 'textContent') {
      node.textContent = v;
    } else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(k, v);
    }
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else if (child instanceof Node) {
      node.appendChild(child);
    }
  }
  return node;
}

function badge(count) {
  if (!count) return null;
  return el('span', {
    textContent: String(count),
    style: {
      background: '#e53e3e',
      color: '#fff',
      fontSize: '10px',
      fontWeight: '700',
      borderRadius: '50%',
      width: '18px',
      height: '18px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: '6px',
      flexShrink: '0',
    },
  });
}

// ---------------------------------------------------------------------------
// renderEditor
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} container
 * @param {object} state - AppState instance
 */
// Module-level state cache — persists across re-renders triggered by global state changes
let _editorCache = {
  activeTab: 'personal', advisorOpen: true, tipsOpen: false,
  ghostMode: false, ghostSuggestions: null, appliedSuggestions: new Set(),
  summaryVariants: [], summaryVariantIdx: 0,
  _aiLoaded: false, _aiSuggestions: null, _aiJdText: null,
};

// Export reset function for clearing cache
export function resetEditorCache() {
  Object.assign(_editorCache, {
    activeTab: 'personal', advisorOpen: true, tipsOpen: false,
    ghostMode: false, ghostSuggestions: null, appliedSuggestions: new Set(),
    summaryVariants: [], summaryVariantIdx: 0,
    _aiLoaded: false, _aiSuggestions: null, _aiJdText: null,
  });
}

// Expose reset function on window for app.js clearAll()
window.resetEditorCache = resetEditorCache;

export function renderEditor(container, state) {
  container.innerHTML = '';

  // -- Local editor state — restore from cache --------------------------------
  let activeTab = _editorCache.activeTab;
  let newSkill = '';
  let advisorOpen = _editorCache.advisorOpen;
  let tipsOpen = _editorCache.tipsOpen;
  let ghostMode = _editorCache.ghostMode;
  let ghostSuggestions = _editorCache.ghostSuggestions;
  let appliedSuggestions = _editorCache.appliedSuggestions;
  let summaryVariants = _editorCache.summaryVariants;
  let summaryVariantIdx = _editorCache.summaryVariantIdx;

  function syncEditorCache() {
    Object.assign(_editorCache, {
      activeTab, advisorOpen, tipsOpen, ghostMode, ghostSuggestions,
      appliedSuggestions, summaryVariants, summaryVariantIdx,
    });
  }

  // Use getters so we always read fresh state
  const getData = () => state.data;
  const getJobContext = () => state.jobContext;
  // Aliases for convenience (read once at render time, refreshed by renderContent)
  let data = state.data;
  let jobContext = state.jobContext;
  let hasJob = !!(jobContext && jobContext.jdInfo);

  // Suggestion counts per tab (for badges)
  function getSuggestionCounts() {
    if (!hasJob) return {};
    const counts = {};
    const ai = _editorCache._aiSuggestions;
    // Personal: summary suggestion
    if (ai?.summary?.suggested || summaryVariants.length) counts.personal = 1;
    // Experience: per-bullet suggestions
    if (ai?.experience) {
      counts.experience = ai.experience.reduce((sum, e) => sum + (e.suggestions?.length || 0), 0);
    }
    // Skills: combine fitData missing + AI suggested, deduplicated
    const fitMissing = getJobContext().fitData?.missingSkills || [];
    const aiSkills = (ai?.skills || []).map(s => typeof s === 'string' ? s : s.skill || '');
    const allMissing = new Set([...fitMissing, ...aiSkills].map(s => s.toLowerCase()));
    if (allMissing.size > 0) counts.skills = allMissing.size;
    return counts;
  }

  // -- Detect industries for current data ------------------------------------
  let detectedIndustries = [];
  try {
    detectedIndustries = detectIndustries(data.experiences || []) || [];
  } catch (_) {
    // analyzer module may not be loaded yet
  }

  // -- Build page structure ---------------------------------------------------
  const page = el('div', { className: 'page', style: { maxWidth: '1200px', margin: '0 auto', padding: '24px' } });

  // Page header
  page.appendChild(buildPageHeader());

  // AI Resume Advisor banner
  if (hasJob) {
    page.appendChild(buildAdvisorBanner());
  }

  // Main layout: sidebar + content
  const layout = el('div', {
    style: {
      display: 'flex',
      gap: '24px',
      marginTop: '20px',
      alignItems: 'flex-start',
    },
  });

  const sidebar = buildSidebar();
  const contentArea = el('div', { style: { flex: '1', minWidth: '0' } });

  layout.appendChild(sidebar);
  layout.appendChild(contentArea);
  page.appendChild(layout);

  // Navigation footer
  page.appendChild(buildNavFooter());

  container.appendChild(page);

  // Initial content render
  renderContent();

  // Auto-load AI suggestions in background when job context exists
  // Reset cache if the JD text has changed since last load
  if (hasJob && _editorCache._aiLoaded && _editorCache._aiJdText !== (jobContext.jdText || '')) {
    _editorCache._aiLoaded = false;
    _editorCache._aiSuggestions = null;
    _editorCache._aiJdText = null;
  }
  console.log('[editor] hasJob:', hasJob, '_aiLoaded:', _editorCache._aiLoaded, '_aiJdText match:', _editorCache._aiJdText === (jobContext?.jdText || ''));
  if (hasJob && !_editorCache._aiLoaded) {
    console.log('[editor] Starting AI auto-load...');
    _editorCache._aiLoaded = true;
    _editorCache._aiJdText = jobContext.jdText || '';
    // Generate suggestions synchronously using deterministic fallback (no Gemini wait)
    // Use setTimeout(0) to let the UI render first, then compute
    setTimeout(async () => {
      showProgress('Generating AI suggestions');
      showProgress('Generating summary variants');
      try {
        const suggestions = await generateAISuggestions(getData(), getJobContext());
        _editorCache._aiSuggestions = suggestions;
        hideProgress('Generating AI suggestions');

        const variants = await generateSummaryVariations(getData(), getJobContext());
        summaryVariants = (variants || []).map(v => typeof v === 'string' ? v : (v.text || v.label || ''));
        _editorCache.summaryVariants = summaryVariants;
        summaryVariantIdx = 0;
        _editorCache.summaryVariantIdx = 0;
        hideProgress('Generating summary variants');

        renderContent();
      } catch (err) {
        console.warn('[editor] AI suggestions failed:', err);
        hideProgress('Generating AI suggestions');
        hideProgress('Generating summary variants');
      }
    }, 50);
  }

  // =========================================================================
  // BUILDER FUNCTIONS
  // =========================================================================

  function buildPageHeader() {
    const header = el('div', { style: { marginBottom: '20px' } });

    const titleRow = el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px',
      },
    });

    const titleGroup = el('div');
    titleGroup.appendChild(el('h1', {
      textContent: 'Resume Editor',
      style: { fontSize: '28px', fontWeight: '800', margin: '0', color: 'var(--text-primary)' },
    }));
    titleGroup.appendChild(el('p', {
      textContent: 'Edit and enhance your career information',
      style: { fontSize: '13px', color: 'var(--text-muted)', margin: '4px 0 0 0' },
    }));

    const btnGroup = el('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } });

    // Ghost Mode toggle
    const ghostBtn = el('button', {
      className: ghostMode ? 'btn-primary btn-sm' : 'btn-secondary btn-sm',
      textContent: ghostMode ? 'Ghost Mode ON' : 'Ghost Mode',
      style: { position: 'relative' },
      onClick: async () => {
        ghostMode = !ghostMode;
        if (ghostMode) {
          ghostBtn.textContent = 'Loading...';
          showProgress('Tailoring resume (Ghost Mode)');
          try {
            ghostSuggestions = await tailorResume(getData(), getJobContext());
          } catch (err) {
            console.warn('[editor] Ghost mode failed:', err);
            ghostSuggestions = null;
          } finally {
            hideProgress('Tailoring resume (Ghost Mode)');
          }
        } else {
          ghostSuggestions = null;
        }
        // Update button appearance
        ghostBtn.textContent = ghostMode ? 'Ghost Mode ON' : 'Ghost Mode';
        ghostBtn.className = ghostMode ? 'btn-primary btn-sm' : 'btn-secondary btn-sm';
        renderContent();
      },
    });
    if (ghostMode) {
      ghostBtn.style.background = 'linear-gradient(135deg, rgba(128, 90, 213, 0.25), rgba(108, 78, 172, 0.18))';
      ghostBtn.style.borderColor = 'rgba(128, 90, 213, 0.5)';
    }
    btnGroup.appendChild(ghostBtn);

    // HR Tips toggle
    const tipsBtn = el('button', {
      className: tipsOpen ? 'btn-primary btn-sm' : 'btn-secondary btn-sm',
      textContent: tipsOpen ? 'HR Tips ON' : 'HR Tips',
      onClick: () => {
        tipsOpen = !tipsOpen;
        renderContent();
      },
    });
    btnGroup.appendChild(tipsBtn);

    // Target a Job
    btnGroup.appendChild(el('button', {
      className: 'btn-secondary btn-sm',
      textContent: 'Target a Job',
      onClick: () => state.setPage('target-job'),
    }));

    // Preview
    btnGroup.appendChild(el('button', {
      className: 'btn-primary btn-sm',
      textContent: 'Preview',
      onClick: () => state.setPage('preview'),
    }));

    titleRow.appendChild(titleGroup);
    titleRow.appendChild(btnGroup);
    header.appendChild(titleRow);

    return header;
  }

  // -------------------------------------------------------------------------
  // AI Resume Advisor Banner
  // -------------------------------------------------------------------------

  function buildAdvisorBanner() {
    const jc = getJobContext();
    const fd = jc.fitData;
    // analyzeJobFit returns .overall (not .fitPercent); compute same way as target-job
    let fitPct = 0;
    if (fd) {
      if (fd.overall && fd.overall > 0) {
        fitPct = fd.overall;
      } else {
        const matched = (fd.matchedSkills || []).length;
        const missing = (fd.missingSkills || []).length;
        const stretch = (fd.stretchSkills || []).length;
        const totalSkills = matched + missing + stretch;
        fitPct = totalSkills > 0 ? Math.min(95, Math.max(15, Math.round(((matched + stretch * 0.5) / totalSkills) * 100))) : 0;
      }
    }
    const matched = fd ? (fd.matchedSkills || []).length : 0;
    const missing = fd ? (fd.missingSkills || []).length : 0;
    const jdTitle = jc.jdInfo ? jc.jdInfo.roleTitle || '' : '';

    const banner = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginBottom: '4px',
        borderLeft: '3px solid rgba(128, 90, 213, 0.6)',
      },
    });

    const topRow = el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
      },
      onClick: () => {
        advisorOpen = !advisorOpen;
        renderEditor(container, state);
      },
    });

    const leftSide = el('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
    leftSide.appendChild(el('span', { textContent: '\uD83E\uDD16', style: { fontSize: '20px' } }));
    leftSide.appendChild(el('span', {
      textContent: 'AI Resume Advisor',
      style: { fontWeight: '700', fontSize: '14px' },
    }));
    if (jdTitle) {
      leftSide.appendChild(el('span', {
        textContent: `Targeting: ${jdTitle}`,
        style: { fontSize: '12px', color: 'var(--text-muted)', marginLeft: '8px' },
      }));
    }

    const fitBadge = el('span', {
      textContent: `${fitPct}% fit`,
      style: {
        fontSize: '12px',
        fontWeight: '700',
        padding: '3px 10px',
        borderRadius: '12px',
        color: '#fff',
        background: fitPct >= 70 ? '#48bb78' : fitPct >= 40 ? '#ecc94b' : '#fc8181',
      },
    });

    topRow.appendChild(leftSide);
    topRow.appendChild(fitBadge);
    banner.appendChild(topRow);

    if (advisorOpen) {
      const details = el('div', { style: { marginTop: '12px', fontSize: '13px', color: 'var(--text-body)' } });
      if (jc.jdInfo && jc.jdInfo.description) {
        details.appendChild(el('p', {
          textContent: jc.jdInfo.description,
          style: { margin: '0 0 8px 0', lineHeight: '1.5' },
        }));
      }
      details.appendChild(el('span', {
        textContent: `${matched} matched  |  ${missing} missing`,
        style: { fontSize: '12px', color: 'var(--text-muted)' },
      }));
      banner.appendChild(details);
    }

    return banner;
  }

  // -------------------------------------------------------------------------
  // Sidebar
  // -------------------------------------------------------------------------

  function buildSidebar() {
    const counts = getSuggestionCounts();

    const nav = el('nav', {
      style: {
        width: '180px',
        flexShrink: '0',
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
      },
    });

    for (const tab of TABS) {
      const isActive = tab.key === activeTab;

      const btn = el('button', {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          border: 'none',
          borderLeft: isActive ? '3px solid var(--accent-teal)' : '3px solid transparent',
          background: isActive ? 'rgba(123, 165, 165, 0.08)' : 'transparent',
          color: isActive ? 'var(--accent-teal)' : 'var(--text-body)',
          fontWeight: isActive ? '600' : '400',
          fontSize: '13px',
          cursor: 'pointer',
          borderRadius: '0 6px 6px 0',
          textAlign: 'left',
          width: '100%',
          transition: 'all 0.15s ease',
        },
        onClick: () => {
          activeTab = tab.key;
          renderContent();
          // Also update sidebar active states
          updateSidebarActive(nav, tab.key);
        },
      });

      btn.appendChild(el('span', { textContent: tab.label }));

      const count = counts[tab.key];
      if (count) {
        const b = badge(count);
        b.dataset.badge = '1';
        btn.appendChild(b);
      }

      btn.dataset.tabKey = tab.key;
      nav.appendChild(btn);
    }

    return nav;
  }

  function updateSidebarActive(nav, activeKey) {
    for (const btn of nav.children) {
      const isActive = btn.dataset.tabKey === activeKey;
      btn.style.borderLeft = isActive ? '3px solid var(--accent-teal)' : '3px solid transparent';
      btn.style.background = isActive ? 'rgba(123, 165, 165, 0.08)' : 'transparent';
      btn.style.color = isActive ? 'var(--accent-teal)' : 'var(--text-body)';
      btn.style.fontWeight = isActive ? '600' : '400';
    }
  }

  // -------------------------------------------------------------------------
  // Content area renderer (called on tab change)
  // -------------------------------------------------------------------------

  function renderContent() {
    syncEditorCache();
    // Refresh data references from current state
    data = state.data;
    jobContext = state.jobContext;
    hasJob = !!(jobContext && jobContext.jdInfo);
    contentArea.innerHTML = '';

    // Update sidebar badges
    const counts = getSuggestionCounts();
    for (const btn of sidebar.children) {
      const key = btn.dataset.tabKey;
      // Remove old badge if any
      const oldBadge = btn.querySelector('span[data-badge]');
      if (oldBadge) oldBadge.remove();
      // Add new badge
      const count = counts[key];
      if (count) {
        const b = badge(count);
        if (b) {
          b.dataset.badge = '1';
          btn.appendChild(b);
        }
      }
    }

    // HR Tips panel (above content)
    if (tipsOpen) {
      contentArea.appendChild(buildHRTipsPanel());
    }

    // Tab content
    switch (activeTab) {
      case 'personal':
        contentArea.appendChild(buildPersonalTab());
        break;
      case 'experience':
        contentArea.appendChild(buildExperienceTab());
        break;
      case 'education':
        contentArea.appendChild(buildEducationTab());
        break;
      case 'skills':
        contentArea.appendChild(buildSkillsTab());
        break;
      case 'training':
        contentArea.appendChild(buildTrainingTab());
        break;
    }
  }

  // -------------------------------------------------------------------------
  // HR Tips Panel
  // -------------------------------------------------------------------------

  function buildHRTipsPanel() {
    const tipsKey = TAB_TO_TIPS_KEY[activeTab];
    const tips = HR_TIPS[tipsKey] || [];

    const panel = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginBottom: '16px',
        borderLeft: '3px solid rgba(123, 165, 165, 0.4)',
      },
    });

    panel.appendChild(el('h3', {
      textContent: 'HR Insider Tips',
      style: { fontSize: '14px', fontWeight: '700', margin: '0 0 12px 0', color: 'var(--accent-teal)' },
    }));

    const grid = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });

    for (const item of tips) {
      const card = el('div', {
        style: {
          padding: '12px 14px',
          borderRadius: '8px',
          background: 'rgba(123, 165, 165, 0.04)',
          border: '1px solid rgba(123, 165, 165, 0.12)',
        },
      });

      card.appendChild(el('p', {
        textContent: `"${item.tip}"`,
        style: { margin: '0 0 6px 0', fontSize: '13px', lineHeight: '1.55', fontStyle: 'italic' },
      }));
      card.appendChild(el('span', {
        textContent: `-- ${item.speaker}`,
        style: { fontSize: '11px', color: 'var(--text-muted)', fontWeight: '600' },
      }));

      grid.appendChild(card);
    }

    panel.appendChild(grid);
    return panel;
  }

  // =========================================================================
  // TAB: Personal Info
  // =========================================================================

  function buildPersonalTab() {
    const section = el('div');

    // 2-column grid: Full Name, Email, Phone, Location
    const grid2 = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' },
    });

    grid2.appendChild(buildField('Full Name', data.fullName, (v) => state.updateData({ fullName: v })));
    grid2.appendChild(buildField('Email', data.email, (v) => state.updateData({ email: v }), 'email'));
    grid2.appendChild(buildField('Phone', data.phone, (v) => state.updateData({ phone: v }), 'tel'));
    grid2.appendChild(buildField('Location', data.location, (v) => state.updateData({ location: v })));
    section.appendChild(grid2);

    // Full-width: LinkedIn, Portfolio
    const fullFields = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' },
    });
    fullFields.appendChild(buildField('LinkedIn', data.linkedin, (v) => state.updateData({ linkedin: v }), 'url'));
    fullFields.appendChild(buildField('Portfolio', data.portfolio, (v) => state.updateData({ portfolio: v }), 'url'));
    section.appendChild(fullFields);

    // Summary textarea with character count
    const summaryGroup = el('div', { style: { marginBottom: '14px' } });
    const summaryLabel = el('label', {
      textContent: 'Professional Summary',
      style: { display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' },
    });
    summaryGroup.appendChild(summaryLabel);

    const summaryTextarea = el('textarea', {
      value: data.summary || '',
      style: {
        width: '100%',
        minHeight: '100px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1.5px solid var(--border)',
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
        fontSize: '13px',
        lineHeight: '1.55',
        resize: 'vertical',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
    });
    summaryTextarea.value = data.summary || '';
    summaryTextarea.maxLength = SUMMARY_MAX;

    const charCount = el('span', {
      textContent: `${(data.summary || '').length}/${SUMMARY_MAX}`,
      style: { fontSize: '11px', color: 'var(--text-muted)', float: 'right', marginTop: '4px' },
    });

    // Linter container for summary
    const linterContainer = el('div');

    const debouncedLint = debounce((text) => {
      renderLinterPanel(linterContainer, text, 'summary', (fixed) => {
        summaryTextarea.value = fixed;
        state.updateData({ summary: fixed });
        charCount.textContent = `${fixed.length}/${SUMMARY_MAX}`;
      });
    }, DEBOUNCE_MS);

    summaryTextarea.addEventListener('input', () => {
      const val = summaryTextarea.value;
      state.updateData({ summary: val });
      charCount.textContent = `${val.length}/${SUMMARY_MAX}`;
      debouncedLint(val);
    });

    summaryGroup.appendChild(summaryTextarea);
    summaryGroup.appendChild(charCount);
    summaryGroup.appendChild(linterContainer);

    // Initial linter render
    if (data.summary) {
      renderLinterPanel(linterContainer, data.summary, 'summary', (fixed) => {
        summaryTextarea.value = fixed;
        state.updateData({ summary: fixed });
        charCount.textContent = `${fixed.length}/${SUMMARY_MAX}`;
      });
    }

    section.appendChild(summaryGroup);

    // Ghost Mode overlay for summary
    if (ghostMode && ghostSuggestions && ghostSuggestions.summary) {
      section.appendChild(buildGhostOverlay(
        ghostSuggestions.summary,
        () => {
          state.updateData({ summary: ghostSuggestions.summary });
          renderContent();
        },
        () => {
          const merged = (data.summary || '') + '\n' + ghostSuggestions.summary;
          state.updateData({ summary: merged });
          renderContent();
        },
        () => {
          ghostSuggestions.summary = null;
          renderContent();
        },
      ));
    }

    // AI Suggested Summary (when jobContext exists)
    if (hasJob) {
      section.appendChild(buildAISummarySection());
    }

    // Detected Industries tags
    if (detectedIndustries.length) {
      const tagSection = el('div', { style: { marginTop: '16px' } });
      tagSection.appendChild(el('label', {
        textContent: 'Detected Industries',
        style: { display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '8px' },
      }));

      const tagCloud = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      for (const ind of detectedIndustries) {
        const label = typeof ind === 'string' ? ind : `${ind.industry} ${ind.confidence}%`;
        tagCloud.appendChild(el('span', {
          textContent: label,
          style: {
            padding: '4px 10px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600',
            background: ind.confidence > 60 ? 'rgba(123, 165, 165, 0.15)' : 'rgba(143, 184, 201, 0.15)',
            color: ind.confidence > 60 ? 'var(--accent-teal)' : 'var(--accent-sky)',
            border: `1px solid ${ind.confidence > 60 ? 'rgba(123, 165, 165, 0.25)' : 'rgba(143, 184, 201, 0.25)'}`,
          },
        }));
      }
      tagSection.appendChild(tagCloud);
      section.appendChild(tagSection);
    }

    return section;
  }

  // -------------------------------------------------------------------------
  // AI Summary Section
  // -------------------------------------------------------------------------

  function buildAISummarySection() {
    const wrapper = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginTop: '16px',
        borderLeft: '3px solid rgba(128, 90, 213, 0.4)',
      },
    });

    const headerRow = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
    });

    headerRow.appendChild(el('h4', {
      textContent: 'AI Suggested Summary',
      style: { margin: '0', fontSize: '14px', fontWeight: '700' },
    }));

    const controls = el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } });

    if (summaryVariants.length > 0) {
      controls.appendChild(el('span', {
        textContent: `Style ${summaryVariantIdx + 1} of ${summaryVariants.length}`,
        style: { fontSize: '11px', color: 'var(--text-muted)' },
      }));
    }

    const refreshBtn = el('button', {
      className: 'btn-secondary btn-sm',
      textContent: 'Refresh',
      onClick: async () => {
        try {
          const raw = await generateSummaryVariations(getData(), getJobContext(), { skipCache: true });
          // Normalize: if array of objects with .text, extract text strings
          summaryVariants = (raw || []).map(v => typeof v === 'string' ? v : (v.text || v.label || ''));
          summaryVariantIdx = 0;
        } catch (err) {
          console.warn('[editor] Summary generation failed:', err);
          summaryVariants = [];
        }
        renderContent();
      },
    });
    controls.appendChild(refreshBtn);

    // Cycle through variants
    if (summaryVariants.length > 1) {
      const nextBtn = el('button', {
        className: 'btn-secondary btn-sm',
        textContent: 'Next Style',
        onClick: () => {
          summaryVariantIdx = (summaryVariantIdx + 1) % summaryVariants.length;
          renderContent();
        },
      });
      controls.appendChild(nextBtn);
    }

    headerRow.appendChild(controls);
    wrapper.appendChild(headerRow);

    if (summaryVariants.length > 0) {
      const preview = el('p', {
        textContent: summaryVariants[summaryVariantIdx],
        style: {
          margin: '0 0 12px 0',
          fontSize: '13px',
          lineHeight: '1.6',
          padding: '12px',
          borderRadius: '8px',
          background: 'rgba(128, 90, 213, 0.04)',
          border: '1px solid rgba(128, 90, 213, 0.12)',
        },
      });
      wrapper.appendChild(preview);

      const actionRow = el('div', { style: { display: 'flex', gap: '8px' } });
      actionRow.appendChild(el('button', {
        className: 'btn-primary btn-sm',
        textContent: 'Use This Summary',
        onClick: () => {
          state.updateData({ summary: summaryVariants[summaryVariantIdx] });
          summaryVariants = [];
          renderContent();
        },
      }));
      actionRow.appendChild(el('button', {
        className: 'btn-secondary btn-sm',
        textContent: 'Dismiss',
        onClick: () => {
          summaryVariants = [];
          renderContent();
        },
      }));
      wrapper.appendChild(actionRow);
    } else if (_editorCache._aiSuggestions?.summary?.suggested) {
      // Show AI-generated summary from auto-load cache
      const aiSummary = _editorCache._aiSuggestions.summary.suggested;
      const preview = el('p', {
        textContent: aiSummary,
        style: {
          margin: '0 0 12px 0',
          fontSize: '13px',
          lineHeight: '1.6',
          padding: '12px',
          borderRadius: '8px',
          background: 'rgba(128, 90, 213, 0.04)',
          border: '1px solid rgba(128, 90, 213, 0.12)',
        },
      });
      wrapper.appendChild(preview);

      const actionRow = el('div', { style: { display: 'flex', gap: '8px' } });
      actionRow.appendChild(el('button', {
        className: 'btn-primary btn-sm',
        textContent: 'Use This Summary',
        onClick: () => {
          state.updateData({ summary: aiSummary });
          _editorCache._aiSuggestions.summary.suggested = null;
          renderContent();
        },
      }));
      actionRow.appendChild(el('button', {
        className: 'btn-secondary btn-sm',
        textContent: 'Dismiss',
        onClick: () => {
          _editorCache._aiSuggestions.summary.suggested = null;
          renderContent();
        },
      }));
      wrapper.appendChild(actionRow);
    } else {
      wrapper.appendChild(el('p', {
        textContent: hasJob ? 'AI summary suggestions are loading — check the progress indicator above.' : 'Add a target job on the Target Job page to get AI-powered summary suggestions.',
        style: { fontSize: '12px', color: 'var(--text-muted)', margin: '0', fontStyle: 'italic' },
      }));
    }

    return wrapper;
  }

  // =========================================================================
  // TAB: Experience
  // =========================================================================

  function buildExperienceTab() {
    const section = el('div');

    // Add Experience button
    section.appendChild(el('button', {
      className: 'btn-primary btn-sm',
      textContent: '+ Add Experience',
      style: { marginBottom: '16px' },
      onClick: () => {
        state.addExperience();
        renderContent();
      },
    }));

    // Per experience card
    data.experiences.forEach((exp, idx) => {
      section.appendChild(buildExperienceCard(exp, idx));
    });

    // Bullet Tips panel (industry-specific)
    if (detectedIndustries.length > 0) {
      const primaryIndustry = detectedIndustries[0];
      const tips = BULLET_TIPS[primaryIndustry];
      if (tips) {
        section.appendChild(buildBulletTipsPanel(primaryIndustry, tips));
      }
    }

    // AI Experience Suggestions (when jobContext exists)
    if (hasJob) {
      section.appendChild(buildAIExperienceSuggestions());
    }

    return section;
  }

  function buildExperienceCard(exp, idx) {
    const card = el('div', {
      className: 'glass',
      style: { padding: '20px', marginBottom: '16px' },
    });

    // Position header with Remove button
    const header = el('div', {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '14px',
      },
    });

    header.appendChild(el('h3', {
      textContent: exp.title || exp.company || `Position ${idx + 1}`,
      style: { margin: '0', fontSize: '16px', fontWeight: '700' },
    }));

    header.appendChild(el('button', {
      className: 'btn-danger btn-sm',
      textContent: 'Remove',
      onClick: () => {
        state.removeExperience(idx);
        renderContent();
      },
    }));

    card.appendChild(header);

    // 2x2 grid: Company, Title, Start Date, End Date
    const grid = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' },
    });

    grid.appendChild(buildField('Company', exp.company, (v) => {
      state.updateExperience(idx, { company: v });
    }));
    grid.appendChild(buildField('Title', exp.title, (v) => {
      state.updateExperience(idx, { title: v });
    }));
    grid.appendChild(buildField('Start Date', exp.startDate, (v) => {
      state.updateExperience(idx, { startDate: v });
    }));
    grid.appendChild(buildField('End Date', exp.endDate, (v) => {
      state.updateExperience(idx, { endDate: v });
    }));

    card.appendChild(grid);

    // Narrative & Cultural Signals section
    card.appendChild(buildNarrativeSection(exp, idx));

    // Bullets list
    card.appendChild(buildBulletsList(exp, idx));

    // Ghost Rewrites summary per experience
    if (ghostMode && ghostSuggestions && ghostSuggestions.experiences) {
      const ghostExp = ghostSuggestions.experiences.find(e => e.expIdx === idx);
      if (ghostExp) {
        const changedCount = ghostExp.bullets.filter((b, bi) => b.changed && !appliedSuggestions.has(`bullet-${ghostExp.expIdx}-${bi}`)).length;
        if (changedCount > 0) {
          const ghostSummary = el('div', {
            style: {
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(128, 90, 213, 0.06)',
              border: '1px solid rgba(128, 90, 213, 0.2)',
              marginTop: '10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '8px',
            },
          });

          ghostSummary.appendChild(el('span', {
            textContent: `Ghost Rewrites (${changedCount} bullet${changedCount !== 1 ? 's' : ''})`,
            style: {
              fontSize: '13px',
              fontWeight: '700',
              color: 'rgba(128, 90, 213, 0.85)',
            },
          }));

          const acceptAllBtn = el('button', {
            className: 'btn-primary btn-sm',
            textContent: 'Accept All Rewrites',
            style: { marginTop: '0' },
            onClick: () => {
              ghostExp.bullets.forEach((b, bi) => {
                if (b.changed && !appliedSuggestions.has(`bullet-${idx}-${bi}`)) {
                  state.updateBullet(idx, bi, b.rewritten);
                  appliedSuggestions.add(`bullet-${idx}-${bi}`);
                }
              });
              renderContent();
            },
          });
          ghostSummary.appendChild(acceptAllBtn);

          card.appendChild(ghostSummary);
        }
      }
    }

    // Add Bullet button
    card.appendChild(el('button', {
      className: 'btn-secondary btn-sm',
      textContent: '+ Add Bullet',
      style: { marginTop: '10px' },
      onClick: () => {
        state.addBullet(idx);
        renderContent();
      },
    }));

    return card;
  }

  // -------------------------------------------------------------------------
  // Narrative & Cultural Signals
  // -------------------------------------------------------------------------

  function buildNarrativeSection(exp, expIdx) {
    const section = el('div', {
      style: {
        padding: '16px',
        borderRadius: '8px',
        background: 'rgba(128, 90, 213, 0.03)',
        border: '1px solid rgba(128, 90, 213, 0.1)',
        marginBottom: '16px',
      },
    });

    section.appendChild(el('h4', {
      textContent: 'Narrative & Cultural Signals',
      style: { margin: '0 0 12px 0', fontSize: '13px', fontWeight: '700', color: 'var(--text-muted)' },
    }));

    // Narrative Core textarea
    const narrativeLabel = el('label', {
      textContent: 'Narrative Core',
      style: { display: 'block', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '4px' },
    });
    section.appendChild(narrativeLabel);

    const narrativeTextarea = el('textarea', {
      style: {
        width: '100%',
        minHeight: '60px',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--bg-input, rgba(255,255,255,0.04))',
        color: 'var(--text-primary)',
        fontSize: '12px',
        lineHeight: '1.5',
        resize: 'vertical',
        fontFamily: 'inherit',
        marginBottom: '12px',
        boxSizing: 'border-box',
      },
    });
    narrativeTextarea.value = exp.narrativeCore || '';
    narrativeTextarea.addEventListener('input', () => {
      state.updateExperience(expIdx, { narrativeCore: narrativeTextarea.value });
    });
    section.appendChild(narrativeTextarea);

    // Soft Signals: 20 toggle buttons
    section.appendChild(el('label', {
      textContent: 'Soft Signals',
      style: { display: 'block', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' },
    }));

    const signalGrid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' } });

    const currentSignals = new Set(exp.softSignals || []);

    for (const signal of SOFT_SIGNAL_OPTIONS) {
      const isActive = currentSignals.has(signal);
      const btn = el('button', {
        textContent: signal,
        style: {
          padding: '4px 10px',
          borderRadius: '14px',
          fontSize: '11px',
          fontWeight: '500',
          border: '1px solid',
          borderColor: isActive ? 'var(--accent-teal)' : 'var(--border)',
          background: isActive ? 'rgba(123, 165, 165, 0.15)' : 'transparent',
          color: isActive ? 'var(--accent-teal)' : 'var(--text-body)',
          cursor: 'pointer',
          transition: 'all 0.15s ease',
        },
        onClick: () => {
          const signals = new Set(exp.softSignals || []);
          if (signals.has(signal)) {
            signals.delete(signal);
          } else {
            signals.add(signal);
          }
          state.updateExperience(expIdx, { softSignals: [...signals] });
          renderContent();
        },
      });
      signalGrid.appendChild(btn);
    }
    section.appendChild(signalGrid);

    // Evidence Links input
    section.appendChild(el('label', {
      textContent: 'Evidence Links',
      style: { display: 'block', fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '4px' },
    }));

    const evidenceInput = el('input', {
      type: 'text',
      placeholder: 'Add URLs to portfolios, case studies, or metrics dashboards',
      style: {
        width: '100%',
        padding: '8px 10px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--bg-input, rgba(255,255,255,0.04))',
        color: 'var(--text-primary)',
        fontSize: '12px',
        marginBottom: '12px',
        boxSizing: 'border-box',
      },
    });
    evidenceInput.value = (exp.evidenceLinks || []).join(', ');
    evidenceInput.addEventListener('change', () => {
      const links = evidenceInput.value.split(',').map((s) => s.trim()).filter(Boolean);
      state.updateExperience(expIdx, { evidenceLinks: links });
    });
    section.appendChild(evidenceInput);

    // Impact Score bar (auto-calculated)
    let impactScore = 0;
    try {
      impactScore = calculateImpactScore(exp.bullets || []);
    } catch (_) {
      impactScore = exp.impactScore || 0;
    }

    const scoreRow = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px' },
    });

    scoreRow.appendChild(el('span', {
      textContent: 'Impact Score',
      style: { fontSize: '11px', fontWeight: '600', color: 'var(--text-muted)' },
    }));

    const barBg = el('div', {
      style: {
        flex: '1',
        height: '8px',
        borderRadius: '4px',
        background: 'rgba(123, 165, 165, 0.1)',
        overflow: 'hidden',
      },
    });

    const barFill = el('div', {
      style: {
        width: `${Math.min(100, impactScore)}%`,
        height: '100%',
        borderRadius: '4px',
        background: impactScore >= 70
          ? 'linear-gradient(90deg, #48bb78, #38a169)'
          : impactScore >= 40
            ? 'linear-gradient(90deg, #ecc94b, #d69e2e)'
            : 'linear-gradient(90deg, #fc8181, #e53e3e)',
        transition: 'width 0.3s ease',
      },
    });
    barBg.appendChild(barFill);
    scoreRow.appendChild(barBg);

    scoreRow.appendChild(el('span', {
      textContent: `${impactScore}`,
      style: { fontSize: '12px', fontWeight: '700', minWidth: '28px', textAlign: 'right' },
    }));

    section.appendChild(scoreRow);

    return section;
  }

  // -------------------------------------------------------------------------
  // Bullets List
  // -------------------------------------------------------------------------

  function buildBulletsList(exp, expIdx) {
    const list = el('div');

    (exp.bullets || []).forEach((bullet, bulletIdx) => {
      const row = el('div', {
        style: {
          display: 'flex',
          gap: '8px',
          alignItems: 'flex-start',
          marginBottom: '8px',
        },
      });

      // Number
      row.appendChild(el('span', {
        textContent: `${bulletIdx + 1}.`,
        style: {
          fontSize: '12px',
          fontWeight: '600',
          color: 'var(--text-muted)',
          paddingTop: '10px',
          minWidth: '20px',
        },
      }));

      // Textarea
      const bulletArea = el('textarea', {
        style: {
          width: '100%',
          minHeight: '60px',
          padding: '10px 12px',
          borderRadius: '8px',
          border: '1.5px solid var(--border)',
          background: 'var(--bg-page)',
          color: 'var(--text-primary)',
          fontSize: '13px',
          lineHeight: '1.5',
          resize: 'vertical',
          fontFamily: 'inherit',
          boxSizing: 'border-box',
          transition: 'border-color 0.3s ease',
        },
      });
      bulletArea.value = bullet;

      // Linter container for this bullet
      const bulletLinter = el('div');

      const debouncedBulletLint = debounce((text) => {
        renderLinterPanel(bulletLinter, text, `bullet-${expIdx}-${bulletIdx}`, (fixed) => {
          bulletArea.value = fixed;
          state.updateBullet(expIdx, bulletIdx, fixed);
        });
      }, DEBOUNCE_MS);

      bulletArea.addEventListener('input', () => {
        state.updateBullet(expIdx, bulletIdx, bulletArea.value);
        debouncedBulletLint(bulletArea.value);
      });

      // Delete button
      const delBtn = el('button', {
        textContent: '\u00D7',
        style: {
          border: 'none',
          background: 'none',
          color: 'var(--text-muted)',
          fontSize: '18px',
          cursor: 'pointer',
          padding: '6px',
          lineHeight: '1',
          flexShrink: '0',
        },
        onClick: () => {
          const bullets = exp.bullets.filter((_, j) => j !== bulletIdx);
          state.updateExperience(expIdx, { bullets: bullets.length ? bullets : [''] });
          renderContent();
        },
      });

      const bulletColumn = el('div', { style: { flex: '1', minWidth: '0' } });
      bulletColumn.appendChild(bulletArea);
      bulletColumn.appendChild(bulletLinter);

      // Ghost mode per-bullet rewrite
      if (ghostMode && ghostSuggestions && ghostSuggestions.experiences) {
        const ghostExp = ghostSuggestions.experiences.find(e => e.expIdx === expIdx);
        const ghostBulletData = ghostExp && ghostExp.bullets && ghostExp.bullets[bulletIdx];
        if (ghostBulletData && ghostBulletData.changed && !appliedSuggestions.has(`bullet-${expIdx}-${bulletIdx}`)) {
          bulletColumn.appendChild(buildGhostBulletOverlay(ghostBulletData.rewritten, expIdx, bulletIdx, ghostBulletData.original));
        }
      }

      row.appendChild(bulletColumn);
      row.appendChild(delBtn);
      list.appendChild(row);

      // Initial lint
      if (bullet) {
        renderLinterPanel(bulletLinter, bullet, `bullet-${expIdx}-${bulletIdx}`, (fixed) => {
          bulletArea.value = fixed;
          state.updateBullet(expIdx, bulletIdx, fixed);
        });
      }
    });

    return list;
  }

  // -------------------------------------------------------------------------
  // Ghost mode overlays
  // -------------------------------------------------------------------------

  function buildGhostOverlay(text, onAccept, onMerge, onDismiss, originalText) {
    const overlay = el('div', {
      style: {
        padding: '14px 16px',
        borderRadius: '8px',
        background: 'rgba(128, 90, 213, 0.06)',
        border: '1px solid rgba(128, 90, 213, 0.2)',
        marginTop: '10px',
        position: 'relative',
      },
    });

    // Culture badge
    let cultureType = '';
    try {
      const culture = analyzeCompanyCulture(jobContext);
      cultureType = culture ? culture.type || '' : '';
    } catch (_) {
      // pass
    }

    if (cultureType) {
      overlay.appendChild(el('span', {
        textContent: cultureType,
        style: {
          position: 'absolute',
          top: '8px',
          right: '8px',
          fontSize: '10px',
          fontWeight: '600',
          padding: '2px 8px',
          borderRadius: '10px',
          background: 'rgba(128, 90, 213, 0.12)',
          color: 'rgba(128, 90, 213, 0.8)',
        },
      }));
    }

    // Show original text with strikethrough when provided
    if (originalText) {
      overlay.appendChild(el('p', {
        textContent: originalText,
        style: {
          margin: '0 0 6px 0',
          fontSize: '12px',
          lineHeight: '1.5',
          color: 'var(--text-muted)',
          textDecoration: 'line-through',
        },
      }));
    }

    overlay.appendChild(el('p', {
      textContent: text,
      style: {
        margin: '0 0 10px 0',
        fontSize: '13px',
        lineHeight: '1.55',
        color: 'rgba(128, 90, 213, 0.85)',
        fontStyle: 'italic',
      },
    }));

    const actions = el('div', { style: { display: 'flex', gap: '8px' } });

    actions.appendChild(el('button', {
      className: 'btn-primary btn-sm',
      textContent: 'Accept',
      onClick: onAccept,
    }));

    if (onMerge) {
      actions.appendChild(el('button', {
        className: 'btn-secondary btn-sm',
        textContent: 'Merge',
        onClick: onMerge,
      }));
    }

    actions.appendChild(el('button', {
      className: 'btn-secondary btn-sm',
      textContent: 'Dismiss',
      onClick: onDismiss,
    }));

    overlay.appendChild(actions);
    return overlay;
  }

  function buildGhostBulletOverlay(ghostText, expIdx, bulletIdx, originalText) {
    return buildGhostOverlay(
      ghostText,
      () => {
        state.updateBullet(expIdx, bulletIdx, ghostText);
        appliedSuggestions.add(`bullet-${expIdx}-${bulletIdx}`);
        renderContent();
      },
      null,
      () => {
        appliedSuggestions.add(`bullet-${expIdx}-${bulletIdx}`);
        renderContent();
      },
      originalText,
    );
  }

  // -------------------------------------------------------------------------
  // Bullet Tips Panel
  // -------------------------------------------------------------------------

  function buildBulletTipsPanel(industry, tips) {
    const panel = el('div', {
      className: 'glass',
      style: {
        padding: '14px 18px',
        marginTop: '16px',
        borderLeft: '3px solid rgba(123, 165, 165, 0.35)',
      },
    });

    panel.appendChild(el('h4', {
      textContent: `Bullet Tips: ${industry}`,
      style: { margin: '0 0 8px 0', fontSize: '13px', fontWeight: '700', color: 'var(--accent-teal)' },
    }));

    const list = el('ul', {
      style: { margin: '0', padding: '0 0 0 18px', fontSize: '12px', lineHeight: '1.7', color: 'var(--text-body)' },
    });

    for (const tip of tips) {
      list.appendChild(el('li', { textContent: tip }));
    }

    panel.appendChild(list);
    return panel;
  }

  // -------------------------------------------------------------------------
  // AI Experience Suggestions
  // -------------------------------------------------------------------------

  function buildAIExperienceSuggestions() {
    const wrapper = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginTop: '16px',
        borderLeft: '3px solid rgba(128, 90, 213, 0.4)',
      },
    });

    const headerRow = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' },
    });

    headerRow.appendChild(el('h4', {
      textContent: 'AI Experience Suggestions',
      style: { margin: '0', fontSize: '14px', fontWeight: '700' },
    }));

    const genBtn = el('button', {
      className: 'btn-secondary btn-sm',
      textContent: 'Refresh Suggestions',
      onClick: async () => {
        try {
          const suggestions = await generateAISuggestions(getData(), getJobContext(), { skipCache: true });
          _editorCache._aiSuggestions = suggestions;
          renderContent();
        } catch (_) {
          // pass
        }
      },
    });
    headerRow.appendChild(genBtn);
    wrapper.appendChild(headerRow);

    // Show cached AI experience suggestions if available
    const aiExp = _editorCache._aiSuggestions?.experience;
    if (aiExp && aiExp.length > 0) {
      // Flatten all suggestions from all experiences into a renderable list
      const flatSuggestions = [];
      for (const expEntry of aiExp) {
        for (const sug of (expEntry.suggestions || [])) {
          flatSuggestions.push({
            type: sug.type === 'rewrite' ? 'STRENGTHEN' : sug.type === 'gap' ? 'KEYWORD' : (sug.type || 'SUGGESTION').toUpperCase(),
            text: sug.text || '',
            bullet: sug.text || '',
            experienceIdx: expEntry.expIdx,
            original: sug.original || null,
          });
        }
      }
      renderAISuggestionResults(wrapper, flatSuggestions);
    } else {
      wrapper.appendChild(el('p', {
        textContent: _editorCache._aiLoaded ? 'Loading AI suggestions...' : 'Generate AI-powered suggestions to strengthen your experience bullets based on the target job description.',
        style: { fontSize: '12px', color: 'var(--text-muted)', margin: '0', fontStyle: 'italic' },
      }));
    }

    return wrapper;
  }

  function renderAISuggestionResults(container, suggestions) {
    // Remove old results
    const old = container.querySelector('.ai-suggestions-results');
    if (old) old.remove();

    if (!suggestions || !suggestions.length) return;

    const results = el('div', { className: 'ai-suggestions-results', style: { marginTop: '12px' } });

    for (const sug of suggestions) {
      const card = el('div', {
        style: {
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'rgba(128, 90, 213, 0.04)',
          border: '1px solid rgba(128, 90, 213, 0.12)',
          marginBottom: '8px',
        },
      });

      // Type badge
      const typeBadge = el('span', {
        textContent: sug.type || 'SUGGESTION',
        style: {
          fontSize: '9px',
          fontWeight: '700',
          padding: '2px 6px',
          borderRadius: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          marginRight: '8px',
          color: '#fff',
          background: sug.type === 'KEYWORD' ? '#4299e1'
            : sug.type === 'STRENGTHEN' ? '#48bb78'
              : sug.type === 'QUANTIFY' ? '#ed8936'
                : '#9b8ec4',
        },
      });
      card.appendChild(typeBadge);

      card.appendChild(el('span', {
        textContent: sug.text || sug.bullet || '',
        style: { fontSize: '13px', lineHeight: '1.5' },
      }));

      const actionRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } });

      if (sug.bullet) {
        actionRow.appendChild(el('button', {
          className: 'btn-primary btn-sm',
          textContent: 'Add Bullet',
          onClick: () => {
            const targetIdx = sug.experienceIdx || 0;
            if (data.experiences[targetIdx]) {
              const exp = data.experiences[targetIdx];
              const bullets = [...exp.bullets, sug.bullet];
              state.updateExperience(targetIdx, { bullets });
            }
            card.remove();
          },
        }));
      }

      actionRow.appendChild(el('button', {
        className: 'btn-secondary btn-sm',
        textContent: 'Dismiss',
        onClick: () => card.remove(),
      }));

      card.appendChild(actionRow);
      results.appendChild(card);
    }

    container.appendChild(results);
  }

  // =========================================================================
  // TAB: Education
  // =========================================================================

  function buildEducationTab() {
    const section = el('div');

    // Add Education button
    section.appendChild(el('button', {
      className: 'btn-primary btn-sm',
      textContent: '+ Add Education',
      style: { marginBottom: '16px' },
      onClick: () => {
        state.addEducation();
        renderContent();
      },
    }));

    // Per education card
    data.education.forEach((edu, idx) => {
      const card = el('div', {
        className: 'glass',
        style: { padding: '20px', marginBottom: '16px' },
      });

      // Institution
      card.appendChild(buildField('Institution', edu.school, (v) => {
        state.updateEducation(idx, { school: v });
      }));

      // 3-column grid: Degree, Field of Study, Year
      const grid3 = el('div', {
        style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginTop: '14px' },
      });

      grid3.appendChild(buildField('Degree', edu.degree, (v) => {
        state.updateEducation(idx, { degree: v });
      }));
      grid3.appendChild(buildField('Field of Study', edu.field, (v) => {
        state.updateEducation(idx, { field: v });
      }));
      grid3.appendChild(buildField('Year', edu.year, (v) => {
        state.updateEducation(idx, { year: v });
      }));

      card.appendChild(grid3);

      // Remove button
      if (data.education.length > 1) {
        card.appendChild(el('button', {
          className: 'btn-danger btn-sm',
          textContent: 'Remove',
          style: { marginTop: '12px' },
          onClick: () => {
            const education = data.education.filter((_, i) => i !== idx);
            state.updateData({ education: education.length ? education : [{ school: '', degree: '', field: '', year: '' }] });
            renderContent();
          },
        }));
      }

      section.appendChild(card);
    });

    return section;
  }

  // =========================================================================
  // TAB: Skills
  // =========================================================================

  function buildSkillsTab() {
    const section = el('div');

    // Tag cloud of current skills
    const tagCloud = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' },
    });

    for (const skill of data.skills) {
      const tag = el('span', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '5px 10px',
          borderRadius: '14px',
          fontSize: '12px',
          fontWeight: '500',
          background: 'rgba(123, 165, 165, 0.1)',
          color: 'var(--accent-teal)',
          border: '1px solid rgba(123, 165, 165, 0.2)',
        },
      });

      tag.appendChild(el('span', { textContent: skill }));

      const removeBtn = el('button', {
        textContent: '\u00D7',
        style: {
          border: 'none',
          background: 'none',
          color: 'var(--accent-teal)',
          fontSize: '14px',
          cursor: 'pointer',
          padding: '0',
          lineHeight: '1',
        },
        onClick: () => {
          state.removeSkill(skill);
          renderContent();
        },
      });
      tag.appendChild(removeBtn);
      tagCloud.appendChild(tag);
    }

    if (data.skills.length === 0) {
      tagCloud.appendChild(el('span', {
        textContent: 'No skills added yet',
        style: { fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' },
      }));
    }

    section.appendChild(tagCloud);

    // Add skill input + button
    const addRow = el('div', {
      style: { display: 'flex', gap: '8px', marginBottom: '20px' },
    });

    const skillInput = el('input', {
      type: 'text',
      placeholder: 'Add a skill...',
      style: {
        flex: '1',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--bg-input, rgba(255,255,255,0.04))',
        color: 'var(--text-primary)',
        fontSize: '13px',
      },
    });
    skillInput.value = newSkill;

    skillInput.addEventListener('input', () => {
      newSkill = skillInput.value;
    });

    const addSkillAction = () => {
      const trimmed = skillInput.value.trim();
      if (trimmed) {
        state.addSkill(trimmed);
        newSkill = '';
        skillInput.value = '';
        renderContent();
      }
    };

    skillInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSkillAction();
      }
    });

    addRow.appendChild(skillInput);
    addRow.appendChild(el('button', {
      className: 'btn-primary btn-sm',
      textContent: 'Add',
      onClick: addSkillAction,
    }));

    section.appendChild(addRow);

    // AI JD-Matched Skills (when jobContext exists)
    if (hasJob && getJobContext().fitData && getJobContext().fitData.missingSkills && getJobContext().fitData.missingSkills.length) {
      section.appendChild(buildJDMatchedSkills());
    }

    // AI-suggested skills from cached suggestions
    const aiSkills = _editorCache._aiSuggestions?.skills;
    if (hasJob && aiSkills && aiSkills.length > 0) {
      section.appendChild(buildAISuggestedSkills(aiSkills));
    }

    // Industry Suggested Skills
    if (detectedIndustries.length > 0) {
      const primaryIndustry = detectedIndustries[0];
      const keywords = INDUSTRY_KEYWORDS[primaryIndustry];
      if (keywords) {
        section.appendChild(buildIndustrySuggestedSkills(primaryIndustry, keywords));
      }
    }

    return section;
  }

  function buildJDMatchedSkills() {
    const missingSkills = jobContext.fitData.missingSkills;

    const wrapper = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginBottom: '16px',
        borderLeft: '3px solid rgba(128, 90, 213, 0.4)',
      },
    });

    wrapper.appendChild(el('h4', {
      textContent: 'AI JD-Matched Skills',
      style: { margin: '0 0 6px 0', fontSize: '14px', fontWeight: '700' },
    }));

    wrapper.appendChild(el('p', {
      textContent: 'Skills from the job description not found in your resume. Only add skills you actually have.',
      style: { fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', fontStyle: 'italic' },
    }));

    const skillGrid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });

    for (const skill of missingSkills) {
      const alreadyHas = data.skills.map((s) => s.toLowerCase()).includes(skill.toLowerCase());
      if (alreadyHas) continue;

      const tag = el('button', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 10px',
          borderRadius: '14px',
          fontSize: '11px',
          fontWeight: '500',
          border: '1px solid rgba(128, 90, 213, 0.25)',
          background: 'rgba(128, 90, 213, 0.06)',
          color: 'var(--text-body)',
          cursor: 'pointer',
        },
        onClick: () => {
          state.addSkill(skill);
          renderContent();
        },
      });
      tag.appendChild(el('span', { textContent: '+' }));
      tag.appendChild(el('span', { textContent: skill }));
      skillGrid.appendChild(tag);
    }

    wrapper.appendChild(skillGrid);
    return wrapper;
  }

  function buildAISuggestedSkills(aiSkills) {
    const wrapper = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        marginBottom: '16px',
        borderLeft: '3px solid rgba(128, 90, 213, 0.4)',
      },
    });

    wrapper.appendChild(el('h4', {
      textContent: 'AI Suggested Skills',
      style: { margin: '0 0 6px 0', fontSize: '14px', fontWeight: '700' },
    }));

    wrapper.appendChild(el('p', {
      textContent: 'Skills identified from the job description by AI analysis. Only add skills you actually have.',
      style: { fontSize: '11px', color: 'var(--text-muted)', margin: '0 0 10px 0', fontStyle: 'italic' },
    }));

    const skillGrid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });

    for (const item of aiSkills) {
      const skillName = item.skill || item;
      const alreadyHas = getData().skills.map((s) => s.toLowerCase()).includes(String(skillName).toLowerCase());
      if (alreadyHas) continue;

      const tag = el('button', {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          padding: '4px 10px',
          borderRadius: '14px',
          fontSize: '11px',
          fontWeight: '500',
          border: '1px solid rgba(128, 90, 213, 0.25)',
          background: 'rgba(128, 90, 213, 0.06)',
          color: 'var(--text-body)',
          cursor: 'pointer',
        },
        onClick: () => {
          state.addSkill(String(skillName));
          renderContent();
        },
      });
      tag.appendChild(el('span', { textContent: '+' }));
      tag.appendChild(el('span', { textContent: String(skillName) }));

      // Show reason as tooltip if available
      if (item.reason) {
        tag.title = item.reason;
      }

      skillGrid.appendChild(tag);
    }

    // If all AI skills are already added, show a check message
    if (skillGrid.children.length === 0) {
      wrapper.appendChild(el('p', {
        textContent: 'All AI-suggested skills have been added to your resume.',
        style: { fontSize: '12px', color: '#48bb78', margin: '0', fontStyle: 'italic' },
      }));
    } else {
      wrapper.appendChild(skillGrid);
    }

    return wrapper;
  }

  function buildIndustrySuggestedSkills(industry, keywords) {
    const wrapper = el('div', {
      className: 'glass',
      style: {
        padding: '16px 20px',
        borderLeft: '3px solid rgba(123, 165, 165, 0.35)',
      },
    });

    wrapper.appendChild(el('h4', {
      textContent: `Industry Skills: ${industry}`,
      style: { margin: '0 0 10px 0', fontSize: '13px', fontWeight: '700', color: 'var(--accent-teal)' },
    }));

    const grid = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });

    for (const kw of keywords) {
      const has = data.skills.map((s) => s.toLowerCase()).includes(kw.toLowerCase());

      const tag = el('button', {
        style: {
          padding: '4px 10px',
          borderRadius: '14px',
          fontSize: '11px',
          fontWeight: '500',
          border: '1px solid',
          borderColor: has ? 'rgba(72, 187, 120, 0.3)' : 'rgba(123, 165, 165, 0.2)',
          background: has ? 'rgba(72, 187, 120, 0.08)' : 'rgba(123, 165, 165, 0.05)',
          color: has ? '#48bb78' : 'var(--text-body)',
          cursor: has ? 'default' : 'pointer',
        },
        onClick: () => {
          if (!has) {
            state.addSkill(kw);
            renderContent();
          }
        },
      });

      if (has) {
        tag.appendChild(el('span', { textContent: '\u2713 ', style: { marginRight: '2px' } }));
      }
      tag.appendChild(el('span', { textContent: kw }));
      grid.appendChild(tag);
    }

    wrapper.appendChild(grid);
    return wrapper;
  }

  // =========================================================================
  // TAB: Training & Certifications
  // =========================================================================

  function buildTrainingTab() {
    const section = el('div');

    // Certifications textarea with linter
    const label = el('label', {
      textContent: 'Certifications & Training',
      style: { display: 'block', fontSize: '12px', fontWeight: '600', color: 'var(--text-muted)', marginBottom: '6px' },
    });
    section.appendChild(label);

    const textarea = el('textarea', {
      style: {
        width: '100%',
        minHeight: '120px',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        background: 'var(--bg-input, rgba(255,255,255,0.04))',
        color: 'var(--text-primary)',
        fontSize: '13px',
        lineHeight: '1.55',
        resize: 'vertical',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
    });
    textarea.value = data.certifications || '';

    const linterContainer = el('div');

    const debouncedCertLint = debounce((text) => {
      renderLinterPanel(linterContainer, text, 'certifications', (fixed) => {
        textarea.value = fixed;
        state.updateData({ certifications: fixed });
      });
    }, DEBOUNCE_MS);

    textarea.addEventListener('input', () => {
      state.updateData({ certifications: textarea.value });
      debouncedCertLint(textarea.value);
    });

    section.appendChild(textarea);
    section.appendChild(linterContainer);

    // Initial lint
    if (data.certifications) {
      renderLinterPanel(linterContainer, data.certifications, 'certifications', (fixed) => {
        textarea.value = fixed;
        state.updateData({ certifications: fixed });
      });
    }

    // Recommended Certifications per detected industry
    if (detectedIndustries.length > 0) {
      for (const industry of detectedIndustries) {
        const certs = RECOMMENDED_CERTS[industry];
        if (!certs) continue;

        const panel = el('div', {
          className: 'glass',
          style: {
            padding: '16px 20px',
            marginTop: '16px',
            borderLeft: '3px solid rgba(123, 165, 165, 0.35)',
          },
        });

        panel.appendChild(el('h4', {
          textContent: `Recommended: ${industry}`,
          style: { margin: '0 0 10px 0', fontSize: '13px', fontWeight: '700', color: 'var(--accent-teal)' },
        }));

        const certList = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
        const currentCerts = (data.certifications || '').toLowerCase();

        for (const cert of certs) {
          const alreadyAdded = currentCerts.includes(cert.toLowerCase());

          const row = el('div', {
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              borderRadius: '6px',
              background: alreadyAdded ? 'rgba(72, 187, 120, 0.05)' : 'transparent',
              border: '1px solid',
              borderColor: alreadyAdded ? 'rgba(72, 187, 120, 0.2)' : 'var(--border)',
            },
          });

          row.appendChild(el('span', {
            textContent: cert,
            style: {
              fontSize: '12px',
              color: alreadyAdded ? '#48bb78' : 'var(--text-body)',
              fontWeight: alreadyAdded ? '600' : '400',
            },
          }));

          if (alreadyAdded) {
            row.appendChild(el('span', {
              textContent: '\u2713',
              style: { color: '#48bb78', fontWeight: '700', fontSize: '14px' },
            }));
          } else {
            row.appendChild(el('button', {
              className: 'btn-secondary btn-sm',
              textContent: 'Add',
              onClick: () => {
                const current = data.certifications || '';
                const updated = current ? current + '\n' + cert : cert;
                state.updateData({ certifications: updated });
                textarea.value = updated;
                renderContent();
              },
            }));
          }

          certList.appendChild(row);
        }

        panel.appendChild(certList);
        section.appendChild(panel);
      }
    }

    return section;
  }

  // =========================================================================
  // Shared helpers
  // =========================================================================

  function buildField(label, value, onChange, type = 'text') {
    const group = el('div');

    group.appendChild(el('label', {
      textContent: label,
      style: {
        display: 'block',
        fontSize: '11px',
        fontWeight: '600',
        color: 'var(--text-muted)',
        marginBottom: '4px',
        textTransform: 'uppercase',
        letterSpacing: '0.3px',
      },
    }));

    const input = el('input', {
      type,
      style: {
        width: '100%',
        padding: '10px 12px',
        borderRadius: '8px',
        border: '1.5px solid var(--border)',
        background: 'var(--bg-page)',
        color: 'var(--text-primary)',
        fontSize: '13px',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
        transition: 'border-color 0.3s ease',
      },
    });
    input.value = value || '';
    input.addEventListener('input', () => onChange(input.value));

    group.appendChild(input);
    return group;
  }

  // -------------------------------------------------------------------------
  // Navigation footer
  // -------------------------------------------------------------------------

  function buildNavFooter() {
    const footer = el('div', {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        marginTop: '32px',
        paddingTop: '20px',
        borderTop: '1px solid var(--border)',
      },
    });

    footer.appendChild(el('button', {
      className: 'btn-secondary',
      textContent: 'Back to Home',
      onClick: () => state.setPage('home'),
    }));

    footer.appendChild(el('button', {
      className: 'btn-primary',
      textContent: 'Choose Template',
      onClick: () => state.setPage('templates'),
    }));

    return footer;
  }
}
