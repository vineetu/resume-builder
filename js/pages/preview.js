// preview.js — Preview page for Resume Forge SPA
// Shows live resume preview with template-specific rendering, export options,
// and analysis overlays (cultural tone, confidence scores, ghost comparison).

import { TEMPLATES, ACTION_VERBS, HR_TIPS } from '../constants.js';
import { analyzeCompanyCulture, calculateImpactScore, extractMetrics } from '../analyzer.js';
import { loadOriginalSnapshot } from '../app.js';
import { downloadPDF, downloadWord, downloadHTML, printResume } from '../export.js';

// ---------------------------------------------------------------------------
// Module-level state (not persisted)
// ---------------------------------------------------------------------------

let ghostMode = false;
let ghostSlider = 0;
let downloadMenuOpen = false;
let aiContent = null; // { summary, experiences } — filled when ghost mode used
let tipIndex = 0;
let recruiterGhostMinimized = false;

// Export reset function for clearing cache
export function resetPreviewCache() {
  ghostMode = false;
  ghostSlider = 0;
  downloadMenuOpen = false;
  aiContent = null;
  tipIndex = 0;
  recruiterGhostMinimized = false;
}

// Expose reset function on window for app.js clearAll()
window.resetPreviewCache = resetPreviewCache;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  } else if (children instanceof HTMLElement) {
    node.appendChild(children);
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

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hasNumber(text) {
  return /\d/.test(text || '');
}

function hasActionVerb(text) {
  if (!text) return false;
  const first = text.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  return ACTION_VERBS.some((v) => v.toLowerCase() === first);
}

// ---------------------------------------------------------------------------
// Cultural tone config
// ---------------------------------------------------------------------------

const CULTURE_SCORE_MAP = {
  'chaotic-startup': 95,
  'scale-up': 72,
  'mission-driven': 55,
  'consulting': 40,
  'big-tech': 35,
  'enterprise': 10,
};

const CULTURE_LABELS = {
  'chaotic-startup': { emoji: '\uD83D\uDE80', label: 'Chaotic Startup' },
  'scale-up': { emoji: '\uD83D\uDCC8', label: 'Growth Scale-Up' },
  'mission-driven': { emoji: '\uD83C\uDF0D', label: 'Mission-Driven' },
  'consulting': { emoji: '\uD83C\uDFAF', label: 'Consulting / Advisory' },
  'big-tech': { emoji: '\uD83C\uDFE2', label: 'Big Tech / FAANG' },
  'enterprise': { emoji: '\uD83C\uDFDB\uFE0F', label: 'Enterprise / Corporate' },
};

// ---------------------------------------------------------------------------
// Bullet proof / verification
// ---------------------------------------------------------------------------

function getBulletProof(exp, bullet) {
  const metrics = extractMetrics(bullet);
  const hasNum = hasNumber(bullet);
  const hasAction = hasActionVerb(bullet);
  const sourced = (exp.evidenceLinks || []).length > 0;

  let strength = 0;
  if (hasNum) strength += 35;
  if (hasAction) strength += 25;
  if (metrics.length > 0) strength += 25;
  if (sourced) strength += 15;
  strength = Math.min(strength, 100);

  const softSignals = exp.softSignals || [];
  const evidenceLinks = exp.evidenceLinks || [];
  const quantifiedTags = metrics.map((m) => m.value);
  const isWeak = strength < 35;

  return {
    strength,
    hasNumber: hasNum,
    hasAction,
    sourced,
    metrics,
    quantifiedTags,
    softSignals,
    evidenceLinks,
    isWeak,
  };
}

// ---------------------------------------------------------------------------
// Template header builders (6 styles)
// ---------------------------------------------------------------------------

function buildHeaderTopBar(data, tmpl) {
  const wrapper = el('div', { style: { marginBottom: '20px' } });

  // 4px accent bar at top
  wrapper.appendChild(
    el('div', {
      style: {
        height: '4px',
        background: tmpl.accent,
        marginBottom: '16px',
      },
    }),
  );

  // Bold name
  wrapper.appendChild(
    el('h1', {
      style: {
        fontSize: '22px',
        fontWeight: '800',
        color: '#1a1a1a',
        margin: '0 0 4px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  // Contact line
  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '11px', color: '#555', lineHeight: '1.4' },
      }, contactParts.join(' | ')),
    );
  }

  return wrapper;
}

function buildHeaderCentered(data, tmpl) {
  const wrapper = el('div', {
    style: {
      textAlign: 'center',
      marginBottom: '20px',
      paddingBottom: '14px',
      borderBottom: `2px solid ${tmpl.accent}`,
    },
  });

  wrapper.appendChild(
    el('h1', {
      style: {
        fontSize: '24px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '3px',
        color: '#1a1a1a',
        margin: '0 0 6px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '11px', color: '#555' },
      }, contactParts.join(' | ')),
    );
  }

  return wrapper;
}

function buildHeaderMinimal(data, tmpl) {
  const wrapper = el('div', { style: { marginBottom: '14px' } });

  wrapper.appendChild(
    el('h1', {
      style: {
        fontSize: '20px',
        fontWeight: '700',
        color: '#1a1a1a',
        margin: '0 0 2px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '10px', color: '#555', marginBottom: '8px' },
      }, contactParts.join(' | ')),
    );
  }

  wrapper.appendChild(
    el('div', {
      style: {
        height: '1px',
        background: '#999',
        width: '100%',
      },
    }),
  );

  return wrapper;
}

function buildHeaderSidebar(data, tmpl) {
  const wrapper = el('div', {
    style: {
      display: 'flex',
      gap: '12px',
      marginBottom: '20px',
    },
  });

  // 5px left accent bar
  wrapper.appendChild(
    el('div', {
      style: {
        width: '5px',
        background: tmpl.accent,
        borderRadius: '2px',
        flexShrink: '0',
      },
    }),
  );

  const content = el('div');

  content.appendChild(
    el('h1', {
      style: {
        fontSize: '22px',
        fontWeight: '800',
        color: tmpl.accent,
        margin: '0 0 4px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    content.appendChild(
      el('div', {
        style: { fontSize: '11px', color: '#555' },
      }, contactParts.join(' | ')),
    );
  }

  wrapper.appendChild(content);
  return wrapper;
}

function buildHeaderHero(data, tmpl) {
  const wrapper = el('div', {
    style: {
      background: `linear-gradient(135deg, ${tmpl.accent}, ${tmpl.accent}cc)`,
      padding: '28px 36px',
      marginBottom: '0',
      color: '#ffffff',
    },
  });

  wrapper.appendChild(
    el('h1', {
      style: {
        fontSize: '26px',
        fontWeight: '800',
        color: '#ffffff',
        margin: '0 0 8px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '11px', color: 'rgba(255,255,255,0.85)', marginBottom: '12px' },
      }, contactParts.join(' | ')),
    );
  }

  // Summary in the header for hero style
  if (data.summary) {
    wrapper.appendChild(
      el('p', {
        style: { fontSize: '12px', color: 'rgba(255,255,255,0.9)', lineHeight: '1.5', maxWidth: '580px' },
      }, data.summary),
    );
  }

  return wrapper;
}

function buildHeaderModern(data, tmpl) {
  const wrapper = el('div', { style: { marginBottom: '20px' } });

  wrapper.appendChild(
    el('h1', {
      style: {
        fontSize: '24px',
        fontWeight: '800',
        color: '#1a1a1a',
        margin: '0 0 6px 0',
      },
    }, data.fullName || 'Your Name'),
  );

  // 60px gradient accent line
  wrapper.appendChild(
    el('div', {
      style: {
        width: '60px',
        height: '4px',
        background: `linear-gradient(90deg, ${tmpl.accent}, ${tmpl.accent}66)`,
        borderRadius: '2px',
        marginBottom: '8px',
      },
    }),
  );

  const contactParts = [data.email, data.phone, data.location, data.linkedin, data.portfolio]
    .filter(Boolean);
  if (contactParts.length) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '11px', color: '#555' },
      }, contactParts.join(' | ')),
    );
  }

  return wrapper;
}

