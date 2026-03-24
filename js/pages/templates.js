/**
 * Templates selection page for Resume Forge SPA.
 * Renders a grid of template cards for the user to choose from.
 *
 * @module pages/templates
 */

import { TEMPLATES, TEMPLATE_META } from '../constants.js';

/**
 * @param {HTMLElement} container - DOM element to render into
 * @param {object} state - AppState instance
 */
export function renderTemplates(container, state) {
  container.innerHTML = '';

  const page = document.createElement('div');
  page.className = 'page';
  page.style.display = 'flex';
  page.style.flexDirection = 'column';
  page.style.alignItems = 'center';

  // ── Page Header ──────────────────────────────────────────
  const header = document.createElement('div');
  header.style.textAlign = 'center';
  header.style.marginBottom = '32px';

  const title = document.createElement('h1');
  title.textContent = 'Choose Your Template';
  title.style.fontSize = '36px';
  title.style.fontWeight = '700';
  title.style.color = 'var(--text-primary)';
  header.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent =
    'Select a template that matches your industry and personal style. All templates are ATS-optimized and professionally designed.';
  subtitle.style.maxWidth = '600px';
  subtitle.style.margin = '12px auto 0';
  subtitle.style.fontSize = '14px';
  subtitle.style.color = 'var(--text-body)';
  subtitle.style.lineHeight = '1.6';
  header.appendChild(subtitle);

  page.appendChild(header);

  // ── Template Grid ────────────────────────────────────────
  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
  grid.style.gap = '20px';
  grid.style.maxWidth = '1100px';
  grid.style.width = '100%';

  const templateKeys = Object.keys(TEMPLATES);

  templateKeys.forEach((key) => {
    const tmpl = TEMPLATES[key];
    const meta = TEMPLATE_META[key];
    const isSelected = state.data.template === key;

    // ── Card ───────────────────────────────────────────────
    const card = document.createElement('div');
    card.className = 'glass';
    card.style.overflow = 'hidden';
    card.style.cursor = 'pointer';
    card.style.transition = 'all 0.25s ease';
    card.style.borderWidth = '2px';
    card.style.borderStyle = 'solid';
    card.style.borderColor = isSelected ? 'var(--accent-teal)' : 'var(--border)';

    if (isSelected) {
      card.style.background = 'rgba(123, 165, 165, 0.06)';
    }

    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--accent-teal)';
      card.style.boxShadow = '0 4px 20px rgba(123, 165, 165, 0.2)';
    });
    card.addEventListener('mouseleave', () => {
      const stillSelected = state.data.template === key;
      card.style.borderColor = stillSelected ? 'var(--accent-teal)' : 'var(--border)';
      card.style.boxShadow = stillSelected ? '0 4px 20px rgba(123, 165, 165, 0.2)' : 'none';
    });

    card.addEventListener('click', () => {
      state.setTemplate(key);
      state.setPage('preview');
    });

    // ── Color Preview Bar ──────────────────────────────────
    const previewBar = document.createElement('div');
    previewBar.style.height = '80px';
    previewBar.style.background = `linear-gradient(135deg, ${tmpl.accent}, ${tmpl.accent}cc)`;
    previewBar.style.display = 'flex';
    previewBar.style.alignItems = 'center';
    previewBar.style.justifyContent = 'center';

    const placeholder = document.createElement('div');
    placeholder.style.width = '50px';
    placeholder.style.height = '6px';
    placeholder.style.borderRadius = '3px';
    placeholder.style.background = 'var(--sand, #c2b280)';
    placeholder.style.opacity = '0.7';
    previewBar.appendChild(placeholder);

    card.appendChild(previewBar);

    // ── Card Content ───────────────────────────────────────
    const content = document.createElement('div');
    content.style.padding = '16px';

    // Name + Badge row
    const nameRow = document.createElement('div');
    nameRow.style.display = 'flex';
    nameRow.style.alignItems = 'center';
    nameRow.style.gap = '8px';
    nameRow.style.marginBottom = '8px';

    const name = document.createElement('span');
    name.textContent = tmpl.name;
    name.style.fontSize = '16px';
    name.style.fontWeight = '700';
    name.style.color = 'var(--text-primary)';
    nameRow.appendChild(name);

    if (meta.badge) {
      const badge = document.createElement('span');
      badge.textContent = meta.badge;
      badge.style.fontSize = '10px';
      badge.style.fontWeight = '700';
      badge.style.padding = '2px 8px';
      badge.style.borderRadius = '12px';
      badge.style.background = 'linear-gradient(135deg, #7ba5a5, #8fb8c9)';
      badge.style.color = '#fff';
      badge.style.letterSpacing = '0.3px';
      nameRow.appendChild(badge);
    }

    content.appendChild(nameRow);

    // Description
    const desc = document.createElement('p');
    desc.textContent = tmpl.desc;
    desc.style.fontSize = '13px';
    desc.style.color = 'var(--text-muted)';
    desc.style.lineHeight = '1.5';
    desc.style.marginBottom = '10px';
    content.appendChild(desc);

    // Tags row
    const tagsRow = document.createElement('div');
    tagsRow.style.display = 'flex';
    tagsRow.style.flexWrap = 'wrap';
    tagsRow.style.gap = '6px';
    tagsRow.style.marginBottom = '10px';

    meta.tags.forEach((tag) => {
      const pill = document.createElement('span');
      pill.textContent = tag;
      pill.style.fontSize = '11px';
      pill.style.padding = '2px 8px';
      pill.style.borderRadius = '12px';
      pill.style.background = 'rgba(123, 165, 165, 0.1)';
      pill.style.color = 'var(--text-muted)';
      pill.style.fontWeight = '500';
      tagsRow.appendChild(pill);
    });

    content.appendChild(tagsRow);

    // Checks list
    meta.checks.forEach((check) => {
      const checkEl = document.createElement('div');
      checkEl.style.fontSize = '12px';
      checkEl.style.color = 'var(--text-muted)';
      checkEl.style.marginBottom = '3px';
      checkEl.textContent = '\u2713 ' + check;
      content.appendChild(checkEl);
    });

    card.appendChild(content);
    grid.appendChild(card);
  });

  page.appendChild(grid);

  // ── Navigation Buttons ───────────────────────────────────
  const nav = document.createElement('div');
  nav.style.display = 'flex';
  nav.style.gap = '12px';
  nav.style.justifyContent = 'center';
  nav.style.marginTop = '32px';

  const backBtn = document.createElement('button');
  backBtn.className = 'btn-secondary';
  backBtn.textContent = 'Back to Editor';
  backBtn.addEventListener('click', () => state.setPage('editor'));
  nav.appendChild(backBtn);

  const previewBtn = document.createElement('button');
  previewBtn.className = 'btn-primary';
  previewBtn.textContent = 'Preview Resume';
  previewBtn.addEventListener('click', () => state.setPage('preview'));
  nav.appendChild(previewBtn);

  page.appendChild(nav);

  container.appendChild(page);
}
