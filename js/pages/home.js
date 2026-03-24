/**
 * Home / Landing page for Resume Forge SPA.
 * Renders the welcome screen with action cards and workflow hints.
 *
 * @param {HTMLElement} container - DOM element to render into
 * @param {object} state - AppState instance
 */
export function renderHome(container, state) {
  container.innerHTML = '';

  const hasData = state.hasResumeData();

  const page = document.createElement('div');
  page.className = 'page';
  page.style.display = 'flex';
  page.style.flexDirection = 'column';
  page.style.alignItems = 'center';
  page.style.justifyContent = 'center';

  // ── App Header ──────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'page-header';
  header.style.marginBottom = '32px';

  const title = document.createElement('h1');
  title.className = 'page-title';
  title.style.fontSize = '36px';
  title.style.fontWeight = '800';

  const titlePrefix = document.createTextNode('The Multiverse ');
  title.appendChild(titlePrefix);

  const resumeSpan = document.createElement('span');
  resumeSpan.textContent = 'Resume';
  resumeSpan.style.background = 'linear-gradient(135deg, #e8708a, #db7093)';
  resumeSpan.style.webkitBackgroundClip = 'text';
  resumeSpan.style.webkitTextFillColor = 'transparent';
  resumeSpan.style.backgroundClip = 'text';
  title.appendChild(resumeSpan);

  header.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.className = 'page-subtitle';
  subtitle.textContent = hasData
    ? 'Welcome back'
    : 'Import your resume. Target a job. Get hired.';
  header.appendChild(subtitle);

  page.appendChild(header);

  // ── Welcome Back Banner ─────────────────────────────────
  if (hasData) {
    const banner = document.createElement('div');
    banner.className = 'glass';
    banner.style.padding = '20px 24px';
    banner.style.marginBottom = '28px';
    banner.style.maxWidth = '640px';
    banner.style.width = '100%';
    banner.style.display = 'flex';
    banner.style.alignItems = 'center';
    banner.style.justifyContent = 'space-between';
    banner.style.flexWrap = 'wrap';
    banner.style.gap = '14px';

    // Left side: green dot + message
    const bannerMsg = document.createElement('div');
    bannerMsg.style.display = 'flex';
    bannerMsg.style.alignItems = 'center';
    bannerMsg.style.gap = '10px';
    bannerMsg.style.flex = '1';

    const greenDot = document.createElement('span');
    greenDot.style.width = '10px';
    greenDot.style.height = '10px';
    greenDot.style.borderRadius = '50%';
    greenDot.style.background = 'var(--accent-green)';
    greenDot.style.flexShrink = '0';
    bannerMsg.appendChild(greenDot);

    const msgText = document.createElement('span');
    msgText.style.fontSize = '13px';
    msgText.style.color = 'var(--text-body)';
    msgText.textContent =
      'Your previous session was auto-saved \u2014 pick up where you left off or start fresh';
    bannerMsg.appendChild(msgText);

    banner.appendChild(bannerMsg);

    // Right side: buttons
    const bannerActions = document.createElement('div');
    bannerActions.style.display = 'flex';
    bannerActions.style.gap = '10px';
    bannerActions.style.alignItems = 'center';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'btn-primary btn-sm';
    continueBtn.textContent = 'Continue Editing';
    continueBtn.addEventListener('click', () => state.setPage('editor'));
    bannerActions.appendChild(continueBtn);

    // Start Over with confirmation flow
    let confirming = false;

    const startOverContainer = document.createElement('div');
    startOverContainer.style.display = 'flex';
    startOverContainer.style.gap = '8px';
    startOverContainer.style.alignItems = 'center';

    const startOverBtn = document.createElement('button');
    startOverBtn.className = 'btn-danger btn-sm';
    startOverBtn.textContent = 'Start Over';

    const confirmLabel = document.createElement('span');
    confirmLabel.style.fontSize = '12px';
    confirmLabel.style.fontWeight = '600';
    confirmLabel.style.color = 'var(--accent-rose)';
    confirmLabel.textContent = 'Clear all data?';

    const yesBtn = document.createElement('button');
    yesBtn.className = 'btn-danger btn-sm';
    yesBtn.textContent = 'Yes, Clear';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary btn-sm';
    cancelBtn.textContent = 'Cancel';

    function showDefault() {
      confirming = false;
      startOverContainer.innerHTML = '';
      startOverContainer.appendChild(startOverBtn);
    }

    function showConfirm() {
      confirming = true;
      startOverContainer.innerHTML = '';
      startOverContainer.appendChild(confirmLabel);
      startOverContainer.appendChild(yesBtn);
      startOverContainer.appendChild(cancelBtn);
    }

    startOverBtn.addEventListener('click', () => showConfirm());

    yesBtn.addEventListener('click', () => {
      state.clearAll();
      renderHome(container, state);
    });

    cancelBtn.addEventListener('click', () => showDefault());

    showDefault();

    bannerActions.appendChild(startOverContainer);
    banner.appendChild(bannerActions);
    page.appendChild(banner);
  }

  // ── Action Cards Grid ───────────────────────────────────
  const cardGrid = document.createElement('div');
  cardGrid.className = 'grid-2';
  cardGrid.style.maxWidth = '640px';
  cardGrid.style.width = '100%';
  cardGrid.style.marginBottom = '24px';

  // -- Import Resume Card --
  const importCard = document.createElement('div');
  importCard.className = 'glass';
  importCard.style.padding = '28px 24px';
  importCard.style.cursor = 'pointer';
  importCard.style.transition = 'all 0.25s ease';
  importCard.style.position = 'relative';

  importCard.addEventListener('mouseenter', () => {
    importCard.style.borderColor = 'var(--accent-teal)';
    importCard.style.boxShadow = '0 4px 20px rgba(123, 165, 165, 0.2)';
  });
  importCard.addEventListener('mouseleave', () => {
    importCard.style.borderColor = 'var(--border)';
    importCard.style.boxShadow = 'var(--shadow-sm)';
  });
  importCard.addEventListener('click', () => state.setPage('import'));

  const importIcon = document.createElement('div');
  importIcon.style.fontSize = '32px';
  importIcon.style.marginBottom = '12px';
  importIcon.textContent = '\uD83D\uDCC4';
  importCard.appendChild(importIcon);

  const importTitle = document.createElement('h3');
  importTitle.style.fontSize = '16px';
  importTitle.style.fontWeight = '700';
  importTitle.style.color = 'var(--text-primary)';
  importTitle.style.marginBottom = '8px';
  importTitle.textContent = hasData ? 'Re-Import Resume' : 'Import Resume';
  importCard.appendChild(importTitle);

  const importDesc = document.createElement('p');
  importDesc.style.fontSize = '13px';
  importDesc.style.color = 'var(--text-body)';
  importDesc.style.lineHeight = '1.5';
  importDesc.textContent =
    "Upload a PDF or TXT and we'll parse your experience, skills, and education";
  importCard.appendChild(importDesc);

  cardGrid.appendChild(importCard);

  // -- Target a Job Card --
  const targetCard = document.createElement('div');
  targetCard.className = 'glass';
  targetCard.style.padding = '28px 24px';
  targetCard.style.cursor = 'pointer';
  targetCard.style.transition = 'all 0.25s ease';
  targetCard.style.position = 'relative';
  targetCard.style.borderColor = 'rgba(123, 165, 165, 0.35)';

  targetCard.addEventListener('mouseenter', () => {
    targetCard.style.borderColor = 'var(--accent-teal)';
    targetCard.style.boxShadow = '0 4px 20px rgba(123, 165, 165, 0.2)';
  });
  targetCard.addEventListener('mouseleave', () => {
    targetCard.style.borderColor = 'rgba(123, 165, 165, 0.35)';
    targetCard.style.boxShadow = 'var(--shadow-sm)';
  });
  targetCard.addEventListener('click', () => state.setPage('target-job'));

  // RECOMMENDED badge
  const badge = document.createElement('span');
  badge.style.position = 'absolute';
  badge.style.top = '12px';
  badge.style.right = '12px';
  badge.style.background = 'linear-gradient(135deg, #7ba5a5, #8fb8c9)';
  badge.style.color = '#ffffff';
  badge.style.fontSize = '9px';
  badge.style.fontWeight = '700';
  badge.style.padding = '3px 8px';
  badge.style.borderRadius = '12px';
  badge.style.letterSpacing = '0.5px';
  badge.style.textTransform = 'uppercase';
  badge.textContent = 'RECOMMENDED';
  targetCard.appendChild(badge);

  const targetIcon = document.createElement('div');
  targetIcon.style.fontSize = '32px';
  targetIcon.style.marginBottom = '12px';
  targetIcon.textContent = '\uD83C\uDFAF';
  targetCard.appendChild(targetIcon);

  const targetTitle = document.createElement('h3');
  targetTitle.style.fontSize = '16px';
  targetTitle.style.fontWeight = '700';
  targetTitle.style.color = 'var(--text-primary)';
  targetTitle.style.marginBottom = '8px';
  targetTitle.textContent = 'Target a Job';
  targetCard.appendChild(targetTitle);

  const targetDesc = document.createElement('p');
  targetDesc.style.fontSize = '13px';
  targetDesc.style.color = 'var(--text-body)';
  targetDesc.style.lineHeight = '1.5';
  targetDesc.textContent =
    'Paste a job URL \u2014 get a fit score, skill gap analysis, and AI-powered resume tailoring';
  targetCard.appendChild(targetDesc);

  cardGrid.appendChild(targetCard);
  page.appendChild(cardGrid);

  // ── Quick Access Link ───────────────────────────────────
  const quickLink = document.createElement('a');
  quickLink.href = '#';
  quickLink.style.fontSize = '13px';
  quickLink.style.color = 'var(--text-muted)';
  quickLink.style.textDecoration = 'none';
  quickLink.style.marginBottom = '36px';
  quickLink.style.transition = 'color 0.2s ease';
  quickLink.textContent = hasData
    ? 'go to editor \u2192'
    : 'or start from scratch \u2192';

  quickLink.addEventListener('mouseenter', () => {
    quickLink.style.color = 'var(--accent-teal)';
  });
  quickLink.addEventListener('mouseleave', () => {
    quickLink.style.color = 'var(--text-muted)';
  });
  quickLink.addEventListener('click', (e) => {
    e.preventDefault();
    state.setPage('editor');
  });

  page.appendChild(quickLink);

  // ── Workflow Hint ───────────────────────────────────────
  const workflow = document.createElement('div');
  workflow.style.display = 'flex';
  workflow.style.gap = '36px';
  workflow.style.alignItems = 'flex-start';
  workflow.style.marginTop = '12px';

  const steps = [
    { num: '\u2460', label: 'Upload your resume' },
    { num: '\u2461', label: 'Paste the job posting' },
    { num: '\u2462', label: 'Apply AI suggestions' },
  ];

  steps.forEach(({ num, label }) => {
    const step = document.createElement('div');
    step.style.display = 'flex';
    step.style.flexDirection = 'column';
    step.style.alignItems = 'center';
    step.style.gap = '8px';

    const circle = document.createElement('span');
    circle.style.width = '36px';
    circle.style.height = '36px';
    circle.style.borderRadius = '50%';
    circle.style.background = 'rgba(123, 165, 165, 0.12)';
    circle.style.color = 'var(--accent-teal)';
    circle.style.display = 'flex';
    circle.style.alignItems = 'center';
    circle.style.justifyContent = 'center';
    circle.style.fontSize = '18px';
    circle.style.fontWeight = '700';
    circle.textContent = num;
    step.appendChild(circle);

    const stepLabel = document.createElement('span');
    stepLabel.style.fontSize = '12px';
    stepLabel.style.color = 'var(--text-muted)';
    stepLabel.style.fontWeight = '500';
    stepLabel.style.textAlign = 'center';
    stepLabel.textContent = label;
    step.appendChild(stepLabel);

    workflow.appendChild(step);
  });

  page.appendChild(workflow);

  container.appendChild(page);
}
