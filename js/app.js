// app.js — Main entry point for ResumeForge SPA

import { renderHome } from './pages/home.js';
import { renderImport } from './pages/import.js';
import { renderTargetJob } from './pages/target-job.js';
import { renderEditor } from './pages/editor.js';
import { renderTemplates } from './pages/templates.js';
import { renderPreview } from './pages/preview.js';
import { renderSettings } from './pages/settings.js';
import { clearGeminiCache } from './gemini.js';

// ── Constants ────────────────────────────────────────────────────────

const STORAGE_KEY_DATA = 'multiverse_resume_data';
const STORAGE_KEY_JOB = 'multiverse_resume_jobcontext';
const STORAGE_KEY_API = 'resume_forge_gemini_key';
const SAVE_DEBOUNCE_MS = 800;

const VALID_PAGES = ['home', 'import', 'target-job', 'editor', 'templates', 'preview', 'settings'];

const DEFAULT_DATA = {
  template: 'faang',
  fullName: '',
  email: '',
  phone: '',
  location: '',
  linkedin: '',
  portfolio: '',
  summary: '',
  experiences: [
    {
      company: '',
      title: '',
      startDate: '',
      endDate: '',
      current: false,
      bullets: [''],
      narrativeCore: '',
      softSignals: [],
      evidenceLinks: [],
      impactScore: 0,
    },
  ],
  education: [{ school: '', degree: '', field: '', year: '' }],
  skills: [],
  certifications: '',
};

// ── Persistence helpers ──────────────────────────────────────────────

function loadSavedData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DATA);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadSavedJobContext() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_JOB);
    return raw ? JSON.parse(raw) : { jdText: '', jdInfo: null, fitData: null };
  } catch {
    return { jdText: '', jdInfo: null, fitData: null };
  }
}

function persistData(data) {
  try {
    localStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
  } catch {
    // storage full — silently fail
  }
}

function persistJobContext(ctx) {
  try {
    localStorage.setItem(STORAGE_KEY_JOB, JSON.stringify(ctx));
  } catch {
    // storage full — silently fail
  }
}

// ── API key helpers ──────────────────────────────────────────────────

export function getApiKey() {
  return localStorage.getItem(STORAGE_KEY_API) || '';
}

export function setApiKey(key) {
  localStorage.setItem(STORAGE_KEY_API, key.trim());
}

// ── State manager ────────────────────────────────────────────────────

class AppState {
  constructor() {
    this.data = loadSavedData() || structuredClone(DEFAULT_DATA);
    this.jobContext = loadSavedJobContext();
    this.page = 'home';
    this.saveStatus = 'idle'; // idle | saving | saved
    this._listeners = new Set();
    this._saveTimer = null;
  }

  // Observer ──────────────────────────────────────────────────────────

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  notify() {
    this._listeners.forEach((fn) => fn(this));
    this._scheduleSave();
  }

  // Save without re-rendering (for data updates within a page)
  _saveOnly() {
    this._scheduleSave();
  }

  // Top-level data updates ───────────────────────────────────────────

  updateData(updates) {
    this.data = { ...this.data, ...updates };
    this._saveOnly(); // Don't re-render — the calling page manages its own DOM
  }

  // Experience helpers ───────────────────────────────────────────────

  updateExperience(idx, updates) {
    const experiences = this.data.experiences.map((exp, i) =>
      i === idx ? { ...exp, ...updates } : exp,
    );
    this.updateData({ experiences });
  }

  addExperience() {
    const blank = {
      company: '',
      title: '',
      startDate: '',
      endDate: '',
      current: false,
      bullets: [''],
      narrativeCore: '',
      softSignals: [],
      evidenceLinks: [],
      impactScore: 0,
    };
    this.updateData({ experiences: [...this.data.experiences, blank] });
  }

  removeExperience(idx) {
    const experiences = this.data.experiences.filter((_, i) => i !== idx);
    this.updateData({
      experiences: experiences.length
        ? experiences
        : [structuredClone(DEFAULT_DATA.experiences[0])],
    });
  }

  // Bullet helpers ───────────────────────────────────────────────────

  updateBullet(expIdx, bulletIdx, value) {
    const experiences = this.data.experiences.map((exp, i) => {
      if (i !== expIdx) return exp;
      const bullets = exp.bullets.map((b, j) => (j === bulletIdx ? value : b));
      return { ...exp, bullets };
    });
    this.updateData({ experiences });
  }

  addBullet(expIdx) {
    const experiences = this.data.experiences.map((exp, i) => {
      if (i !== expIdx) return exp;
      return { ...exp, bullets: [...exp.bullets, ''] };
    });
    this.updateData({ experiences });
  }

  // Education helpers ────────────────────────────────────────────────

  updateEducation(idx, updates) {
    const education = this.data.education.map((ed, i) =>
      i === idx ? { ...ed, ...updates } : ed,
    );
    this.updateData({ education });
  }

  addEducation() {
    this.updateData({
      education: [
        ...this.data.education,
        { school: '', degree: '', field: '', year: '' },
      ],
    });
  }

