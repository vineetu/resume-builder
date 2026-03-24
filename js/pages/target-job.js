/**
 * Target Job page — Step wizard with job fetching, fit analysis,
 * action plan, tailor/stand-out panels, and gap-bridge simulator.
 *
 * @module pages/target-job
 */

import {
  analyzeJobFit,
  analyzeCompanyCulture,
  fetchJobUrl,
  extractJDInfo,
  calculateRoleVelocity,
  findPivot,
  extractMetrics,
} from '../analyzer.js';

import {
  tailorResume,
  generateStandOutSuggestions,
} from '../ai-engine.js';

import { LEARNING_PATHS } from '../constants.js';
import { showProgress, hideProgress } from '../progress.js';

// ── DOM helpers ─────────────────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') { node.textContent = v; continue; }
    if (k === 'html') { node.innerHTML = v; continue; }
    if (k === 'className') { node.className = v; continue; }
    if (k === 'style' && typeof v === 'object') {
      Object.assign(node.style, v);
      continue;
    }
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
      continue;
    }
    node.setAttribute(k, v);
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    if (typeof child === 'string') { node.appendChild(document.createTextNode(child)); continue; }
    node.appendChild(child);
  }
  return node;
}

function tag(text, color, bg) {
  return el('span', {
    text,
    className: 'tag',
    style: {
      display: 'inline-block',
      fontSize: '11px',
      fontWeight: '600',
      padding: '3px 10px',
      borderRadius: '12px',
      color: color || 'var(--text-primary)',
      background: bg || 'rgba(123,165,165,0.12)',
      margin: '2px 4px 2px 0',
    },
  });
}

function sectionTitle(text) {
  return el('h3', {
    text,
    style: {
      fontSize: '15px',
      fontWeight: '700',
      color: 'var(--text-primary)',
      margin: '20px 0 10px',
    },
  });
}

function card(children = [], extra = {}) {
  return el('div', {
    className: 'glass',
    style: { padding: '20px 24px', marginBottom: '16px', ...extra },
  }, children);
}

function btnPrimary(label, onClick, extraStyle = {}) {
  return el('button', {
    text: label,
    className: 'btn-primary',
    onClick,
    style: extraStyle,
  });
}

function btnSecondary(label, onClick, extraStyle = {}) {
  return el('button', {
    text: label,
    className: 'btn-secondary',
    onClick,
    style: extraStyle,
  });
}

function requirementItem(text, met) {
  const icon = met ? '\u2713' : '\u2717';
  const color = met ? 'var(--accent-green, #22c55e)' : 'var(--accent-rose, #e8708a)';
  return el('div', {
    style: { display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px', fontSize: '13px' },
  }, [
    el('span', { text: icon, style: { color, fontWeight: '700', flexShrink: '0' } }),
    el('span', { text, style: { color: 'var(--text-body)' } }),
  ]);
}

// ── Progress Step Bar ───────────────────────────────────────────────────

function renderProgressSteps(currentStep) {
  const labels = ['Job Posting', 'Analyzing', 'Fit Analysis', 'Action Plan'];
  const bar = el('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '0',
      marginBottom: '28px',
    },
  });

  labels.forEach((label, i) => {
    const active = i <= currentStep;
    const circle = el('div', {
      text: String(i + 1),
      style: {
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        fontWeight: '700',
        background: active
          ? 'linear-gradient(135deg, var(--accent-teal, #7ba5a5), #8fb8c9)'
          : 'rgba(123,165,165,0.12)',
        color: active ? '#fff' : 'var(--text-muted)',
        flexShrink: '0',
      },
    });

    const stepLabel = el('span', {
      text: label,
      style: {
        fontSize: '11px',
        color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        fontWeight: active ? '600' : '400',
        textAlign: 'center',
        marginTop: '6px',
      },
    });

    const stepGroup = el('div', {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        minWidth: '72px',
      },
    }, [circle, stepLabel]);

    bar.appendChild(stepGroup);

    // Connector line between steps
    if (i < labels.length - 1) {
      const connector = el('div', {
        style: {
          flex: '1',
          height: '2px',
          minWidth: '24px',
          maxWidth: '48px',
          background: i < currentStep
            ? 'var(--accent-teal, #7ba5a5)'
            : 'rgba(123,165,165,0.2)',
          marginBottom: '20px',
        },
      });
      bar.appendChild(connector);
    }
  });

  return bar;
}

// ── Fit score color ─────────────────────────────────────────────────────

function fitColor(score) {
  if (score >= 80) return 'var(--accent-green, #22c55e)';
  if (score >= 60) return 'var(--accent-teal, #7ba5a5)';
  if (score >= 40) return '#eab308';
  return 'var(--accent-rose, #e8708a)';
}