// ---------------------------------------------------------------------------
// Section heading builders (6 styles)
// ---------------------------------------------------------------------------

function buildSectionHeading(title, headerStyle, accent) {
  switch (headerStyle) {
    case 'topBar':
      return buildHeadingTopBar(title, accent);
    case 'centered':
      return buildHeadingCentered(title, accent);
    case 'minimal':
      return buildHeadingMinimal(title);
    case 'sidebar':
      return buildHeadingSidebar(title, accent);
    case 'hero':
      return buildHeadingHero(title, accent);
    case 'modern':
      return buildHeadingModern(title, accent);
    default:
      return buildHeadingTopBar(title, accent);
  }
}

function buildHeadingTopBar(title, accent) {
  return el('h2', {
    style: {
      fontSize: '13px',
      fontWeight: '700',
      textTransform: 'uppercase',
      color: accent,
      borderBottom: `2px solid ${accent}`,
      paddingBottom: '4px',
      marginTop: '16px',
      marginBottom: '10px',
    },
  }, title);
}

function buildHeadingCentered(title, accent) {
  return el('h2', {
    style: {
      fontSize: '13px',
      fontWeight: '700',
      textTransform: 'uppercase',
      color: accent,
      textAlign: 'center',
      borderTop: `1px solid ${accent}`,
      borderBottom: `1px solid ${accent}`,
      paddingTop: '4px',
      paddingBottom: '4px',
      marginTop: '16px',
      marginBottom: '10px',
    },
  }, title);
}

function buildHeadingMinimal(title) {
  const wrapper = el('div', { style: { marginTop: '14px', marginBottom: '8px' } });

  wrapper.appendChild(
    el('h2', {
      style: {
        fontSize: '12px',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        color: '#333',
        marginBottom: '3px',
      },
    }, title),
  );

  wrapper.appendChild(
    el('div', {
      style: { height: '0.5px', background: '#bbb', width: '100%' },
    }),
  );

  return wrapper;
}

function buildHeadingSidebar(title, accent) {
  return el('h2', {
    style: {
      fontSize: '12px',
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      color: '#ffffff',
      background: accent,
      padding: '4px 10px',
      marginTop: '16px',
      marginBottom: '10px',
    },
  }, title);
}

function buildHeadingHero(title, accent) {
  return el('h2', {
    style: {
      fontSize: '13px',
      fontWeight: '700',
      color: accent,
      borderLeft: `3px solid ${accent}`,
      paddingLeft: '10px',
      marginTop: '16px',
      marginBottom: '10px',
    },
  }, title);
}

function buildHeadingModern(title, accent) {
  const wrapper = el('div', {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginTop: '16px',
      marginBottom: '10px',
    },
  });

  wrapper.appendChild(
    el('h2', {
      style: {
        fontSize: '13px',
        fontWeight: '700',
        color: accent,
        whiteSpace: 'nowrap',
      },
    }, title),
  );

  wrapper.appendChild(
    el('div', {
      style: {
        flex: '1',
        height: '2px',
        background: `linear-gradient(90deg, ${accent}88, transparent)`,
      },
    }),
  );

  return wrapper;
}

// ---------------------------------------------------------------------------
// Template header dispatcher
// ---------------------------------------------------------------------------

function buildTemplateHeader(data, tmpl) {
  switch (tmpl.headerStyle) {
    case 'topBar':
      return buildHeaderTopBar(data, tmpl);
    case 'centered':
      return buildHeaderCentered(data, tmpl);
    case 'minimal':
      return buildHeaderMinimal(data, tmpl);
    case 'sidebar':
      return buildHeaderSidebar(data, tmpl);
    case 'hero':
      return buildHeaderHero(data, tmpl);
    case 'modern':
      return buildHeaderModern(data, tmpl);
    default:
      return buildHeaderTopBar(data, tmpl);
  }
}

// ---------------------------------------------------------------------------
// Verification tooltip builder
// ---------------------------------------------------------------------------