  // Skill helpers ────────────────────────────────────────────────────

  addSkill(skill) {
    const trimmed = skill.trim();
    if (!trimmed || this.data.skills.includes(trimmed)) return;
    this.updateData({ skills: [...this.data.skills, trimmed] });
  }

  removeSkill(skill) {
    this.updateData({ skills: this.data.skills.filter((s) => s !== skill) });
  }

  // Template ─────────────────────────────────────────────────────────

  setTemplate(key) {
    this.updateData({ template: key });
  }

  // Navigation ───────────────────────────────────────────────────────

  setPage(page) {
    if (!VALID_PAGES.includes(page)) return;
    this.page = page;
    // Setting hash triggers hashchange → navigate → renderApp, so don't also notify listeners
    window.location.hash = `#${page}`;
  }

  // Job context ──────────────────────────────────────────────────────

  setJobContext(ctx) {
    this.jobContext = { ...this.jobContext, ...ctx };
    persistJobContext(this.jobContext);
    // Don't trigger full re-render — pages handle their own updates
  }

  // Reset ────────────────────────────────────────────────────────────

  clearAll() {
    this.data = structuredClone(DEFAULT_DATA);
    this.jobContext = { jdText: '', jdInfo: null, fitData: null };
    localStorage.removeItem(STORAGE_KEY_DATA);
    localStorage.removeItem(STORAGE_KEY_JOB);
    localStorage.removeItem('multiverse_resume_original');
    clearGeminiCache();

    // Clear page-level caches
    this._clearPageCaches();

    this.saveStatus = 'idle';
    this._listeners.forEach((fn) => fn(this));
  }

  // Clear module-level cache objects in pages
  _clearPageCaches() {
    // Call reset functions that pages can export
    if (window.resetTargetJobCache) window.resetTargetJobCache();
    if (window.resetEditorCache) window.resetEditorCache();
    if (window.resetPreviewCache) window.resetPreviewCache();
    if (window.resetImportCache) window.resetImportCache();
  }

  // Query helpers ────────────────────────────────────────────────────

  hasResumeData() {
    const d = this.data;
    return !!(
      d.fullName ||
      d.email ||
      d.summary ||
      d.experiences.some((e) => e.company || e.title) ||
      d.education.some((e) => e.school || e.degree) ||
      d.skills.length
    );
  }

  // Debounced save ───────────────────────────────────────────────────

  _scheduleSave() {
    this.saveStatus = 'saving';
    _updateSaveStatusUI('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      persistData(this.data);
      persistJobContext(this.jobContext);
      this.saveStatus = 'saved';
      _updateSaveStatusUI('saved');

      // Reset to idle after a brief flash
      setTimeout(() => {
        this.saveStatus = 'idle';
        _updateSaveStatusUI('idle');
      }, 1500);
    }, SAVE_DEBOUNCE_MS);
  }
}

// ── Singleton state ──────────────────────────────────────────────────

export const appState = new AppState();

// ── Router ───────────────────────────────────────────────────────────

const PAGE_RENDERERS = {
  home: renderHome,
  import: renderImport,
  'target-job': renderTargetJob,
  editor: renderEditor,
  templates: renderTemplates,
  preview: renderPreview,
  settings: renderSettings,
};

function pageFromHash() {
  const hash = window.location.hash.replace('#', '');
  return VALID_PAGES.includes(hash) ? hash : 'home';
}

function navigate() {
  appState.page = pageFromHash();
  renderApp();
}

// Directly update the save-status dot in the DOM without re-rendering the whole page
function _updateSaveStatusUI(status) {
  const dot = document.querySelector('.save-dot');
  if (!dot) return;
  dot.classList.remove('dot-saved', 'dot-saving');
  if (status === 'saved') {
    dot.classList.add('dot-saved');
    dot.title = 'All changes saved';
  } else if (status === 'saving') {
    dot.classList.add('dot-saving');
    dot.title = 'Saving...';
  } else {
    dot.title = '';
  }
}

// ── NavBar ───────────────────────────────────────────────────────────

function renderNavBar(container) {
  const nav = document.createElement('nav');
  nav.className = 'app-nav';

  // Logo
  const logo = document.createElement('a');
  logo.href = '#home';
  logo.className = 'nav-logo';
  logo.innerHTML = 'The Multiverse <span class="logo-gradient">Resume</span>';

  const aiBadge = document.createElement('span');
  aiBadge.className = 'ai-badge';
  aiBadge.textContent = 'AI';

  const logoGroup = document.createElement('div');
  logoGroup.className = 'nav-logo-group';
  logoGroup.appendChild(logo);
  logoGroup.appendChild(aiBadge);

  // Save status
  const statusDot = document.createElement('span');
  statusDot.className = 'save-dot';
  updateSaveDot(statusDot, appState.saveStatus);

  // Nav links
  const linksContainer = document.createElement('div');
  linksContainer.className = 'nav-links';

  const navItems = [
    { page: 'home', label: 'Home' },
    { page: 'import', label: 'Import' },
    { page: 'target-job', label: 'Target Job' },
    { page: 'editor', label: 'Editor' },
    { page: 'templates', label: 'Templates' },
    { page: 'preview', label: 'Preview' },
    { page: 'settings', label: 'Settings' },
  ];

  navItems.forEach(({ page, label }) => {
    const link = document.createElement('a');
    link.href = `#${page}`;
    link.className = 'nav-link';
    if (appState.page === page) link.classList.add('active');
    link.textContent = label;
    linksContainer.appendChild(link);
  });

  // Progress pill mount point (between save dot and nav links)
  const progressMount = document.createElement('div');
  progressMount.id = 'progress-pill-mount';

  nav.appendChild(logoGroup);
  nav.appendChild(statusDot);
  nav.appendChild(progressMount);
  nav.appendChild(linksContainer);
  container.appendChild(nav);
}