function verdictInfo(score) {
  if (score >= 80) return { icon: '\uD83D\uDFE2', label: 'Strong Candidate', color: 'var(--accent-green, #22c55e)' };
  if (score >= 60) return { icon: '\uD83D\uDFE1', label: 'Competitive', color: '#eab308' };
  if (score >= 40) return { icon: '\uD83D\uDFE0', label: 'Needs Positioning', color: '#f97316' };
  return { icon: '\uD83D\uDD34', label: 'Significant Gaps', color: 'var(--accent-rose, #e8708a)' };
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN RENDER
// ═══════════════════════════════════════════════════════════════════════

// Module-level state cache — persists across re-renders triggered by global state changes
let _localCache = {
  step: 0, fitData: null, inputMode: 'url', targetFit: 75, fetchStatus: 'idle',
  jdText: '', jdInfo: null, cultureProfile: null, tailorResult: null,
  standOutResult: null, tailorApplied: false, showMatchDetails: false,
  showTailorPanel: false, showStandOutPanel: false, showGapBridge: false,
  roleVelocity: null, _inited: false,
};

// Export reset function for clearing cache
export function resetTargetJobCache() {
  Object.assign(_localCache, {
    step: 0, fitData: null, inputMode: 'url', targetFit: 75, fetchStatus: 'idle',
    jdText: '', jdInfo: null, cultureProfile: null, tailorResult: null,
    standOutResult: null, tailorApplied: false, showMatchDetails: false,
    showTailorPanel: false, showStandOutPanel: false, showGapBridge: false,
    roleVelocity: null, _inited: false,
  });
}

// Expose reset function on window for app.js clearAll()
window.resetTargetJobCache = resetTargetJobCache;

export function renderTargetJob(container, state) {
  container.innerHTML = '';

  // ── Local state — restore from cache or initialize ────────────────────
  let step = _localCache.step;
  let fitData = _localCache.fitData;
  let inputMode = _localCache.inputMode;
  let targetFit = _localCache.targetFit;
  let fetchStatus = _localCache.fetchStatus;
  let jdText = _localCache._inited ? _localCache.jdText : (state.jobContext.jdText || '');
  let jdInfo = _localCache._inited ? _localCache.jdInfo : (state.jobContext.jdInfo || null);
  let cultureProfile = _localCache.cultureProfile;
  let tailorResult = _localCache.tailorResult;
  let standOutResult = _localCache.standOutResult;
  let tailorApplied = _localCache.tailorApplied;
  let showMatchDetails = _localCache.showMatchDetails === undefined ? true : _localCache.showMatchDetails;
  let showTailorPanel = _localCache.showTailorPanel;
  let showStandOutPanel = _localCache.showStandOutPanel;
  let showGapBridge = _localCache.showGapBridge === undefined ? true : _localCache.showGapBridge;
  let tailorLoading = false;
  let standOutLoading = false;
  let roleVelocity = _localCache.roleVelocity;

  // Restore previous fit data if available and not already set
  if (!fitData && state.jobContext.fitData) {
    fitData = state.jobContext.fitData;
    step = 2;
  }

  _localCache._inited = true;

  // Save local state back to cache whenever it changes
  function syncCache() {
    Object.assign(_localCache, {
      step, fitData, inputMode, targetFit, fetchStatus, jdText, jdInfo,
      cultureProfile, tailorResult, standOutResult, tailorApplied,
      showMatchDetails, showTailorPanel, showStandOutPanel, showGapBridge, roleVelocity,
    });
  }

  const page = el('div', {
    className: 'page',
    style: { maxWidth: '900px', margin: '0 auto', padding: '24px 16px' },
  });

  // ── Re-render ────────────────────────────────────────────────────────

  function rerender() {
    syncCache();
    page.innerHTML = '';
    page.appendChild(renderProgressSteps(step >= 2 ? 3 : step));

    if (step === 0) renderStepInput(page);
    else if (step === 1) renderStepAnalyzing(page);
    else if (step === 2) renderStepResults(page);
  }

  // ════════════════════════════════════════════════════════════════════
  //  STEP 0: Job Posting Input
  // ════════════════════════════════════════════════════════════════════

  function renderStepInput(parent) {
    const section = card();

    // Title
    section.appendChild(el('h2', {
      text: 'Target a Job Posting',
      style: {
        fontSize: '20px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        marginBottom: '16px',
      },
    }));

    // Input mode toggle
    const toggle = el('div', {
      style: { display: 'flex', gap: '8px', marginBottom: '16px' },
    });

    const urlBtn = el('button', {
      text: 'Paste Job URL',
      className: inputMode === 'url' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm',
      onClick: () => { inputMode = 'url'; rerender(); },
    });

    const textBtn = el('button', {
      text: 'Paste Job Description',
      className: inputMode === 'text' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm',
      onClick: () => { inputMode = 'text'; rerender(); },
    });

    toggle.appendChild(urlBtn);
    toggle.appendChild(textBtn);
    section.appendChild(toggle);

    // URL mode
    if (inputMode === 'url') {
      const urlRow = el('div', {
        style: { display: 'flex', gap: '8px', marginBottom: '12px' },
      });

      const urlInput = el('input', {
        type: 'url',
        placeholder: 'https://jobs.example.com/posting/...',
        value: '',
        className: 'glass-input',
        style: { flex: '1' },
      });

      const fetchBtn = btnPrimary('Fetch JD', async () => {
        const url = urlInput.value.trim();
        if (!url) return;
        fetchStatus = 'fetching';
        rerender();

        try {
          const result = await fetchJobUrl(url);
          if (result && result.text) {
            jdText = result.text;
            fetchStatus = 'success';
          } else {
            fetchStatus = 'failed';
          }
        } catch {
          fetchStatus = 'failed';
        }
        rerender();
      }, { flexShrink: '0' });

      urlRow.appendChild(urlInput);
      urlRow.appendChild(fetchBtn);
      section.appendChild(urlRow);

      // Fetch status messages
      if (fetchStatus === 'fetching') {
        section.appendChild(el('p', {
          text: 'Fetching job description...',
          style: { fontSize: '13px', color: 'var(--accent-teal)', marginBottom: '12px' },
        }));
      } else if (fetchStatus === 'success') {
        section.appendChild(el('p', {
          text: 'Job description fetched successfully.',
          style: { fontSize: '13px', color: 'var(--accent-green, #22c55e)', marginBottom: '12px' },
        }));
      } else if (fetchStatus === 'failed') {
        const failMsg = el('div', {
          style: {
            padding: '16px',
            background: 'rgba(251,191,36,0.08)',
            border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: '8px',
            marginBottom: '16px',
          },
        });
        failMsg.appendChild(el('div', {
          text: "Can't fetch automatically? Here's how to add it manually:",
          style: { fontSize: '13px', fontWeight: '700', color: '#d4bc7e', marginBottom: '10px' },
        }));
        const steps = [
          '1. Open the job posting in your browser',
          '2. Select all the text (Ctrl+A / Cmd+A)',
          '3. Copy it (Ctrl+C / Cmd+C)',
          '4. Paste it in the text area below',
        ];
        steps.forEach(step => {
          failMsg.appendChild(el('div', {
            text: step,
            style: { fontSize: '12px', color: '#475569', lineHeight: '1.7', marginBottom: '2px' },
          }));
        });
        failMsg.appendChild(btnSecondary('Switch to Paste Mode', () => {
          inputMode = 'text';
          fetchStatus = 'idle';
          rerender();
        }, { fontSize: '12px', marginTop: '12px' }));
        section.appendChild(failMsg);
      }
    }

    // Text area (always shown — pre-filled if URL fetch succeeded)
    const textarea = el('textarea', {
      placeholder: 'Paste the full job description here...',
      className: 'glass-input',
      rows: '12',
      style: { width: '100%', resize: 'vertical', marginBottom: '16px', fontFamily: 'inherit' },
    });
    textarea.value = jdText;
    textarea.addEventListener('input', (e) => { jdText = e.target.value; });
    section.appendChild(textarea);

    // Warning if no resume data
    if (!state.hasResumeData()) {
      section.appendChild(el('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(234,179,8,0.1)',
          border: '1px solid rgba(234,179,8,0.3)',
          marginBottom: '16px',
          fontSize: '13px',
          color: '#eab308',
        },
      }, [
        el('span', { text: '\u26A0\uFE0F', style: { flexShrink: '0' } }),
        el('span', { text: 'Import your resume first for a more accurate fit analysis.' }),
      ]));
    }

    // Analyze button
    section.appendChild(btnPrimary('Analyze My Resume Fit', () => {
      if (!jdText.trim()) return;
      startAnalysis();
    }, { width: '100%' }));

    parent.appendChild(section);
  }

  // ════════════════════════════════════════════════════════════════════
  //  STEP 1: Analyzing Animation
  // ════════════════════════════════════════════════════════════════════

  function renderStepAnalyzing(parent) {
    const section = card([], { textAlign: 'center', padding: '48px 24px' });

    section.appendChild(el('div', {
      text: '\uD83D\uDD0D',
      style: { fontSize: '48px', marginBottom: '16px' },
    }));

    section.appendChild(el('h2', {
      text: 'Analyzing Job Posting',
      style: {
        fontSize: '18px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        marginBottom: '20px',
      },
    }));

    // Progress bar
    const barOuter = el('div', {
      style: {
        width: '100%',
        maxWidth: '320px',
        height: '8px',
        borderRadius: '4px',
        background: 'rgba(123,165,165,0.15)',
        margin: '0 auto',
        overflow: 'hidden',
      },
    });

    const barInner = el('div', {
      style: {
        width: '65%',
        height: '100%',
        borderRadius: '4px',
        background: 'linear-gradient(90deg, var(--accent-teal, #7ba5a5), #8fb8c9)',
        transition: 'width 0.6s ease',
      },
    });

    barOuter.appendChild(barInner);
    section.appendChild(barOuter);

    parent.appendChild(section);
  }

  // ── Start analysis pipeline ──────────────────────────────────────────

  async function startAnalysis() {
    step = 1;
    rerender();
    showProgress('Extracting job details');
    showProgress('Analyzing job fit');
    showProgress('Analyzing company culture');

    try {
      // Run analysis in parallel where possible
      const [jdInfoResult, fitResult, cultureResult] = await Promise.all([
        Promise.resolve(extractJDInfo(jdText)).finally(() => hideProgress('Extracting job details')),
        Promise.resolve(analyzeJobFit(state.data, jdText)).finally(() => hideProgress('Analyzing job fit')),
        Promise.resolve(analyzeCompanyCulture(jdText)).finally(() => hideProgress('Analyzing company culture')),
      ]);

      jdInfo = jdInfoResult;
      fitData = fitResult;
      cultureProfile = cultureResult;

      // Calculate role velocity
      roleVelocity = calculateRoleVelocity(state.data.experiences || []);

      // Persist to state
      state.setJobContext({ jdText, jdInfo, fitData });
    } catch (err) {
      console.error('[target-job] Analysis failed:', err);
      hideProgress('Extracting job details');
      hideProgress('Analyzing job fit');
      hideProgress('Analyzing company culture');
    }

    // Animation hold — at least 1.8s on analyzing screen
    await new Promise((resolve) => setTimeout(resolve, 1800));

    step = 2;
    rerender();
  }

  // ════════════════════════════════════════════════════════════════════
  //  STEP 2: Fit Analysis Results
  // ════════════════════════════════════════════════════════════════════

  function renderStepResults(parent) {
    if (!fitData) {
      parent.appendChild(card([
        el('p', { text: 'Analysis could not be completed. Please try again.', style: { color: 'var(--text-muted)' } }),
        btnSecondary('Try Again', () => { step = 0; rerender(); }),
      ]));
      return;
    }

    // Compute fit score
    const fitScore = computeFitScore(fitData);
    // Extract metrics from user's resume text (not fitData object)
    const allBulletText = (state.data.experiences || []).flatMap(e => (e.bullets || [])).join(' ');
    const metricsData = extractMetrics(`${state.data.summary || ''} ${allBulletText}`);

    // ── Re-analyze Button ─────────────────────────────────────────────
    const reanalyzeRow = el('div', {
      style: { display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' },
    });

    reanalyzeRow.appendChild(btnSecondary('Re-analyze', async () => {
      step = 1;
      rerender();
      showProgress('Extracting job details');
      showProgress('Analyzing job fit');
      showProgress('Analyzing company culture');

      try {
        const [jdInfoResult, fitResult, cultureResult] = await Promise.all([
          Promise.resolve(extractJDInfo(jdText)).finally(() => hideProgress('Extracting job details')),
          Promise.resolve(analyzeJobFit(state.data, jdText, true, { skipCache: true })).finally(() => hideProgress('Analyzing job fit')),
          Promise.resolve(analyzeCompanyCulture(jdText)).finally(() => hideProgress('Analyzing company culture')),
        ]);

        jdInfo = jdInfoResult;
        fitData = fitResult;
        cultureProfile = cultureResult;
        roleVelocity = calculateRoleVelocity(state.data.experiences || []);
        tailorResult = null;
        standOutResult = null;
        tailorApplied = false;

        state.setJobContext({ jdText, jdInfo, fitData });
      } catch (err) {
        console.error('[target-job] Re-analysis failed:', err);
        hideProgress('Extracting job details');
        hideProgress('Analyzing job fit');
        hideProgress('Analyzing company culture');
      }

      await new Promise((resolve) => setTimeout(resolve, 1800));

      step = 2;
      rerender();
    }, { fontSize: '12px' }));

    parent.appendChild(reanalyzeRow);

    // ── Score Header with Slider ───────────────────────────────────────
    renderScoreHeader(parent, fitScore);

    // ── Company Culture Vibe ───────────────────────────────────────────
    renderCultureVibe(parent);

    // ── HR Expert Verdict ──────────────────────────────────────────────
    renderVerdict(parent, fitScore);

    // ── What the Job Wants vs What You Bring ───────────────────────────
    renderComparison(parent, fitScore);

    // ── Action Plan ────────────────────────────────────────────────────
    renderActionPlan(parent);

    // ── Action Buttons (3-column) ──────────────────────────────────────
    renderActionButtons(parent);

    // ── Expandable Panels ──────────────────────────────────────────────
    if (showMatchDetails) renderMatchDetailsPanel(parent);
    if (showTailorPanel) renderTailorPanel(parent);
    if (showStandOutPanel) renderStandOutPanel(parent);
    if (showGapBridge) renderGapBridgeSimulator(parent);

    // ── Navigation ─────────────────────────────────────────────────────
    renderNavigation(parent);
  }

  // ── Compute fit score from analysis data ─────────────────────────────

  function computeFitScore(fd) {
    if (!fd) return 0;
    // analyzer returns .met/.missing (arrays), not .requirements.met
    const matched = (fd.matchedSkills || []).length;
    const missing = (fd.missingSkills || []).length;
    const stretch = (fd.stretchSkills || []).length;
    const reqMet = (fd.met || []).length;
    const reqMissing = (fd.missing || []).length;

    const totalSkills = matched + missing + stretch;
    const totalReqs = reqMet + reqMissing;

    const skillScore = totalSkills > 0 ? ((matched + stretch * 0.5) / totalSkills) * 100 : 50;
    const reqScore = totalReqs > 0 ? (reqMet / totalReqs) * 100 : 50;

    // If we have an overall from analyzer, prefer that
    if (fd.overall && fd.overall > 0) return fd.overall;

    return Math.min(95, Math.max(15, Math.round(skillScore * 0.6 + reqScore * 0.4)));
  }

  // ── Score Header ─────────────────────────────────────────────────────

  function renderScoreHeader(parent, fitScore) {
    const section = card();

    // Score display row
    const scoreRow = el('div', {
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' },
    });

    const currentScoreEl = el('div', { style: { textAlign: 'center' } }, [
      el('div', {
        text: `${fitScore}%`,
        style: {
          fontSize: '48px',
          fontWeight: '800',
          background: `linear-gradient(135deg, ${fitColor(fitScore)}, #8fb8c9)`,
          webkitBackgroundClip: 'text',
          webkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          lineHeight: '1',
        },
      }),
      el('div', {
        text: 'Current Fit',
        style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '600' },
      }),
    ]);

    const targetScoreEl = el('div', { style: { textAlign: 'center' } }, [
      el('div', {
        text: `${targetFit}%`,
        style: {
          fontSize: '36px',
          fontWeight: '700',
          color: 'var(--accent-teal, #7ba5a5)',
          lineHeight: '1',
        },
      }),
      el('div', {
        text: 'Target Fit',
        style: { fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px', fontWeight: '600' },
      }),
    ]);

    scoreRow.appendChild(currentScoreEl);
    scoreRow.appendChild(targetScoreEl);
    section.appendChild(scoreRow);

    // Visual progress bar with target needle
    const barContainer = el('div', {
      style: { position: 'relative', marginBottom: '20px' },
    });

    const barBg = el('div', {
      style: {
        width: '100%',
        height: '12px',
        borderRadius: '6px',
        background: 'rgba(123,165,165,0.12)',
        overflow: 'hidden',
      },
    });

    const barFill = el('div', {
      style: {
        width: `${fitScore}%`,
        height: '100%',
        borderRadius: '6px',
        background: `linear-gradient(90deg, ${fitColor(fitScore)}, #8fb8c9)`,
        transition: 'width 0.5s ease',
      },
    });

    barBg.appendChild(barFill);
    barContainer.appendChild(barBg);

    // Target needle
    const needle = el('div', {
      style: {
        position: 'absolute',
        left: `${targetFit}%`,
        top: '-4px',
        transform: 'translateX(-50%)',
        width: '3px',
        height: '20px',
        background: 'var(--accent-teal, #7ba5a5)',
        borderRadius: '2px',
      },
    });
    barContainer.appendChild(needle);

    section.appendChild(barContainer);

    // Target Fit Slider
    const sliderRow = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' },
    });

    sliderRow.appendChild(el('label', {
      text: 'Target Fit:',
      style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-body)', flexShrink: '0' },
    }));

    const slider = el('input', {
      type: 'range',
      min: '50',
      max: '100',
      step: '5',
      value: String(targetFit),
      style: { flex: '1', accentColor: 'var(--accent-teal, #7ba5a5)' },
      onInput: (e) => {
        targetFit = parseInt(e.target.value, 10);
        rerender();
      },
    });

    sliderRow.appendChild(slider);

    sliderRow.appendChild(el('span', {
      text: `${targetFit}%`,
      style: { fontSize: '13px', fontWeight: '700', color: 'var(--accent-teal)', minWidth: '36px' },
    }));

    section.appendChild(sliderRow);

    // Items needed estimate
    const gap = Math.max(0, targetFit - fitScore);
    const itemsNeeded = Math.ceil(gap / 8);
    if (gap > 0) {
      section.appendChild(el('p', {
        text: `Roughly ${itemsNeeded} improvement${itemsNeeded !== 1 ? 's' : ''} needed to reach your target.`,
        style: { fontSize: '12px', color: 'var(--text-muted)', margin: '0' },
      }));
    } else {
      section.appendChild(el('p', {
        text: 'You already meet or exceed your target fit!',
        style: { fontSize: '12px', color: 'var(--accent-green, #22c55e)', margin: '0', fontWeight: '600' },
      }));
    }

    parent.appendChild(section);
  }

  // ── Company Culture Vibe ─────────────────────────────────────────────

  function renderCultureVibe(parent) {
    if (!cultureProfile) return;

    const section = card();
    section.appendChild(sectionTitle('Company Culture Vibe'));

    const headerRow = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' },
    });

    const emojiMap = {
      'chaotic-startup': '\uD83D\uDE80',
      'scale-up': '\uD83D\uDCC8',
      'big-tech': '\uD83C\uDFE2',
      'enterprise': '\uD83C\uDFDB\uFE0F',
      'consulting': '\uD83D\uDCBC',
      'mission-driven': '\uD83C\uDF0D',
    };

    const labelMap = {
      'chaotic-startup': 'Chaotic Startup',
      'scale-up': 'Scale-Up',
      'big-tech': 'Big Tech',
      'enterprise': 'Enterprise',
      'consulting': 'Consulting',
      'mission-driven': 'Mission-Driven',
    };

    const profileKey = cultureProfile.type || Object.keys(emojiMap)[0];

    headerRow.appendChild(el('span', {
      text: emojiMap[profileKey] || '\uD83C\uDFE2',
      style: { fontSize: '28px' },
    }));

    headerRow.appendChild(el('span', {
      text: labelMap[profileKey] || profileKey,
      style: { fontSize: '16px', fontWeight: '700', color: 'var(--text-primary)' },
    }));

    if (cultureProfile.confidence) {
      headerRow.appendChild(tag(
        `${cultureProfile.confidence}% confidence`,
        'var(--accent-teal)',
        'rgba(123,165,165,0.12)',
      ));
    }

    section.appendChild(headerRow);

    if (cultureProfile.description) {
      section.appendChild(el('p', {
        text: cultureProfile.description,
        style: { fontSize: '13px', color: 'var(--text-body)', lineHeight: '1.6', marginBottom: '12px' },
      }));
    }

    // Prioritized soft signals
    if (cultureProfile.prioritized?.length) {
      const tagsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
      cultureProfile.prioritized.forEach((signal) => {
        tagsRow.appendChild(tag(signal, 'var(--accent-teal)', 'rgba(123,165,165,0.1)'));
      });
      section.appendChild(tagsRow);
    }

    parent.appendChild(section);
  }

  // ── HR Expert Verdict ────────────────────────────────────────────────

  function renderVerdict(parent, fitScore) {
    const verdict = verdictInfo(fitScore);
    const section = card();

    section.appendChild(sectionTitle('HR Expert Verdict'));

    const verdictRow = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
    });

    verdictRow.appendChild(el('span', {
      text: verdict.icon,
      style: { fontSize: '24px' },
    }));

    verdictRow.appendChild(el('span', {
      text: verdict.label,
      style: { fontSize: '16px', fontWeight: '700', color: verdict.color },
    }));

    section.appendChild(verdictRow);

    section.appendChild(el('p', {
      text: fitData.overall || 'No detailed summary available.',
      style: { fontSize: '13px', color: 'var(--text-body)', lineHeight: '1.6' },
    }));

    parent.appendChild(section);
  }

  // ── What the Job Wants vs What You Bring ─────────────────────────────

  function renderComparison(parent, fitScore) {
    const section = card();
    section.appendChild(sectionTitle('What the Job Wants vs What You Bring'));

    const grid = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '20px',
      },
    });

    // ── Left: Company / JD Side ──
    const leftCol = el('div');

    // Company info
    if (jdInfo) {
      leftCol.appendChild(el('div', {
        style: { marginBottom: '14px' },
      }, [
        el('div', {
          text: jdInfo.companyName || 'Company',
          style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '2px' },
        }),
        el('div', {
          text: jdInfo.roleTitle || 'Role',
          style: { fontSize: '12px', color: 'var(--text-muted)' },
        }),
      ]));
    }

    // Requirements match
    leftCol.appendChild(el('div', {
      text: 'Requirements',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
    }));

    (fitData.requirements?.met || []).forEach((r) => {
      leftCol.appendChild(requirementItem(r, true));
    });
    (fitData.requirements?.missing || []).forEach((r) => {
      leftCol.appendChild(requirementItem(r, false));
    });

    // ATS Keywords
    leftCol.appendChild(el('div', {
      text: 'ATS Keywords',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '14px', marginBottom: '8px' },
    }));

    const atsTagsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
    (fitData.matchedSkills || []).forEach((s) => {
      atsTagsRow.appendChild(tag(s, '#166534', 'rgba(34,197,94,0.12)'));
    });
    (fitData.missingSkills || []).forEach((s) => {
      atsTagsRow.appendChild(tag(s, '#9f1239', 'rgba(232,112,138,0.12)'));
    });
    leftCol.appendChild(atsTagsRow);

    grid.appendChild(leftCol);

    // ── Right: User Profile Side ──
    const rightCol = el('div');

    // Profile header
    rightCol.appendChild(el('div', {
      style: { marginBottom: '14px' },
    }, [
      el('div', {
        text: state.data.fullName || 'Your Profile',
        style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '2px' },
      }),
      el('div', {
        text: state.data.experiences?.[0]?.title || 'Current Role',
        style: { fontSize: '12px', color: 'var(--text-muted)' },
      }),
    ]));

    // Summary preview
    if (state.data.summary) {
      rightCol.appendChild(el('div', {
        text: 'Summary',
        style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
      }));
      rightCol.appendChild(el('p', {
        text: state.data.summary.length > 150
          ? state.data.summary.slice(0, 150) + '...'
          : state.data.summary,
        style: { fontSize: '12px', color: 'var(--text-body)', lineHeight: '1.5', marginBottom: '12px' },
      }));
    }

    // Skills (highlighted if JD-matched)
    rightCol.appendChild(el('div', {
      text: 'Your Skills',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
    }));

    const skillsRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } });
    const matchedSet = new Set((fitData.matchedSkills || []).map((s) => s.toLowerCase()));

    (state.data.skills || []).forEach((skill) => {
      const isMatch = matchedSet.has(skill.toLowerCase());
      skillsRow.appendChild(tag(
        skill,
        isMatch ? '#166534' : 'var(--text-body)',
        isMatch ? 'rgba(34,197,94,0.12)' : 'rgba(123,165,165,0.08)',
      ));
    });
    rightCol.appendChild(skillsRow);

    grid.appendChild(rightCol);
    section.appendChild(grid);
    parent.appendChild(section);
  }

  // ── Action Plan ──────────────────────────────────────────────────────

  function renderActionPlan(parent) {
    const section = card();
    section.appendChild(sectionTitle('Action Plan'));

    // P1: ATS Keywords (rose)
    renderPriorityTier(section, 'P1', 'ATS Keywords', 'rgba(232,112,138,0.08)', 'var(--accent-rose, #e8708a)', () => {
      const content = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } });
      (fitData.missingSkills || []).forEach((skill) => {
        const addBtn = el('button', {
          text: `+ ${skill}`,
          className: 'btn-sm',
          style: {
            background: 'rgba(232,112,138,0.1)',
            color: 'var(--accent-rose, #e8708a)',
            border: '1px solid rgba(232,112,138,0.3)',
            borderRadius: '16px',
            padding: '4px 12px',
            fontSize: '12px',
            fontWeight: '600',
            cursor: 'pointer',
          },
          onClick: () => {
            state.addSkill(skill);
            rerender();
          },
        });
        content.appendChild(addBtn);
      });
      return content;
    });

    // P2: Experience Gaps (gold)
    renderPriorityTier(section, 'P2', 'Experience Gaps', 'rgba(234,179,8,0.08)', '#eab308', () => {
      const content = el('div');
      (fitData.requirements?.missing || []).forEach((req, idx) => {
        const row = el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
        });

        row.appendChild(el('span', {
          text: `\u2022 ${req}`,
          style: { fontSize: '13px', color: 'var(--text-body)', flex: '1' },
        }));

        // "Add to [Role]" button
        if (state.data.experiences?.length > 0) {
          const expTitle = state.data.experiences[0].title || 'Role';
          row.appendChild(el('button', {
            text: `Add to ${expTitle}`,
            className: 'btn-sm',
            style: {
              background: 'rgba(234,179,8,0.1)',
              color: '#eab308',
              border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: '12px',
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: '600',
              cursor: 'pointer',
              flexShrink: '0',
              marginLeft: '8px',
            },
            onClick: () => {
              state.addBullet(0);
              const bullets = state.data.experiences[0].bullets;
              state.updateBullet(0, bullets.length - 1, req);
              rerender();
            },
          }));
        }

        content.appendChild(row);
      });
      return content;
    });

    // P3: Strategic Placement (sky)
    renderPriorityTier(section, 'P3', 'Strategic Placement', 'rgba(56,189,248,0.08)', '#38bdf8', () => {
      const content = el('div');
      const stretchArr = fitData.stretchSkills || [];
      const pivotSkills = stretchArr
        .map((skill) => {
          const pivot = findPivot(skill, state.data.skills || [], state.data.experiences || []);
          return pivot ? { skill, experience: pivot.userHas || null } : null;
        })
        .filter(Boolean);

      if (pivotSkills.length === 0) {
        content.appendChild(el('p', {
          text: 'No stretch skills to map — you are well-aligned.',
          style: { fontSize: '13px', color: 'var(--text-muted)' },
        }));
        return content;
      }

      pivotSkills.forEach((pivot) => {
        const row = el('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' },
        });

        row.appendChild(el('span', {
          text: `${pivot.skill} \u2192 ${pivot.experience || 'relevant experience'}`,
          style: { fontSize: '13px', color: 'var(--text-body)', flex: '1' },
        }));

        row.appendChild(el('button', {
          text: 'Add',
          className: 'btn-sm',
          style: {
            background: 'rgba(56,189,248,0.1)',
            color: '#38bdf8',
            border: '1px solid rgba(56,189,248,0.3)',
            borderRadius: '12px',
            padding: '3px 10px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            flexShrink: '0',
          },
          onClick: () => {
            state.addSkill(pivot.skill);
            rerender();
          },
        }));

        content.appendChild(row);
      });
      return content;
    });

    // P4: Credentials Gap (lavender)
    renderPriorityTier(section, 'P4', 'Credentials Gap', 'rgba(167,139,250,0.08)', '#a78bfa', () => {
      const content = el('div');
      const missingCerts = getCertSuggestions();

      if (missingCerts.length === 0) {
        content.appendChild(el('p', {
          text: 'No critical certification gaps identified.',
          style: { fontSize: '13px', color: 'var(--text-muted)' },
        }));
        return content;
      }

      missingCerts.forEach((cert) => {
        content.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' },
        }, [
          el('span', { text: '\uD83C\uDF93', style: { fontSize: '14px' } }),
          el('span', { text: cert, style: { fontSize: '13px', color: 'var(--text-body)' } }),
        ]));
      });
      return content;
    });

    parent.appendChild(section);
  }

  function renderPriorityTier(parent, priority, title, bg, color, contentFn) {
    const tier = el('div', {
      style: {
        background: bg,
        border: `1px solid ${color}22`,
        borderRadius: '10px',
        padding: '14px 16px',
        marginBottom: '12px',
      },
    });

    const header = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' },
    });

    header.appendChild(el('span', {
      text: priority,
      style: {
        fontSize: '11px',
        fontWeight: '800',
        color: '#fff',
        background: color,
        padding: '2px 8px',
        borderRadius: '6px',
      },
    }));

    header.appendChild(el('span', {
      text: title,
      style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)' },
    }));

    tier.appendChild(header);
    tier.appendChild(contentFn());
    parent.appendChild(tier);
  }

  function getCertSuggestions() {
    if (!jdInfo) return [];
    const jdText = (jdInfo.requirements || []).join(' ').toLowerCase() +
      ' ' + (jdInfo.skills || []).join(' ').toLowerCase();
    const suggestions = [];

    // Check if any learning path keywords appear in JD
    for (const [key, path] of Object.entries(LEARNING_PATHS)) {
      if (jdText.includes(key.toLowerCase()) && !state.data.certifications?.toLowerCase().includes(key.toLowerCase())) {
        suggestions.push(`${path.resource} (${path.credibility})`);
      }
    }
    return suggestions.slice(0, 5);
  }

  // ── Action Buttons ───────────────────────────────────────────────────

  function renderActionButtons(parent) {
    const grid = el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '10px',
        marginBottom: '16px',
      },
    });

    // Show Match Details
    grid.appendChild(btnSecondary(
      showMatchDetails ? 'Hide Match Details' : 'Show Match Details',
      () => { showMatchDetails = !showMatchDetails; rerender(); },
      { width: '100%', fontSize: '13px' },
    ));

    // Tailor My Resume
    grid.appendChild(btnPrimary(
      tailorLoading ? 'Tailoring...' : 'Tailor My Resume',
      async () => {
        if (tailorLoading || tailorResult) {
          showTailorPanel = !showTailorPanel;
          rerender();
          return;
        }
        tailorLoading = true;
        rerender();
        showProgress('Tailoring resume to job');

        try {
          tailorResult = await tailorResume(state.data, { jdText, jdInfo, fitData });
        } catch (err) {
          console.error('[target-job] Tailor failed:', err);
        } finally {
          hideProgress('Tailoring resume to job');
        }

        tailorLoading = false;
        showTailorPanel = true;
        rerender();
      },
      { width: '100%', fontSize: '13px' },
    ));

    // Help Me Stand Out
    grid.appendChild(btnSecondary(
      standOutLoading ? 'Analyzing...' : 'Help Me Stand Out',
      async () => {
        if (standOutLoading || standOutResult) {
          showStandOutPanel = !showStandOutPanel;
          rerender();
          return;
        }
        standOutLoading = true;
        rerender();
        showProgress('Generating stand-out suggestions');

        try {
          standOutResult = await generateStandOutSuggestions(state.data, { jdText, jdInfo, fitData });
        } catch (err) {
          console.error('[target-job] Stand out failed:', err);
        } finally {
          hideProgress('Generating stand-out suggestions');
        }

        standOutLoading = false;
        showStandOutPanel = true;
        rerender();
      },
      { width: '100%', fontSize: '13px' },
    ));

    parent.appendChild(grid);
  }

  // ── Match Details Panel ──────────────────────────────────────────────

  function renderMatchDetailsPanel(parent) {
    const section = card([], { borderColor: 'rgba(123,165,165,0.3)' });
    section.appendChild(sectionTitle('Match Details'));

    // Requirements met/missing (2-column)
    const reqGrid = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' },
    });

    const metCol = el('div');
    metCol.appendChild(el('div', {
      text: 'Requirements Met',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--accent-green, #22c55e)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
    }));
    (fitData.requirements?.met || []).forEach((r) => {
      metCol.appendChild(el('div', {
        text: `\u2713 ${r}`,
        style: { fontSize: '12px', color: 'var(--text-body)', marginBottom: '4px' },
      }));
    });

    const missCol = el('div');
    missCol.appendChild(el('div', {
      text: 'Requirements Missing',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--accent-rose, #e8708a)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' },
    }));
    (fitData.requirements?.missing || []).forEach((r) => {
      missCol.appendChild(el('div', {
        text: `\u2717 ${r}`,
        style: { fontSize: '12px', color: 'var(--text-body)', marginBottom: '4px' },
      }));
    });

    reqGrid.appendChild(metCol);
    reqGrid.appendChild(missCol);
    section.appendChild(reqGrid);

    // 3-tier Skill Map
    section.appendChild(el('div', {
      text: 'Skill Map',
      style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' },
    }));

    const skillMapGrid = el('div', {
      style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '20px' },
    });

    // Direct Matches
    const directCol = el('div');
    directCol.appendChild(el('div', {
      text: 'Direct Matches',
      style: { fontSize: '11px', fontWeight: '700', color: '#166534', marginBottom: '6px', textTransform: 'uppercase' },
    }));
    const directTags = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px' } });
    (fitData.matchedSkills || []).forEach((s) => {
      directTags.appendChild(tag(s, '#166534', 'rgba(34,197,94,0.12)'));
    });
    directCol.appendChild(directTags);

    // Stretch/Pivot Skills
    const stretchCol = el('div');
    stretchCol.appendChild(el('div', {
      text: 'Stretch / Pivot',
      style: { fontSize: '11px', fontWeight: '700', color: '#92400e', marginBottom: '6px', textTransform: 'uppercase' },
    }));
    const stretchTags = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px' } });
    (fitData.stretchSkills || []).forEach((s) => {
      stretchTags.appendChild(tag(s, '#92400e', 'rgba(234,179,8,0.12)'));
    });
    stretchCol.appendChild(stretchTags);

    // Gaps
    const gapCol = el('div');
    gapCol.appendChild(el('div', {
      text: 'Gaps',
      style: { fontSize: '11px', fontWeight: '700', color: '#9f1239', marginBottom: '6px', textTransform: 'uppercase' },
    }));
    const gapTags = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '3px' } });
    (fitData.missingSkills || []).forEach((s) => {
      gapTags.appendChild(tag(s, '#9f1239', 'rgba(232,112,138,0.12)'));
    });
    gapCol.appendChild(gapTags);

    skillMapGrid.appendChild(directCol);
    skillMapGrid.appendChild(stretchCol);
    skillMapGrid.appendChild(gapCol);
    section.appendChild(skillMapGrid);

    // Role Velocity indicator
    if (roleVelocity != null) {
      section.appendChild(el('div', {
        text: 'Role Velocity',
        style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' },
      }));

      const velocityRow = el('div', {
        style: { display: 'flex', alignItems: 'center', gap: '16px' },
      });

      // Conic-gradient ring
      const ring = el('div', {
        style: {
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          background: `conic-gradient(var(--accent-teal, #7ba5a5) ${roleVelocity * 3.6}deg, rgba(123,165,165,0.12) 0deg)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: '0',
        },
      });

      const ringInner = el('div', {
        text: `${roleVelocity}`,
        style: {
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          background: 'var(--bg-card, #1a1b2e)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          fontWeight: '700',
          color: 'var(--text-primary)',
        },
      });

      ring.appendChild(ringInner);
      velocityRow.appendChild(ring);

      const velocityLabel = roleVelocity >= 70
        ? 'Fast mover — strong career progression signals.'
        : roleVelocity >= 40
          ? 'Steady progression — solid trajectory.'
          : 'Emerging career — highlight growth potential.';

      velocityRow.appendChild(el('span', {
        text: velocityLabel,
        style: { fontSize: '13px', color: 'var(--text-body)', lineHeight: '1.5' },
      }));

      section.appendChild(velocityRow);
    }

    parent.appendChild(section);
  }

  // ── Tailor Panel ─────────────────────────────────────────────────────

  function renderTailorPanel(parent) {
    const section = card([], { borderColor: 'rgba(167,139,250,0.3)' });
    section.appendChild(sectionTitle('Tailored Resume'));

    if (!tailorResult) {
      section.appendChild(el('p', {
        text: 'Tailoring could not be completed.',
        style: { fontSize: '13px', color: 'var(--text-muted)' },
      }));
      parent.appendChild(section);
      return;
    }

    // Change count
    section.appendChild(el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' },
    }, [
      tag(`${tailorResult.changeCount || 0} changes`, '#7c3aed', 'rgba(167,139,250,0.12)'),
      tailorApplied
        ? tag('Applied', '#166534', 'rgba(34,197,94,0.12)')
        : null,
    ]));

    // Tailored summary
    if (tailorResult.summary) {
      section.appendChild(el('div', {
        text: 'Summary',
        style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' },
      }));
      section.appendChild(el('p', {
        text: tailorResult.summary,
        style: {
          fontSize: '13px',
          color: 'var(--text-body)',
          lineHeight: '1.6',
          padding: '10px 14px',
          borderRadius: '8px',
          background: 'rgba(167,139,250,0.06)',
          border: '1px solid rgba(167,139,250,0.15)',
          marginBottom: '16px',
        },
      }));
    }

    // Per-experience before/after bullets
    (tailorResult.experiences || []).forEach((expChange) => {
      const idx = expChange.expIdx;
      const originalExp = state.data.experiences[idx];
      if (!originalExp) return;

      section.appendChild(el('div', {
        text: `${originalExp.title || 'Role'} at ${originalExp.company || 'Company'}`,
        style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '8px', marginTop: '12px' },
      }));

      (expChange.bullets || []).forEach((b) => {
        if (!b.changed) return;

        const bulletCard = el('div', {
          style: {
            padding: '10px 12px',
            borderRadius: '8px',
            background: 'rgba(167,139,250,0.06)',
            border: '1px solid rgba(167,139,250,0.15)',
            marginBottom: '8px',
          },
        });

        bulletCard.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: '6px', marginBottom: '6px' },
        }, [
          el('span', { text: 'Before:', style: { fontSize: '11px', fontWeight: '700', color: 'var(--text-muted)', flexShrink: '0' } }),
          el('span', {
            text: b.original,
            style: { fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'line-through' },
          }),
        ]));

        bulletCard.appendChild(el('div', {
          style: { display: 'flex', alignItems: 'flex-start', gap: '6px' },
        }, [
          el('span', { text: 'After:', style: { fontSize: '11px', fontWeight: '700', color: '#7c3aed', flexShrink: '0' } }),
          el('span', {
            text: b.rewritten,
            style: { fontSize: '12px', color: 'var(--text-body)' },
          }),
        ]));

        section.appendChild(bulletCard);
      });
    });

    // Skills added list
    if (tailorResult.skillsAdded?.length) {
      section.appendChild(el('div', {
        text: 'Skills to Add',
        style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '14px', marginBottom: '8px' },
      }));

      const addedRow = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '14px' } });
      tailorResult.skillsAdded.forEach((s) => {
        addedRow.appendChild(tag(s, '#7c3aed', 'rgba(167,139,250,0.12)'));
      });
      section.appendChild(addedRow);
    }

    // Apply All Changes button
    if (!tailorApplied) {
      section.appendChild(btnPrimary('Apply All Changes', () => {
        applyTailorChanges();
      }, { width: '100%', marginTop: '8px' }));
    }

    parent.appendChild(section);
  }

  function applyTailorChanges() {
    if (!tailorResult || tailorApplied) return;

    // Apply summary
    if (tailorResult.summary) {
      state.updateData({ summary: tailorResult.summary });
    }

    // Apply bullet changes
    (tailorResult.experiences || []).forEach((expChange) => {
      const idx = expChange.expIdx;
      (expChange.bullets || []).forEach((b, bulletIdx) => {
        if (b.changed && b.rewritten) {
          state.updateBullet(idx, bulletIdx, b.rewritten);
        }
      });
    });

    // Add new skills
    (tailorResult.skillsAdded || []).forEach((skill) => {
      state.addSkill(skill);
    });

    tailorApplied = true;
    rerender();
  }

  // ── Stand Out Panel ──────────────────────────────────────────────────

  function renderStandOutPanel(parent) {
    const section = card([], { borderColor: 'rgba(234,179,8,0.3)' });
    section.appendChild(sectionTitle('Help You Stand Out'));

    if (!standOutResult) {
      section.appendChild(el('p', {
        text: 'Could not generate stand-out suggestions.',
        style: { fontSize: '13px', color: 'var(--text-muted)' },
      }));
      parent.appendChild(section);
      return;
    }

    // Parse the text result into sections - extract text content from object
    const textContent = standOutResult?.geminiInsights || standOutResult?.text || standOutResult || '';
    const suggestions = parseStandOutSuggestions(textContent);

    if (suggestions.length === 0) {
      // Render as plain text if parsing fails
      section.appendChild(el('div', {
        style: {
          fontSize: '13px',
          color: 'var(--text-body)',
          lineHeight: '1.7',
          whiteSpace: 'pre-wrap',
        },
        text: standOutResult,
      }));
      parent.appendChild(section);
      return;
    }

    // Top differentiators
    section.appendChild(el('div', {
      text: 'Top Differentiators',
      style: { fontSize: '12px', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' },
    }));

    suggestions.forEach((sug, idx) => {
      const sugCard = el('div', {
        style: {
          padding: '12px 14px',
          borderRadius: '8px',
          background: 'rgba(234,179,8,0.06)',
          border: '1px solid rgba(234,179,8,0.15)',
          marginBottom: '10px',
        },
      });

      sugCard.appendChild(el('div', {
        text: sug.title || `Suggestion ${idx + 1}`,
        style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '6px' },
      }));

      if (sug.reasoning) {
        sugCard.appendChild(el('p', {
          text: sug.reasoning,
          style: { fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '8px' },
        }));
      }

      if (sug.bullet) {
        const bulletRow = el('div', {
          style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' },
        });

        bulletRow.appendChild(el('span', {
          text: `"${sug.bullet}"`,
          style: { fontSize: '12px', color: 'var(--text-body)', fontStyle: 'italic', flex: '1' },
        }));

        bulletRow.appendChild(el('button', {
          text: 'Use This Pattern',
          className: 'btn-sm',
          style: {
            background: 'rgba(234,179,8,0.1)',
            color: '#eab308',
            border: '1px solid rgba(234,179,8,0.3)',
            borderRadius: '12px',
            padding: '3px 10px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            flexShrink: '0',
          },
          onClick: () => {
            if (state.data.experiences?.length > 0) {
              state.addBullet(0);
              const bullets = state.data.experiences[0].bullets;
              state.updateBullet(0, bullets.length - 1, sug.bullet);
            }
          },
        }));

        sugCard.appendChild(bulletRow);
      }

      section.appendChild(sugCard);
    });

    parent.appendChild(section);
  }

  function parseStandOutSuggestions(text) {
    if (!text) return [];
    // Try to split on numbered items like "1." "2." etc
    const parts = text.split(/\n(?=\d+\.)/);
    return parts.map((part) => {
      const lines = part.trim().split('\n').filter(Boolean);
      const titleLine = lines[0] || '';
      const title = titleLine.replace(/^\d+\.\s*\**/, '').replace(/\*+$/, '').trim();
      const rest = lines.slice(1).join('\n').trim();

      // Try to find a quoted bullet
      const bulletMatch = rest.match(/"([^"]+)"/);
      const bullet = bulletMatch ? bulletMatch[1] : '';
      const reasoning = rest.replace(/"[^"]*"/g, '').trim();

      return { title, reasoning, bullet };
    }).filter((s) => s.title);
  }

  // ── Gap-Bridge Simulator ─────────────────────────────────────────────

  function renderGapBridgeSimulator(parent) {
    const section = card([], { borderColor: 'rgba(56,189,248,0.3)' });
    section.appendChild(sectionTitle('Gap-Bridge Simulator'));

    const gapSkills = fitData.missingSkills || [];

    if (gapSkills.length === 0) {
      section.appendChild(el('p', {
        text: 'No skill gaps to bridge — great job!',
        style: { fontSize: '13px', color: 'var(--text-muted)' },
      }));
      parent.appendChild(section);
      return;
    }

    gapSkills.forEach((skill) => {
      const skillLower = skill.toLowerCase();
      const path = LEARNING_PATHS[skillLower] || null;

      const gapCard = el('div', {
        style: {
          padding: '14px 16px',
          borderRadius: '10px',
          background: 'rgba(56,189,248,0.05)',
          border: '1px solid rgba(56,189,248,0.15)',
          marginBottom: '12px',
        },
      });

      gapCard.appendChild(el('div', {
        text: skill,
        style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' },
      }));

      if (path) {
        // Learning path details
        const detailGrid = el('div', {
          style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' },
        });

        detailGrid.appendChild(el('div', {}, [
          el('div', { text: 'Resource', style: { fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '2px' } }),
          el('div', { text: path.resource, style: { fontSize: '12px', color: 'var(--text-body)' } }),
        ]));

        detailGrid.appendChild(el('div', {}, [
          el('div', { text: 'Credibility', style: { fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '2px' } }),
          el('div', { text: path.credibility, style: { fontSize: '12px', color: 'var(--text-body)' } }),
        ]));

        detailGrid.appendChild(el('div', {}, [
          el('div', { text: 'Timeframe', style: { fontSize: '10px', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', marginBottom: '2px' } }),
          el('div', { text: path.timeframe, style: { fontSize: '12px', color: 'var(--text-body)' } }),
        ]));

        gapCard.appendChild(detailGrid);

        // Animated progress bar
        const progressOuter = el('div', {
          style: {
            width: '100%',
            height: '6px',
            borderRadius: '3px',
            background: 'rgba(56,189,248,0.15)',
            overflow: 'hidden',
            marginBottom: '10px',
          },
        });

        const progressInner = el('div', {
          style: {
            width: '0%',
            height: '100%',
            borderRadius: '3px',
            background: 'linear-gradient(90deg, #38bdf8, var(--accent-teal, #7ba5a5))',
            transition: 'width 1s ease',
          },
        });

        progressOuter.appendChild(progressInner);
        gapCard.appendChild(progressOuter);

        // Animate after append
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            progressInner.style.width = '75%';
          });
        });

        // CV presentation tip
        gapCard.appendChild(el('div', {
          style: {
            fontSize: '12px',
            color: 'var(--text-muted)',
            fontStyle: 'italic',
            marginBottom: '12px',
            padding: '8px 10px',
            background: 'rgba(123,165,165,0.06)',
            borderRadius: '6px',
          },
          text: `Tip: Add "${path.resource}" to your certifications section, even if in progress. Label it "In Progress" or "Expected [Month Year]".`,
        }));
      } else {
        gapCard.appendChild(el('p', {
          text: 'No curated learning path available. Search for courses on Coursera, Udemy, or LinkedIn Learning.',
          style: { fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' },
        }));
      }

      // Action buttons
      const btnRow = el('div', {
        style: { display: 'flex', gap: '8px' },
      });

      btnRow.appendChild(el('button', {
        text: 'Add Skill',
        className: 'btn-sm',
        style: {
          background: 'rgba(56,189,248,0.1)',
          color: '#38bdf8',
          border: '1px solid rgba(56,189,248,0.3)',
          borderRadius: '12px',
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: '600',
          cursor: 'pointer',
        },
        onClick: () => {
          state.addSkill(skill);
          rerender();
        },
      }));

      if (path) {
        btnRow.appendChild(el('button', {
          text: 'Add to Certs',
          className: 'btn-sm',
          style: {
            background: 'rgba(167,139,250,0.1)',
            color: '#a78bfa',
            border: '1px solid rgba(167,139,250,0.3)',
            borderRadius: '12px',
            padding: '4px 12px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
          },
          onClick: () => {
            const certText = `${path.resource} (In Progress)`;
            const existing = state.data.certifications || '';
            const updated = existing ? `${existing}\n${certText}` : certText;
            state.updateData({ certifications: updated });
            rerender();
          },
        }));
      }

      gapCard.appendChild(btnRow);
      section.appendChild(gapCard);
    });

    parent.appendChild(section);
  }

  // ── Navigation ───────────────────────────────────────────────────────

  function renderNavigation(parent) {
    const nav = el('div', {
      style: {
        display: 'flex',
        justifyContent: 'center',
        gap: '12px',
        marginTop: '8px',
        marginBottom: '24px',
      },
    });

    nav.appendChild(btnPrimary('Go to Editor', () => {
      state.setPage('editor');
    }));

    nav.appendChild(btnSecondary('Analyze Another Job', () => {
      // Reset local state
      step = 0;
      fitData = null;
      jdText = '';
      jdInfo = null;
      cultureProfile = null;
      tailorResult = null;
      standOutResult = null;
      tailorApplied = false;
      showMatchDetails = false;
      showTailorPanel = false;
      showStandOutPanel = false;
      showGapBridge = false;
      fetchStatus = 'idle';
      roleVelocity = null;
      state.setJobContext({ jdText: '', jdInfo: null, fitData: null });
      rerender();
    }));

    // Toggle gap bridge simulator
    nav.appendChild(btnSecondary(
      showGapBridge ? 'Hide Gap Bridge' : 'Gap Bridge Simulator',
      () => { showGapBridge = !showGapBridge; rerender(); },
    ));

    parent.appendChild(nav);
  }

  // ── Initial render ───────────────────────────────────────────────────

  rerender();
  container.appendChild(page);
}