function createVerificationTooltip(proof) {
  const tip = el('div', {
    className: 'preview-tooltip',
    style: {
      position: 'absolute',
      bottom: '100%',
      left: '0',
      zIndex: '1000',
      background: '#1e293b',
      color: '#f1f5f9',
      borderRadius: '10px',
      padding: '14px 16px',
      fontSize: '11px',
      lineHeight: '1.5',
      width: '280px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      marginBottom: '6px',
      pointerEvents: 'none',
    },
  });

  // Title
  tip.appendChild(
    el('div', {
      style: { fontWeight: '700', fontSize: '12px', marginBottom: '10px', color: '#e2e8f0' },
    }, 'AI Verification Layer'),
  );

  // Claim Strength bar
  const strengthColor = proof.strength >= 60 ? '#7bab8e' : proof.strength >= 35 ? '#c4a265' : '#c97b7b';
  const barRow = el('div', {
    style: { marginBottom: '8px' },
  });
  barRow.appendChild(
    el('div', {
      style: { fontSize: '10px', color: '#94a3b8', marginBottom: '3px' },
    }, `Claim Strength: ${proof.strength}%`),
  );
  const barOuter = el('div', {
    style: {
      height: '5px',
      background: '#334155',
      borderRadius: '3px',
      overflow: 'hidden',
    },
  });
  barOuter.appendChild(
    el('div', {
      style: {
        height: '100%',
        width: `${proof.strength}%`,
        background: strengthColor,
        borderRadius: '3px',
        transition: 'width 0.3s ease',
      },
    }),
  );
  barRow.appendChild(barOuter);
  tip.appendChild(barRow);

  // Check items
  const checks = [
    { label: 'Action Verb', pass: proof.hasAction },
    { label: 'Quantified', pass: proof.hasNumber },
    { label: 'Sourced', pass: proof.sourced },
  ];
  const checksRow = el('div', {
    style: { display: 'flex', gap: '12px', marginBottom: '8px', flexWrap: 'wrap' },
  });
  checks.forEach(({ label, pass }) => {
    checksRow.appendChild(
      el('span', {
        style: { fontSize: '10px', color: pass ? '#7bab8e' : '#c97b7b' },
      }, `${pass ? '\u2713' : '\u2717'} ${label}`),
    );
  });
  tip.appendChild(checksRow);

  // Quantified evidence tags
  if (proof.quantifiedTags.length > 0) {
    const tagsRow = el('div', {
      style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' },
    });
    proof.quantifiedTags.forEach((tag) => {
      tagsRow.appendChild(
        el('span', {
          style: {
            background: 'rgba(123, 171, 142, 0.2)',
            color: '#7bab8e',
            padding: '1px 6px',
            borderRadius: '4px',
            fontSize: '10px',
          },
        }, tag),
      );
    });
    tip.appendChild(tagsRow);
  }

  // Evidence source links
  if (proof.evidenceLinks.length > 0) {
    const linksRow = el('div', {
      style: { marginBottom: '6px' },
    });
    linksRow.appendChild(
      el('div', {
        style: { fontSize: '10px', color: '#94a3b8', marginBottom: '2px' },
      }, 'Evidence Sources:'),
    );
    proof.evidenceLinks.forEach((link) => {
      linksRow.appendChild(
        el('div', {
          style: { fontSize: '10px', color: '#8fb8c9' },
        }, typeof link === 'string' ? link : link.url || link.label || ''),
      );
    });
    tip.appendChild(linksRow);
  }

  // Soft signals
  if (proof.softSignals.length > 0) {
    const sigRow = el('div', {
      style: { display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '6px' },
    });
    proof.softSignals.forEach((sig) => {
      sigRow.appendChild(
        el('span', {
          style: {
            background: 'rgba(155, 142, 196, 0.2)',
            color: '#9b8ec4',
            padding: '1px 6px',
            borderRadius: '4px',
            fontSize: '10px',
          },
        }, sig),
      );
    });
    tip.appendChild(sigRow);
  }

  // Weak claim warning
  if (proof.isWeak) {
    tip.appendChild(
      el('div', {
        style: {
          fontSize: '10px',
          color: '#c97b7b',
          fontStyle: 'italic',
          marginTop: '4px',
        },
      }, '\u26A0 Weak claim \u2014 consider adding metrics or evidence'),
    );
  }

  return tip;
}

// ---------------------------------------------------------------------------
// Resume section builders
// ---------------------------------------------------------------------------

function buildSummarySection(data, tmpl) {
  if (tmpl.headerStyle === 'hero') return null; // Summary is in the header
  if (!data.summary) return null;

  const section = el('div');
  section.appendChild(buildSectionHeading('Summary', tmpl.headerStyle, tmpl.accent));
  section.appendChild(
    el('p', {
      style: { fontSize: '11.5px', color: '#333', lineHeight: '1.55' },
    }, data.summary),
  );
  return section;
}

function buildExperienceSection(data, tmpl) {
  const experiences = data.experiences.filter((e) => e.company || e.title);
  if (experiences.length === 0) return null;

  const section = el('div');
  section.appendChild(buildSectionHeading('Experience', tmpl.headerStyle, tmpl.accent));

  experiences.forEach((exp) => {
    const block = el('div', { style: { marginBottom: '12px' } });

    // Title + Company line
    const titleLine = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' },
    });
    const titleText = el('span', {
      style: { fontSize: '12.5px', fontWeight: '700', color: '#1a1a1a' },
    }, exp.title || '');
    if (exp.company) {
      titleText.appendChild(
        document.createTextNode(exp.company ? ` \u2014 ${exp.company}` : ''),
      );
    }
    titleLine.appendChild(titleText);

    // Dates
    const dates = [exp.startDate, exp.current ? 'Present' : exp.endDate].filter(Boolean).join(' \u2013 ');
    if (dates) {
      titleLine.appendChild(
        el('span', {
          style: { fontSize: '10.5px', color: '#777', whiteSpace: 'nowrap' },
        }, dates),
      );
    }
    block.appendChild(titleLine);

    // Bullets with verification hover
    if (exp.bullets && exp.bullets.length) {
      const ul = el('ul', {
        style: { margin: '4px 0 0 18px', padding: '0', listStyle: 'disc' },
      });

      exp.bullets.forEach((bullet) => {
        if (!bullet.trim()) return;
        const li = el('li', {
          style: {
            fontSize: '11px',
            color: '#333',
            lineHeight: '1.5',
            marginBottom: '2px',
            position: 'relative',
          },
        }, bullet);

        // Verification tooltip on hover
        li.addEventListener('mouseenter', () => {
          // Remove any existing tooltips first
          const existing = li.querySelector('.preview-tooltip');
          if (existing) existing.remove();

          const proof = getBulletProof(exp, bullet);
          const tooltip = createVerificationTooltip(proof);
          li.appendChild(tooltip);
        });

        li.addEventListener('mouseleave', () => {
          const tooltip = li.querySelector('.preview-tooltip');
          if (tooltip) tooltip.remove();
        });

        ul.appendChild(li);
      });

      block.appendChild(ul);
    }

    section.appendChild(block);
  });

  return section;
}

function buildSkillsSection(data, tmpl) {
  const skills = data.skills || [];
  if (skills.length === 0) return null;

  const section = el('div');
  section.appendChild(buildSectionHeading('Skills', tmpl.headerStyle, tmpl.accent));

  const isTagStyle = tmpl.headerStyle === 'hero' || tmpl.headerStyle === 'modern';

  if (isTagStyle) {
    const wrap = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '5px' },
    });
    skills.forEach((skill) => {
      wrap.appendChild(
        el('span', {
          style: {
            background: `${tmpl.accent}15`,
            color: tmpl.accent,
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '10.5px',
            fontWeight: '500',
            border: `1px solid ${tmpl.accent}30`,
          },
        }, skill),
      );
    });
    section.appendChild(wrap);
  } else {
    section.appendChild(
      el('p', {
        style: { fontSize: '11px', color: '#333', lineHeight: '1.6' },
      }, skills.join(' \u2022 ')),
    );
  }

  return section;
}

function buildEducationSection(data, tmpl) {
  const education = data.education.filter((e) => e.school || e.degree);
  if (education.length === 0) return null;

  const section = el('div');
  section.appendChild(buildSectionHeading('Education', tmpl.headerStyle, tmpl.accent));

  education.forEach((edu) => {
    const block = el('div', { style: { marginBottom: '6px' } });

    const line = el('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' },
    });

    const degreeParts = [edu.degree, edu.field].filter(Boolean).join(' in ');
    const left = el('span', {
      style: { fontSize: '12px', fontWeight: '600', color: '#1a1a1a' },
    });
    left.textContent = degreeParts || '';
    if (edu.school) {
      left.appendChild(document.createTextNode(` \u2014 ${edu.school}`));
    }
    line.appendChild(left);

    if (edu.year) {
      line.appendChild(
        el('span', {
          style: { fontSize: '10.5px', color: '#777' },
        }, edu.year),
      );
    }
    block.appendChild(line);
    section.appendChild(block);
  });

  return section;
}