function updateSaveDot(dot, status) {
  dot.classList.remove('dot-saved', 'dot-saving');
  if (status === 'saved') {
    dot.classList.add('dot-saved');
    dot.title = 'All changes saved';
  } else if (status === 'saving') {
    dot.classList.add('dot-saving');
    dot.title = 'Saving...';
  } else {
    dot.title = '';
  }
}

// ── API Key Setup Modal ──────────────────────────────────────────────

function showApiKeyModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-card';

    const title = document.createElement('h2');
    title.textContent = 'Welcome to ResumeForge';
    modal.appendChild(title);

    const description = document.createElement('p');
    description.textContent = 'Enter your Gemini API key to enable AI-powered resume features.';
    modal.appendChild(description);

    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'modal-input';
    input.placeholder = 'Paste your Gemini API key';
    modal.appendChild(input);

    const linkP = document.createElement('p');
    linkP.className = 'modal-link';
    const link = document.createElement('a');
    link.href = 'https://ai.google.dev';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Get your free API key at ai.google.dev';
    linkP.appendChild(link);
    modal.appendChild(linkP);

    const warning = document.createElement('p');
    warning.className = 'modal-warning';
    warning.textContent = 'Your key is stored locally in your browser. Never share it.';
    modal.appendChild(warning);

    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = 'Get Started';
    btn.disabled = true;

    input.addEventListener('input', () => {
      btn.disabled = !input.value.trim();
    });

    btn.addEventListener('click', () => {
      const key = input.value.trim();
      if (!key) return;
      setApiKey(key);
      overlay.remove();
      resolve();
    });

    // Allow Enter key to submit
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        btn.click();
      }
    });

    modal.appendChild(btn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    input.focus();
  });
}

// ── App rendering ────────────────────────────────────────────────────

let mainContainer = null;
let navContainer = null;

function renderApp() {
  if (!mainContainer || !navContainer) return;

  // Clear previous content
  navContainer.textContent = '';
  mainContainer.textContent = '';

  // Render nav on every page except home
  if (appState.page !== 'home') {
    renderNavBar(navContainer);
  }

  // Dispatch to page renderer
  const renderer = PAGE_RENDERERS[appState.page];
  if (renderer) {
    renderer(mainContainer, appState);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────

function buildAppShell() {
  const root = document.getElementById('app') || document.body;

  // Remove the loading placeholder
  const loading = document.getElementById('loading');
  if (loading) loading.remove();

  // Remove the static API key modal from index.html (we create our own)
  const staticModal = document.getElementById('api-key-modal');
  if (staticModal) staticModal.remove();

  // Clear any remaining children in root
  root.innerHTML = '';

  // Global progress bar (fixed at top)
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-top';
  progressBar.id = 'global-progress';
  const progressInner = document.createElement('div');
  progressInner.className = 'progress-top-bar';
  progressBar.appendChild(progressInner);
  root.appendChild(progressBar);

  navContainer = document.createElement('header');
  navContainer.id = 'app-nav';

  mainContainer = document.createElement('main');
  mainContainer.id = 'app-main';

  root.appendChild(navContainer);
  root.appendChild(mainContainer);
}

// ── Global progress bar helpers ────────────────────────────────────

let _progressCount = 0;

// Progress bar functions moved to progress.js to avoid circular imports

async function init() {
  buildAppShell();

  // Check for API key — prompt if missing
  if (!getApiKey()) {
    await showApiKeyModal();
  }

  // Subscribe to state changes for re-renders
  appState.subscribe(() => renderApp());

  // Listen for hash changes
  window.addEventListener('hashchange', navigate);

  // Set initial page from URL hash
  appState.page = pageFromHash();

  // First render
  renderApp();
}

document.addEventListener('DOMContentLoaded', init);

export function saveOriginalSnapshot(data) {
  try {
    localStorage.setItem('multiverse_resume_original', JSON.stringify(data));
  } catch {
    // storage full — silently fail
  }
}

export function loadOriginalSnapshot() {
  try {
    const raw = localStorage.getItem('multiverse_resume_original');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export { DEFAULT_DATA };