function buildCertificationsSection(data, tmpl) {
  const certs = data.certifications;
  if (!certs) return null;

  const certList = typeof certs === 'string'
    ? certs.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
    : Array.isArray(certs) ? certs : [];

  if (certList.length === 0) return null;

  const section = el('div');
  section.appendChild(buildSectionHeading('Certifications', tmpl.headerStyle, tmpl.accent));

  const ul = el('ul', {
    style: { margin: '0 0 0 18px', padding: '0', listStyle: 'disc' },
  });
  certList.forEach((cert) => {
    const text = typeof cert === 'string' ? cert : (cert.name || '');
    if (text) {
      ul.appendChild(
        el('li', {
          style: { fontSize: '11px', color: '#333', marginBottom: '2px' },
        }, text),
      );
    }
  });
  section.appendChild(ul);
  return section;
}

// ---------------------------------------------------------------------------
// Top bar builder
// ---------------------------------------------------------------------------

function buildTopBar(state, container) {
  const data = state.data;
  const tmplKey = data.template || 'faang';
  const tmpl = TEMPLATES[tmplKey] || TEMPLATES.faang;
  const jobContext = state.jobContext || {};
  const hasJob = !!(jobContext.jdText || jobContext.jdInfo);

  const bar = el('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      flexWrap: 'wrap',
      gap: '14px',
      marginBottom: '24px',
    },
  });

  // Left: title + subtitle
  const left = el('div');
  left.appendChild(
    el('h1', {
      style: { fontSize: '28px', fontWeight: '800', color: 'var(--text-primary)', margin: '0 0 2px 0' },
    }, 'Multiverse Preview'),
  );
  left.appendChild(
    el('p', {
      style: { fontSize: '13px', color: 'var(--text-muted)', margin: '0' },
    }, `Template: ${tmpl.name}`),
  );
  bar.appendChild(left);

  // Right: button row
  const btnRow = el('div', {
    style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
  });

  // Ghost/Comparison toggle (available when an original snapshot exists or job context is set)
  const hasOriginal = !!loadOriginalSnapshot();
  if (hasJob || hasOriginal) {
    const ghostBtn = el('button', {
      className: 'btn-secondary btn-sm',
      style: {
        background: ghostMode ? 'rgba(155, 142, 196, 0.15)' : 'transparent',
        border: ghostMode ? '1px solid rgba(155, 142, 196, 0.4)' : '1px solid var(--border)',
      },
      onClick: () => {
        ghostMode = !ghostMode;
        if (ghostMode && !aiContent) {
          const original = loadOriginalSnapshot();
          if (original) {
            // aiContent holds the "right side" data — in this case the current version
            aiContent = {
              summary: data.summary,
              experiences: data.experiences,
            };
          }
        }
        rerender(container, state);
      },
    }, ghostMode ? '\u{1F47B} Ghost: ON' : '\u{1F47B} Comparison');
    btnRow.appendChild(ghostBtn);
  }

  // Secondary nav buttons
  if (hasJob) {
    btnRow.appendChild(
      el('button', {
        className: 'btn-secondary btn-sm',
        onClick: () => state.setPage('target-job'),
      }, 'Job Fit'),
    );
  }

  btnRow.appendChild(
    el('button', {
      className: 'btn-secondary btn-sm',
      onClick: () => state.setPage('editor'),
    }, 'Edit'),
  );

  btnRow.appendChild(
    el('button', {
      className: 'btn-secondary btn-sm',
      onClick: () => state.setPage('templates'),
    }, 'Templates'),
  );

  // Pink Download Button with dropdown
  const dlContainer = el('div', { style: { position: 'relative' } });

  const dlBtn = el('button', {
    style: {
      background: 'linear-gradient(135deg, #e8708a, #db7093, #c9657e)',
      color: '#ffffff',
      border: 'none',
      borderRadius: 'var(--radius-md)',
      padding: '8px 18px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      boxShadow: '0 2px 10px rgba(219, 112, 147, 0.3)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    onClick: (e) => {
      e.stopPropagation();
      downloadMenuOpen = !downloadMenuOpen;
      rerender(container, state);
    },
  }, [
    document.createTextNode('Download'),
    el('span', {
      style: { fontSize: '10px', transform: downloadMenuOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' },
    }, '\u25BC'),
  ]);
  dlContainer.appendChild(dlBtn);

  // Dropdown menu
  if (downloadMenuOpen) {
    const menu = el('div', {
      style: {
        position: 'absolute',
        top: '100%',
        right: '0',
        marginTop: '6px',
        background: '#ffffff',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
        minWidth: '260px',
        zIndex: '100',
        padding: '6px',
        overflow: 'hidden',
      },
    });

    const menuItems = [
      {
        icon: '\uD83D\uDCC4', iconColor: '#db7093', label: 'PDF',
        desc: 'Best for job applications',
        action: () => {
          const resumeEl = document.getElementById('resume-document');
          if (resumeEl) downloadPDF(resumeEl, data.fullName || 'resume', data, tmpl.font);
          downloadMenuOpen = false;
          rerender(container, state);
        },
      },
      {
        icon: '\uD83D\uDCC3', iconColor: '#2563eb', label: 'Word / DOC',
        desc: 'Editable in Microsoft Word & Google Docs',
        action: () => {
          downloadWord(
            {
              name: data.fullName,
              email: data.email,
              phone: data.phone,
              location: data.location,
              linkedin: data.linkedin,
              website: data.portfolio,
              summary: data.summary,
              experience: data.experiences.map((e) => ({
                title: e.title,
                company: e.company,
                dates: [e.startDate, e.current ? 'Present' : e.endDate].filter(Boolean).join(' - '),
                bullets: e.bullets,
              })),
              skills: data.skills,
              education: data.education.map((e) => ({
                degree: [e.degree, e.field].filter(Boolean).join(' in '),
                school: e.school,
                dates: e.year,
              })),
              certifications: typeof data.certifications === 'string'
                ? data.certifications.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean)
                : data.certifications || [],
            },
            tmpl,
            data.fullName || 'resume',
          );
          downloadMenuOpen = false;
          rerender(container, state);
        },
      },
      {
        icon: '\uD83C\uDF10', iconColor: '#ea580c', label: 'HTML',
        desc: 'Open in any browser',
        action: () => {
          const resumeEl = document.getElementById('resume-document');
          if (resumeEl) downloadHTML(resumeEl, { name: data.fullName }, tmpl.font, data.fullName || 'resume');
          downloadMenuOpen = false;
          rerender(container, state);
        },
      },
      {
        icon: '\uD83D\uDDA8\uFE0F', iconColor: '#6b7280', label: 'Print',
        desc: 'Browser print dialog',
        action: () => {
          const resumeEl = document.getElementById('resume-document');
          if (resumeEl) printResume(resumeEl, data, tmpl.font);
          downloadMenuOpen = false;
          rerender(container, state);
        },
      },
    ];

    menuItems.forEach(({ icon, iconColor, label, desc, action }) => {
      const item = el('button', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          width: '100%',
          padding: '10px 12px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          borderRadius: 'var(--radius-md)',
          textAlign: 'left',
          transition: 'background 0.15s',
        },
        onClick: action,
        onMouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-page)'; },
        onMouseleave: (e) => { e.currentTarget.style.background = 'transparent'; },
      });

      item.appendChild(
        el('span', { style: { fontSize: '18px', color: iconColor, width: '24px', textAlign: 'center' } }, icon),
      );

      const textCol = el('div');
      textCol.appendChild(
        el('div', {
          style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' },
        }, label),
      );
      textCol.appendChild(
        el('div', {
          style: { fontSize: '11px', color: 'var(--text-muted)' },
        }, desc),
      );
      item.appendChild(textCol);

      menu.appendChild(item);
    });

    dlContainer.appendChild(menu);
  }

  btnRow.appendChild(dlContainer);
  bar.appendChild(btnRow);

  return bar;
}

// ---------------------------------------------------------------------------
// Cultural Tone Gauge
// ---------------------------------------------------------------------------

function buildCulturalToneGauge(jobContext) {
  const cultureAnalysis = analyzeCompanyCulture(jobContext.jdText || '');
  if (!cultureAnalysis.primaryCulture) return null;

  const primaryKey = cultureAnalysis.primaryCulture;
  const score = CULTURE_SCORE_MAP[primaryKey] ?? 50;
  const cultureInfo = CULTURE_LABELS[primaryKey] || { emoji: '\uD83C\uDFE2', label: primaryKey };

  const wrapper = el('div', {
    className: 'glass',
    style: {
      padding: '18px 22px',
      marginBottom: '20px',
      borderRadius: 'var(--radius-lg)',
    },
  });

  // Title row
  wrapper.appendChild(
    el('div', {
      style: { fontSize: '13px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '10px' },
    }, 'Cultural Tone Gauge'),
  );

  // Labels: Corporate <-> Startup
  const labelRow = el('div', {
    style: { display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' },
  });
  labelRow.appendChild(el('span', {}, 'Corporate'));
  labelRow.appendChild(el('span', {}, 'Startup'));
  wrapper.appendChild(labelRow);

  // Gradient bar
  const barWrapper = el('div', {
    style: {
      position: 'relative',
      height: '10px',
      borderRadius: '5px',
      background: 'linear-gradient(90deg, #9b8ec4, #8fb8c9, #7ba5a5, #c4a265, #c97b7b)',
      marginBottom: '12px',
    },
  });

  // Needle
  barWrapper.appendChild(
    el('div', {
      style: {
        position: 'absolute',
        left: `${score}%`,
        top: '-3px',
        width: '4px',
        height: '16px',
        background: '#1e293b',
        borderRadius: '2px',
        transform: 'translateX(-50%)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
      },
    }),
  );
  wrapper.appendChild(barWrapper);

  // Tone label with emoji
  wrapper.appendChild(
    el('div', {
      style: { fontSize: '14px', fontWeight: '700', color: 'var(--text-primary)', marginBottom: '4px' },
    }, `${cultureInfo.emoji} ${cultureInfo.label}`),
  );

  // Description
  if (cultureAnalysis.vibe && cultureAnalysis.vibe.desc) {
    wrapper.appendChild(
      el('div', {
        style: { fontSize: '12px', color: 'var(--text-body)', lineHeight: '1.5', marginBottom: '8px' },
      }, cultureAnalysis.vibe.desc),
    );
  }

  // Prioritized trait tags
  if (cultureAnalysis.prioritizedSignals && cultureAnalysis.prioritizedSignals.length > 0) {
    const tags = el('div', {
      style: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
    });
    cultureAnalysis.prioritizedSignals.slice(0, 8).forEach((signal) => {
      tags.appendChild(
        el('span', {
          style: {
            background: 'rgba(155, 142, 196, 0.12)',
            color: '#9b8ec4',
            padding: '2px 8px',
            borderRadius: '10px',
            fontSize: '10px',
            fontWeight: '500',
          },
        }, signal),
      );
    });
    wrapper.appendChild(tags);
  }

  return wrapper;
}

// ---------------------------------------------------------------------------
// Section Confidence Scores
// ---------------------------------------------------------------------------

function buildConfidenceScores(data, jobContext) {
  const sections = [
    { icon: '\uD83D\uDCDD', label: 'Summary', score: computeSectionScore(data.summary, jobContext) },
    { icon: '\uD83D\uDCBC', label: 'Experience', score: computeExperienceScore(data.experiences) },
    { icon: '\u26A1', label: 'Skills', score: computeSkillsScore(data.skills, jobContext) },
    { icon: '\uD83C\uDF93', label: 'Education', score: data.education.some((e) => e.school || e.degree) ? 65 : 20 },
  ];

  const grid = el('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4, 1fr)',
      gap: '12px',
      marginBottom: '20px',
    },
  });

  sections.forEach(({ icon, label, score }) => {
    const card = el('div', {
      className: 'glass',
      style: {
        padding: '14px',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
      },
    });

    card.appendChild(
      el('div', { style: { fontSize: '18px', marginBottom: '4px' } }, icon),
    );
    card.appendChild(
      el('div', {
        style: { fontSize: '11px', fontWeight: '600', color: 'var(--text-label)', marginBottom: '8px' },
      }, label),
    );

    // SVG radial ring
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', '44');
    svg.setAttribute('height', '44');
    svg.setAttribute('viewBox', '0 0 44 44');
    svg.style.margin = '0 auto 4px';
    svg.style.display = 'block';

    const circumference = 2 * Math.PI * 18;
    const offset = circumference - (score / 100) * circumference;
    const ringColor = score >= 60 ? '#7bab8e' : score >= 35 ? '#c4a265' : '#c97b7b';

    // Background circle
    const bgCircle = document.createElementNS(svgNS, 'circle');
    bgCircle.setAttribute('cx', '22');
    bgCircle.setAttribute('cy', '22');
    bgCircle.setAttribute('r', '18');
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', '#e6e1db');
    bgCircle.setAttribute('stroke-width', '3');
    svg.appendChild(bgCircle);

    // Progress circle
    const progressCircle = document.createElementNS(svgNS, 'circle');
    progressCircle.setAttribute('cx', '22');
    progressCircle.setAttribute('cy', '22');
    progressCircle.setAttribute('r', '18');
    progressCircle.setAttribute('fill', 'none');
    progressCircle.setAttribute('stroke', ringColor);
    progressCircle.setAttribute('stroke-width', '3');
    progressCircle.setAttribute('stroke-dasharray', `${circumference}`);
    progressCircle.setAttribute('stroke-dashoffset', `${offset}`);
    progressCircle.setAttribute('stroke-linecap', 'round');
    progressCircle.setAttribute('transform', 'rotate(-90 22 22)');
    svg.appendChild(progressCircle);

    // Score text
    const scoreText = document.createElementNS(svgNS, 'text');
    scoreText.setAttribute('x', '22');
    scoreText.setAttribute('y', '26');
    scoreText.setAttribute('text-anchor', 'middle');
    scoreText.setAttribute('font-size', '12');
    scoreText.setAttribute('font-weight', '700');
    scoreText.setAttribute('fill', ringColor);
    scoreText.textContent = score;
    svg.appendChild(scoreText);

    card.appendChild(svg);

    card.appendChild(
      el('div', {
        style: { fontSize: '9px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' },
      }, 'JD Match'),
    );

    grid.appendChild(card);
  });

  return grid;
}

function computeSectionScore(summary, jobContext) {
  if (!summary) return 10;
  let score = 30;
  if (summary.length > 80) score += 20;
  if (summary.length > 200) score += 10;
  if (jobContext && jobContext.jdText) {
    const jdLower = jobContext.jdText.toLowerCase();
    const words = summary.toLowerCase().split(/\s+/);
    const overlap = words.filter((w) => w.length > 4 && jdLower.includes(w)).length;
    score += Math.min(overlap * 3, 30);
  }
  return Math.min(score, 100);
}

function computeExperienceScore(experiences) {
  if (!experiences || experiences.length === 0) return 10;
  const filtered = experiences.filter((e) => e.company || e.title);
  if (filtered.length === 0) return 10;

  let total = 0;
  filtered.forEach((exp) => {
    total += calculateImpactScore(exp.bullets || []);
  });
  return Math.min(Math.round(total / filtered.length), 100);
}

function computeSkillsScore(skills, jobContext) {
  if (!skills || skills.length === 0) return 10;
  let score = Math.min(skills.length * 5, 40);
  if (jobContext && jobContext.jdText) {
    const jdLower = jobContext.jdText.toLowerCase();
    const matched = skills.filter((s) => jdLower.includes(s.toLowerCase())).length;
    score += Math.min(matched * 8, 50);
  }
  return Math.min(score, 100);
}

// ---------------------------------------------------------------------------
// Multiverse Slider (Ghost Mode)
// ---------------------------------------------------------------------------

function buildMultiverseSlider(data, container, state) {
  const wrapper = el('div', {
    className: 'glass',
    style: {
      padding: '18px 22px',
      marginBottom: '20px',
      borderRadius: 'var(--radius-lg)',
    },
  });

  // Control bar
  const controlBar = el('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '10px',
    },
  });
  controlBar.appendChild(
    el('span', {
      style: { fontSize: '11px', fontWeight: '600', color: 'var(--text-label)' },
    }, '\uD83D\uDCC4 Original Draft'),
  );
  controlBar.appendChild(
    el('span', {
      style: { fontSize: '11px', fontWeight: '600', color: '#9b8ec4' },
    }, '\u2728 AI Multiverse'),
  );
  wrapper.appendChild(controlBar);

  // Range input
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = String(ghostSlider);
  Object.assign(slider.style, {
    width: '100%',
    accentColor: '#9b8ec4',
    cursor: 'pointer',
    marginBottom: '6px',
  });
  slider.addEventListener('input', (e) => {
    ghostSlider = parseInt(e.target.value, 10);
    updateSliderUI(wrapper);
  });
  wrapper.appendChild(slider);

  // Status label
  const statusLabel = el('div', {
    className: 'slider-status',
    style: {
      fontSize: '12px',
      fontWeight: '600',
      color: 'var(--text-body)',
      textAlign: 'center',
      marginBottom: '14px',
    },
  }, getSliderLabel(ghostSlider));
  wrapper.appendChild(statusLabel);

  // Overlay container: base + ghost layers
  const overlayContainer = el('div', {
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)',
      minHeight: '200px',
      maxWidth: '800px',
    },
  });

  // Load original snapshot for the base layer; fall back to current data
  const originalData = loadOriginalSnapshot() || data;
  // The current appState data is used for the ghost (AI Multiverse) layer
  const currentData = data;

  // Base layer: original snapshot content
  const baseLayer = el('div', {
    className: 'ghost-base-layer',
    style: {
      padding: '16px',
      fontSize: '12px',
      color: '#475569',
      lineHeight: '1.55',
    },
  });
  if (originalData.summary) {
    baseLayer.appendChild(
      el('div', { style: { marginBottom: '10px' } }, [
        el('strong', {}, 'Summary: '),
        document.createTextNode(originalData.summary),
      ]),
    );
  }
  (originalData.experiences || []).filter((e) => e.title || e.company).forEach((exp) => {
    baseLayer.appendChild(
      el('div', { style: { fontWeight: '600', marginTop: '8px' } },
        `${exp.title || ''}${exp.company ? ' \u2014 ' + exp.company : ''}`),
    );
    (exp.bullets || []).forEach((b) => {
      if (b.trim()) {
        baseLayer.appendChild(el('div', { style: { paddingLeft: '12px', marginTop: '2px' } }, `\u2022 ${b}`));
      }
    });
  });
  overlayContainer.appendChild(baseLayer);

  // Ghost layer: current (edited) content
  const ghostLayer = el('div', {
    className: 'ghost-ai-layer',
    style: {
      position: 'absolute',
      top: '0',
      left: '0',
      height: '100%',
      width: `${ghostSlider}%`,
      overflow: 'hidden',
      background: 'linear-gradient(135deg, #faf9ff 0%, #f5f0ff 100%)',
      borderRight: ghostSlider > 0 && ghostSlider < 100 ? '3px solid #9b8ec4' : 'none',
      boxShadow: ghostSlider > 5 ? '4px 0 24px rgba(155,142,196,0.15)' : 'none',
      transition: 'width 0.15s ease',
    },
  });

  // Inner content wrapper — fixed width prevents text reflow as slider moves
  const ghostInner = el('div', {
    style: { width: '800px', maxWidth: 'none', padding: '16px', fontSize: '12px', lineHeight: '1.55', color: '#1e293b' },
  });

  if (currentData.summary) {
    const summaryBlock = el('div', { style: { marginBottom: '10px' } }, [
      el('strong', {}, 'Summary: '),
      document.createTextNode(currentData.summary),
    ]);
    if (currentData.summary !== originalData.summary) {
      summaryBlock.appendChild(
        el('span', {
          style: {
            background: 'rgba(155, 142, 196, 0.15)',
            color: '#9b8ec4',
            padding: '1px 6px',
            borderRadius: '4px',
            fontSize: '9px',
            fontWeight: '600',
            marginLeft: '4px',
          },
        }, '\u2728 enhanced'),
      );
    }
    ghostInner.appendChild(summaryBlock);
  }

  const currentExps = currentData.experiences || [];
  currentExps.filter((e) => e.title || e.company).forEach((exp, idx) => {
    ghostInner.appendChild(
      el('div', { style: { fontWeight: '600', marginTop: '8px' } },
        `${exp.title || ''}${exp.company ? ' \u2014 ' + exp.company : ''}`),
    );
    const origExp = (originalData.experiences || [])[idx];
    const origBullets = origExp ? origExp.bullets || [] : [];
    (exp.bullets || []).forEach((b, bi) => {
      if (!b.trim()) return;
      const changed = !origBullets[bi] || origBullets[bi] !== b;
      const line = el('div', { style: { paddingLeft: '12px', marginTop: '2px' } }, `\u2022 ${b}`);
      if (changed) {
        line.appendChild(
          el('span', {
            style: {
              background: 'rgba(155, 142, 196, 0.15)',
              color: '#9b8ec4',
              padding: '1px 6px',
              borderRadius: '4px',
              fontSize: '9px',
              fontWeight: '600',
              marginLeft: '4px',
            },
          }, '\u2728 enhanced'),
        );
      }
      ghostInner.appendChild(line);
    });
  });

  ghostLayer.appendChild(ghostInner);

  // AI MULTIVERSE badge inside ghost layer
  if (ghostSlider > 15) {
    let changeCount = 0;
    if (currentData.summary && currentData.summary !== originalData.summary) changeCount++;
    currentExps.forEach((exp, idx) => {
      const origExp = (originalData.experiences || [])[idx];
      const origBullets = origExp ? origExp.bullets || [] : [];
      (exp.bullets || []).forEach((b, bi) => {
        if (b.trim() && (!origBullets[bi] || origBullets[bi] !== b)) changeCount++;
      });
    });
    ghostLayer.appendChild(
      el('div', {
        style: {
          position: 'absolute',
          top: '8px',
          right: '8px',
          background: 'linear-gradient(135deg, #9b8ec4, #7c6faa)',
          color: '#fff',
          fontSize: '9px',
          fontWeight: '700',
          padding: '3px 10px',
          borderRadius: '999px',
          letterSpacing: '0.5px',
          zIndex: '10',
          whiteSpace: 'nowrap',
        },
      }, `AI MULTIVERSE \u00B7 ${changeCount} change${changeCount !== 1 ? 's' : ''}`),
    );
  }

  overlayContainer.appendChild(ghostLayer);

  // Draggable handle on divider line
  if (ghostSlider > 2 && ghostSlider < 98) {
    const handle = el('div', {
      className: 'ghost-drag-handle',
      style: {
        position: 'absolute',
        top: '0',
        left: `${ghostSlider}%`,
        height: '100%',
        width: '3px',
        background: '#9b8ec4',
        zIndex: '20',
        cursor: 'ew-resize',
        transform: 'translateX(-50%)',
      },
    });
    const handleCircle = el('div', {
      style: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: '#9b8ec4',
        border: '3px solid #fff',
        boxShadow: '0 2px 12px rgba(155,142,196,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: '10px',
        fontWeight: '800',
      },
    }, '\u27F7');
    handle.appendChild(handleCircle);
    overlayContainer.appendChild(handle);
  }

  wrapper.appendChild(overlayContainer);

  return wrapper;
}

function getSliderLabel(value) {
  if (value <= 5) return '\uD83D\uDCC4 Original Draft';
  if (value <= 30) return '\uD83D\uDCC4 Mostly Original';
  if (value <= 60) return '\u26A1 Blended View';
  if (value <= 85) return '\u2728 Mostly AI';
  return '\uD83D\uDE80 AI Multiverse View';
}

function updateSliderUI(wrapper) {
  const statusLabel = wrapper.querySelector('.slider-status');
  if (statusLabel) statusLabel.textContent = getSliderLabel(ghostSlider);

  const ghostLayer = wrapper.querySelector('.ghost-ai-layer');
  if (ghostLayer) {
    ghostLayer.style.width = `${ghostSlider}%`;
    ghostLayer.style.borderRight = ghostSlider > 0 && ghostSlider < 100 ? '3px solid #9b8ec4' : 'none';
    ghostLayer.style.boxShadow = ghostSlider > 5 ? '4px 0 24px rgba(155,142,196,0.15)' : 'none';
  }

  // Update the drag handle position and visibility
  const handle = wrapper.querySelector('.ghost-drag-handle');
  if (handle) {
    if (ghostSlider > 2 && ghostSlider < 98) {
      handle.style.display = 'block';
      handle.style.left = `${ghostSlider}%`;
    } else {
      handle.style.display = 'none';
    }
  }
}

// ---------------------------------------------------------------------------
// Recruiter Ghost Panel
// ---------------------------------------------------------------------------

function buildRecruiterGhostPanel(data, jobContext, rerender, container, state) {
  const experienceTips = HR_TIPS.experience || [];
  if (experienceTips.length === 0) return null;

  // Count unquantified bullets
  const unquantified = [];
  (data.experiences || []).forEach((exp) => {
    (exp.bullets || []).forEach((b) => {
      if (b.trim() && !hasNumber(b)) unquantified.push(b);
    });
  });

  if (unquantified.length === 0) return null;

  // Minimized state — show small floating button
  if (recruiterGhostMinimized) {
    const minBtn = el('div', {
      className: 'no-print',
      style: {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        background: '#1e293b',
        color: '#e2e8f0',
        borderRadius: '50%',
        width: '40px',
        height: '40px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        zIndex: '50',
        cursor: 'pointer',
        fontSize: '18px',
      },
      title: 'Show Recruiter Ghost',
      onClick: () => {
        recruiterGhostMinimized = false;
        rerender(container, state);
      },
    }, '\uD83D\uDC64');
    return minBtn;
  }

  const panel = el('div', {
    className: 'no-print',
    style: {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '280px',
      background: '#1e293b',
      color: '#e2e8f0',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
      zIndex: '50',
      fontSize: '12px',
      lineHeight: '1.5',
    },
  });

  // Header with close button
  const header = el('div', {
    style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' },
  });
  header.appendChild(el('span', { style: { fontSize: '18px' } }, '\uD83D\uDC64'));
  header.appendChild(el('span', { style: { fontWeight: '700', fontSize: '13px', flex: '1' } }, 'Recruiter Ghost'));
  header.appendChild(el('span', {
    style: {
      cursor: 'pointer',
      fontSize: '16px',
      color: '#64748b',
      lineHeight: '1',
      padding: '2px 4px',
      borderRadius: '4px',
    },
    title: 'Minimize',
    onClick: () => {
      recruiterGhostMinimized = true;
      rerender(container, state);
    },
  }, '\u2715'));
  panel.appendChild(header);

  // Unquantified count
  panel.appendChild(
    el('div', {
      style: { fontSize: '11px', color: '#c97b7b', fontWeight: '600', marginBottom: '10px' },
    }, `${unquantified.length} bullet${unquantified.length === 1 ? '' : 's'} without numbers`),
  );

  // Rotating HR tip
  const tip = experienceTips[tipIndex % experienceTips.length];
  if (tip) {
    const tipBlock = el('div', {
      style: {
        background: 'rgba(255,255,255,0.06)',
        borderRadius: 'var(--radius-md)',
        padding: '10px 12px',
        marginBottom: '8px',
      },
    });
    tipBlock.appendChild(
      el('div', {
        style: { fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', marginBottom: '4px' },
      }, tip.speaker || ''),
    );
    tipBlock.appendChild(
      el('div', {
        style: { fontSize: '11px', color: '#cbd5e1', lineHeight: '1.45' },
      }, `"${tip.tip}"`),
    );
    panel.appendChild(tipBlock);
  }

  // Hint
  panel.appendChild(
    el('div', {
      style: { fontSize: '10px', color: '#64748b', fontStyle: 'italic' },
    }, 'Hover over any bullet to see its proof score'),
  );

  return panel;
}

// ---------------------------------------------------------------------------
// Resume document builder
// ---------------------------------------------------------------------------

function buildResumeDocument(data, tmpl) {
  const isHero = tmpl.headerStyle === 'hero';

  const doc = el('div', {
    id: 'resume-document',
    style: {
      background: '#ffffff',
      boxShadow: '0 4px 32px rgba(0,0,0,0.10)',
      fontFamily: tmpl.font,
      padding: isHero ? '0' : '36px',
      maxWidth: '680px',
      margin: '0 auto',
      position: 'relative',
    },
  });

  // Template header
  doc.appendChild(buildTemplateHeader(data, tmpl));

  // Resume body (with padding for hero)
  const body = isHero
    ? el('div', { style: { padding: '24px 36px 36px' } })
    : el('div');

  // Summary
  const summary = buildSummarySection(data, tmpl);
  if (summary) body.appendChild(summary);

  // Experience
  const experience = buildExperienceSection(data, tmpl);
  if (experience) body.appendChild(experience);

  // Skills
  const skills = buildSkillsSection(data, tmpl);
  if (skills) body.appendChild(skills);

  // Education
  const education = buildEducationSection(data, tmpl);
  if (education) body.appendChild(education);

  // Certifications
  const certs = buildCertificationsSection(data, tmpl);
  if (certs) body.appendChild(certs);

  doc.appendChild(body);
  return doc;
}

// ---------------------------------------------------------------------------
// Navigation footer
// ---------------------------------------------------------------------------

function buildNavFooter(state) {
  const row = el('div', {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: '12px',
      flexWrap: 'wrap',
      marginTop: '28px',
    },
  });

  row.appendChild(
    el('button', {
      className: 'btn-secondary',
      onClick: () => state.setPage('home'),
    }, 'Back to Home'),
  );

  const rightBtns = el('div', {
    style: { display: 'flex', gap: '8px' },
  });

  rightBtns.appendChild(
    el('button', {
      className: 'btn-secondary',
      onClick: () => state.setPage('editor'),
    }, 'Edit Resume'),
  );

  rightBtns.appendChild(
    el('button', {
      className: 'btn-secondary',
      onClick: () => state.setPage('templates'),
    }, 'Change Template'),
  );

  row.appendChild(rightBtns);
  return row;
}

// ---------------------------------------------------------------------------
// Click-outside handler for download menu
// ---------------------------------------------------------------------------

function attachClickOutsideHandler(container, state) {
  const handler = (e) => {
    if (downloadMenuOpen) {
      const menu = container.querySelector('[style*="min-width: 260px"]');
      const dlBtn = menu?.parentElement?.querySelector('button');
      if (menu && !menu.contains(e.target) && dlBtn && !dlBtn.contains(e.target)) {
        downloadMenuOpen = false;
        rerender(container, state);
      }
    }
  };
  document.addEventListener('click', handler);
  // Store for cleanup
  container._clickOutsideHandler = handler;
}

function detachClickOutsideHandler(container) {
  if (container._clickOutsideHandler) {
    document.removeEventListener('click', container._clickOutsideHandler);
    container._clickOutsideHandler = null;
  }
}

// ---------------------------------------------------------------------------
// Tip rotation interval
// ---------------------------------------------------------------------------

let tipInterval = null;

function startTipRotation() {
  stopTipRotation();
  tipInterval = setInterval(() => {
    tipIndex++;
    const ghostPanel = document.querySelector('[style*="position: fixed"]');
    if (!ghostPanel) return;
    // Re-render just the tip text
    const tipBlocks = ghostPanel.querySelectorAll('[style*="rgba(255,255,255,0.06)"]');
    if (tipBlocks.length > 0) {
      const experienceTips = HR_TIPS.experience || [];
      const tip = experienceTips[tipIndex % experienceTips.length];
      if (tip && tipBlocks[0]) {
        tipBlocks[0].innerHTML = '';
        tipBlocks[0].appendChild(
          el('div', {
            style: { fontSize: '10px', color: '#94a3b8', fontStyle: 'italic', marginBottom: '4px' },
          }, tip.speaker || ''),
        );
        tipBlocks[0].appendChild(
          el('div', {
            style: { fontSize: '11px', color: '#cbd5e1', lineHeight: '1.45' },
          }, `"${tip.tip}"`),
        );
      }
    }
  }, 8000);
}

function stopTipRotation() {
  if (tipInterval) {
    clearInterval(tipInterval);
    tipInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Re-render helper
// ---------------------------------------------------------------------------

function rerender(container, state) {
  detachClickOutsideHandler(container);
  stopTipRotation();
  container.textContent = '';
  renderPreview(container, state);
}

// ---------------------------------------------------------------------------
// Main render export
// ---------------------------------------------------------------------------

export function renderPreview(container, state) {
  const data = state.data;
  const tmplKey = data.template || 'faang';
  const tmpl = TEMPLATES[tmplKey] || TEMPLATES.faang;
  const jobContext = state.jobContext || {};
  const hasJob = !!(jobContext.jdText || jobContext.jdInfo);

  const page = el('div', { className: 'page' });
  const content = el('div', { className: 'page-content' });
  page.appendChild(content);

  // 1. Top Bar
  content.appendChild(buildTopBar(state, container));

  // 2. Cultural Tone Gauge (when job context exists)
  if (hasJob) {
    const gauge = buildCulturalToneGauge(jobContext);
    if (gauge) content.appendChild(gauge);
  }

  // 3. Section Confidence Scores (when job context exists)
  if (hasJob) {
    content.appendChild(buildConfidenceScores(data, jobContext));
  }

  // 4. Multiverse Slider (Ghost Mode, when toggled)
  if (ghostMode) {
    content.appendChild(buildMultiverseSlider(data, container, state));
  }

  // 5. Resume Document
  content.appendChild(buildResumeDocument(data, tmpl));

  // 6. Recruiter Ghost Panel (fixed bottom-right)
  if (hasJob) {
    const ghostPanel = buildRecruiterGhostPanel(data, jobContext, rerender, container, state);
    if (ghostPanel) {
      page.appendChild(ghostPanel);
      startTipRotation();
    }
  }

  // 7. Navigation footer
  content.appendChild(buildNavFooter(state));

  container.appendChild(page);

  // Attach click-outside for download menu
  attachClickOutsideHandler(container, state);
}
