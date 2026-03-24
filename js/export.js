/**
 * Resume export functions — PDF, Word, HTML, and Print.
 *
 * All download helpers follow the same pattern:
 *   1. Build content (Blob)
 *   2. Create an object URL
 *   3. Click a temporary anchor to trigger the download
 *   4. Revoke the URL
 *
 * @module export
 */

// CDN URLs for export libraries
const HTML2CANVAS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const JSPDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const JSPDF_HTML_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

/**
 * Ensure html2canvas and jsPDF are available, following the ensurePdfJs pattern.
 * Waits for CDN scripts to load, with dynamic loading fallback if needed.
 */
// Helper function to find jsPDF constructor in various possible locations
function getJsPDFConstructor() {
  // Check common locations where jsPDF might be exposed
  const possibleLocations = [
    window.jsPDF,
    window.jspdf,           // Found in debug - it's lowercase!
    window.jsPDF && window.jsPDF.jsPDF,
    window.JSPDF,
    window.JsPdf,
    // Also check if it's nested under jspdf
    window.jspdf && window.jspdf.jsPDF,
    // Check for the actual constructor class
    window.jspdf && window.jspdf.default
  ];

  for (let i = 0; i < possibleLocations.length; i++) {
    const location = possibleLocations[i];
    if (typeof location === 'function') {
      console.log('📍 Found jsPDF constructor at index', i, ':', location.name || 'unnamed function');
      return location;
    }
  }

  // If none found as direct functions, check what's actually in window.jspdf
  if (window.jspdf) {
    console.log('🔍 Investigating window.jspdf contents:', Object.keys(window.jspdf));
    console.log('🔍 window.jspdf type:', typeof window.jspdf);

    // Check if it's a module with default export
    if (window.jspdf.default && typeof window.jspdf.default === 'function') {
      console.log('📍 Found jsPDF constructor in window.jspdf.default');
      return window.jspdf.default;
    }

    // Check if the whole jspdf object is the constructor
    if (typeof window.jspdf === 'function') {
      console.log('📍 window.jspdf itself is the constructor');
      return window.jspdf;
    }
  }

  return null;
}

async function ensureExportLibs() {
  console.log('🔍 Checking fallback export libraries availability...');
  console.log('html2canvas available:', !!window.html2canvas);

  const jsPDFConstructor = getJsPDFConstructor();
  console.log('jsPDF constructor available:', !!jsPDFConstructor);

  // Check if already loaded
  if (window.html2canvas && jsPDFConstructor) {
    console.log('✅ Fallback libraries already available');
    // Store the constructor reference for later use
    window._jsPDFConstructor = jsPDFConstructor;
    return;
  }

  console.log('⏳ Waiting for CDN scripts to load...');

  // Wait for CDN scripts with polling
  const maxWaitTime = 10000; // 10 seconds
  const pollInterval = 100;   // Check every 100ms
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    const jsPDFConstructor = getJsPDFConstructor();
    if (window.html2canvas && jsPDFConstructor) {
      const waitTime = Date.now() - startTime;
      console.log(`✅ Fallback libraries became available after ${waitTime}ms`);
      window._jsPDFConstructor = jsPDFConstructor;
      return;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  console.warn('⚠️ Fallback libraries not available after 10s, attempting dynamic loading...');

  // If still not available, try dynamic loading
  const missingLibs = [];
  if (!window.html2canvas) missingLibs.push({ name: 'html2canvas', url: HTML2CANVAS_CDN });
  if (!getJsPDFConstructor()) missingLibs.push({ name: 'jsPDF', url: JSPDF_CDN });

  for (const lib of missingLibs) {
    console.log(`🔄 Loading ${lib.name} dynamically from ${lib.url}`);
    await loadLibraryScript(lib.url, lib.name);
  }

  // Final validation
  const finalJsPDFConstructor = getJsPDFConstructor();
  if (!window.html2canvas || !finalJsPDFConstructor) {
    console.error('❌ Fallback export libraries not available after all loading attempts');
    console.log('Final state - html2canvas:', !!window.html2canvas, 'jsPDF constructor:', !!finalJsPDFConstructor);
    console.log('Available window properties containing "pdf" or "PDF":',
      Object.keys(window).filter(key => key.toLowerCase().includes('pdf')));
    throw new Error('Fallback export libraries not available after loading attempts');
  }

  window._jsPDFConstructor = finalJsPDFConstructor;

  console.log('✅ All fallback export libraries are now available');
}

/**
 * Dynamically load a script and wait for global availability.
 */
async function loadLibraryScript(url, globalName) {
  await new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${globalName} from ${url}`));
    document.head.appendChild(script);
  });

  console.log(`📦 Script loaded for ${globalName}, checking for global availability...`);

  // Wait for global to be available (with enhanced detection for jsPDF)
  let attempts = 0;
  const maxAttempts = 50; // 5 seconds at 100ms intervals

  while (attempts < maxAttempts) {
    let isAvailable = false;

    if (globalName === 'jsPDF') {
      isAvailable = !!getJsPDFConstructor();
      if (!isAvailable && attempts % 10 === 0) {
        // Debug: show what's actually available every 1 second
        console.log('🔍 Available window properties containing "pdf":',
          Object.keys(window).filter(key => key.toLowerCase().includes('pdf')));
      }
    } else {
      isAvailable = !!window[globalName];
    }

    if (isAvailable) {
      console.log(`✅ ${globalName} is now available after ${attempts * 100}ms`);
      return;
    }

    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }

  throw new Error(`${globalName} loaded but not found on window after ${maxAttempts * 100}ms`);
}

// ---------------------------------------------------------------------------
// downloadPDF(resumeElement, fileName) — async
// ---------------------------------------------------------------------------

/**
 * Export the resume as a PDF using browser's native print-to-PDF.
 * Opens the resume in a clean new window and triggers print dialog.
 * User can save as PDF which generates vector text, not images.
 *
 * @param {HTMLElement} resumeElement - The DOM node to capture.
 * @param {string} fileName - Base name for the downloaded file.
 * @param {Object} data - Resume data object (optional, for page title).
 * @param {string} templateFont - Font family for the resume (optional).
 */
export async function downloadPDF(resumeElement, fileName, data = null, templateFont = null) {
  console.log('🔄 Starting browser-native PDF export...');

  try {
    console.log('🪟 Opening resume in new window for PDF generation...');

    // Build a clean HTML version optimized for PDF
    const resumeHTML = buildPDFOptimizedHTML(resumeElement, data, templateFont, fileName);

    // Open new window with the resume
    const printWindow = window.open('', '_blank', 'width=8.5in,height=11in');
    if (!printWindow) {
      throw new Error('Failed to open print window. Please allow popups for this site.');
    }

    printWindow.document.write(resumeHTML);
    printWindow.document.close();

    // Wait for content to load, then focus and print
    printWindow.onload = () => {
      printWindow.focus();

      // Add download instruction
      const instruction = printWindow.document.createElement('div');
      instruction.id = 'pdf-instruction';
      instruction.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        right: 10px;
        background: #0066cc;
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: system-ui, sans-serif;
        font-size: 14px;
        font-weight: 600;
        text-align: center;
        z-index: 1000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      `;
      instruction.innerHTML = `
        📄 <strong>PDF Export:</strong> Use Ctrl+P (or Cmd+P) → Change "Destination" to "Save as PDF" → Click Save
        <button onclick="window.print(); document.getElementById('pdf-instruction').remove();"
                style="margin-left: 12px; padding: 4px 12px; background: white; color: #0066cc; border: none; border-radius: 4px; font-weight: 600; cursor: pointer;">
          Open Print Dialog
        </button>
      `;

      printWindow.document.body.insertBefore(instruction, printWindow.document.body.firstChild);

      // Auto-trigger print dialog after short delay
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };

    console.log('✅ PDF export window opened successfully!');

  } catch (err) {
    console.error('❌ PDF export failed:', err);

    const errorMessage = err.message || 'Unknown error';
    if (errorMessage.includes('Failed to open print window')) {
      alert('PDF export failed: Please allow popups for this site and try again.');
    } else {
      console.error('💡 Falling back to print dialog...');
      alert('PDF export failed. Using fallback print method.');

      // Use the regular print approach
      try {
        const resumeHTML = buildResumeHTML(resumeElement, data, templateFont);
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(resumeHTML);
          printWindow.document.close();
          printWindow.onload = () => {
            printWindow.focus();
            printWindow.print();
            setTimeout(() => printWindow.close(), 1000);
          };
        } else {
          window.print();
        }
      } catch (printErr) {
        console.error('Print fallback failed:', printErr);
        window.print();
      }
    }
  }
}


// ---------------------------------------------------------------------------
// downloadWord(data, templateConfig, fileName)
// ---------------------------------------------------------------------------

/**
 * Export resume data as a Word-compatible HTML file (.doc).
 *
 * Builds a full HTML document with Office XML namespaces so that Word can
 * open and render it correctly. Includes a BOM prefix for encoding compat.
 *
 * @param {Object} data - Resume data (header, summary, experience, skills, education, certifications).
 * @param {Object} templateConfig - Template settings (accentColor, fontFamily, etc.).
 * @param {string} fileName - Base name for the downloaded file.
 */
export function downloadWord(data, templateConfig, fileName) {
  const accent = (templateConfig && (templateConfig.accentColor || templateConfig.accent)) || '#2c5282';
  const font = (templateConfig && (templateConfig.fontFamily || templateConfig.font)) || 'Calibri, sans-serif';

  const html = `
<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>
  body { font-family: ${font}; font-size: 11pt; color: #222; margin: 1in; }
  h1 { font-size: 22pt; color: ${accent}; margin: 0 0 4pt 0; }
  h2 { font-size: 14pt; color: ${accent}; border-bottom: 1pt solid ${accent}; padding-bottom: 2pt; margin: 14pt 0 6pt 0; }
  h3 { font-size: 12pt; margin: 6pt 0 2pt 0; }
  p  { margin: 2pt 0; }
  ul { margin: 4pt 0 8pt 18pt; padding: 0; }
  li { margin: 2pt 0; }
  .subtitle { color: #555; font-size: 10pt; }
  .contact  { color: #555; font-size: 10pt; margin-bottom: 8pt; }
</style>
</head>
<body>
${_buildWordHeader(data)}
${_buildWordSummary(data)}
${_buildWordExperience(data)}
${_buildWordSkills(data)}
${_buildWordEducation(data)}
${_buildWordCertifications(data)}
</body>
</html>`.trim();

  // BOM prefix for Word compatibility
  const bom = '\uFEFF';
  const blob = new Blob([bom + html], {
    type: 'application/msword;charset=utf-8',
  });

  _triggerDownload(blob, `${_sanitizeFileName(fileName)}_resume.doc`);
}

// ---------------------------------------------------------------------------
// Word section builders
// ---------------------------------------------------------------------------

function _buildWordHeader(data) {
  if (!data) return '';
  const name = _esc(data.name || '');
  const parts = [data.email, data.phone, data.location, data.linkedin, data.website]
    .filter(Boolean)
    .map(_esc);

  return `<h1>${name}</h1>\n` +
    (parts.length ? `<p class="contact">${parts.join(' | ')}</p>\n` : '');
}

function _buildWordSummary(data) {
  if (!data || !data.summary) return '';
  return `<h2>Summary</h2>\n<p>${_esc(data.summary)}</p>\n`;
}

function _buildWordExperience(data) {
  if (!data || !data.experience || !data.experience.length) return '';
  let html = '<h2>Experience</h2>\n';
  for (const job of data.experience) {
    const title = _esc(job.title || '');
    const company = _esc(job.company || '');
    const dates = _esc(job.dates || job.date || '');
    html += `<h3>${title}${company ? ' — ' + company : ''}</h3>\n`;
    if (dates) html += `<p class="subtitle">${dates}</p>\n`;
    if (job.bullets && job.bullets.length) {
      html += '<ul>\n';
      for (const b of job.bullets) {
        html += `  <li>${_esc(b)}</li>\n`;
      }
      html += '</ul>\n';
    }
    if (job.description) {
      html += `<p>${_esc(job.description)}</p>\n`;
    }
  }
  return html;
}

function _buildWordSkills(data) {
  if (!data || !data.skills) return '';
  const skills = Array.isArray(data.skills) ? data.skills : [data.skills];
  if (!skills.length) return '';
  return `<h2>Skills</h2>\n<p>${skills.map(_esc).join(', ')}</p>\n`;
}

function _buildWordEducation(data) {
  if (!data || !data.education || !data.education.length) return '';
  let html = '<h2>Education</h2>\n';
  for (const edu of data.education) {
    const degree = _esc(edu.degree || '');
    const school = _esc(edu.school || edu.institution || '');
    const dates = _esc(edu.dates || edu.date || '');
    html += `<h3>${degree}${school ? ' — ' + school : ''}</h3>\n`;
    if (dates) html += `<p class="subtitle">${dates}</p>\n`;
  }
  return html;
}

function _buildWordCertifications(data) {
  if (!data || !data.certifications || !data.certifications.length) return '';
  let html = '<h2>Certifications</h2>\n<ul>\n';
  for (const cert of data.certifications) {
    const text = typeof cert === 'string' ? cert : (cert.name || '');
    html += `  <li>${_esc(text)}</li>\n`;
  }
  html += '</ul>\n';
  return html;
}

// ---------------------------------------------------------------------------
// downloadHTML(resumeElement, data, templateFont, fileName)
// ---------------------------------------------------------------------------

/**
 * Export the resume as a standalone HTML file.
 *
 * Clones the resume element, strips interactive overlays and tooltips,
 * wraps it in a complete HTML document with inline styles, and triggers
 * a download.
 *
 * @param {HTMLElement} resumeElement - The live resume DOM node.
 * @param {Object} data - Resume data object (used for <title>).
 * @param {string} templateFont - Font family string for the template.
 * @param {string} fileName - Base name for the downloaded file.
 */
export function downloadHTML(resumeElement, data, templateFont, fileName) {
  const htmlString = buildResumeHTML(resumeElement, data, templateFont);
  const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
  _triggerDownload(blob, `${_sanitizeFileName(fileName)}_resume.html`);
}

// ---------------------------------------------------------------------------
// printResume()
// ---------------------------------------------------------------------------

/**
 * Trigger the browser's native print dialog for just the resume content.
 * Opens the resume in a clean new window to avoid printing page chrome.
 *
 * @param {HTMLElement} resumeElement - The DOM node to print.
 * @param {Object} data - Resume data object (optional, for page title).
 * @param {string} templateFont - Font family for the resume (optional).
 */
export function printResume(resumeElement, data = null, templateFont = null) {
  try {
    console.log('🖨️ Opening resume in new window for printing...');

    // Build a clean HTML version of the resume
    const resumeHTML = buildResumeHTML(resumeElement, data, templateFont);

    // Open new window for printing
    const printWindow = window.open('', '_blank', 'width=800,height=1000');
    if (!printWindow) {
      console.warn('⚠️ Failed to open print window, falling back to current window print');
      window.print();
      return;
    }

    printWindow.document.write(resumeHTML);
    printWindow.document.close();

    // Wait for content to load, then print
    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();

      // Close window after printing (with delay to ensure print dialog shows)
      setTimeout(() => {
        printWindow.close();
      }, 1000);
    };

  } catch (err) {
    console.error('❌ Print failed:', err);
    console.log('💡 Falling back to window.print()...');
    window.print();
  }
}

// ---------------------------------------------------------------------------
// buildPDFOptimizedHTML(resumeElement, data, font, fileName)
// ---------------------------------------------------------------------------

/**
 * Build a PDF-optimized HTML string from a resume element.
 * Includes enhanced print styles and instructions for PDF generation.
 *
 * @param {HTMLElement} resumeElement - The live DOM node to export.
 * @param {Object} data - Resume data (used for page title).
 * @param {string} font - Font family string.
 * @param {string} fileName - File name for the PDF.
 * @returns {string} Complete HTML document optimized for PDF export.
 */
export function buildPDFOptimizedHTML(resumeElement, data, font, fileName) {
  const clone = resumeElement.cloneNode(true);

  // Remove interactive / non-print elements
  const removeSelectors = [
    '.tooltip',
    '.linter-panel',
    '[data-interactive]',
    '.overlay',
    '.edit-controls',
    '.hover-toolbar',
    'button',
    '.no-print',
    '.ghost-drag-handle',
    '.preview-tooltip',
  ];
  for (const selector of removeSelectors) {
    const nodes = clone.querySelectorAll(selector);
    nodes.forEach((node) => node.remove());
  }

  const name = (data && data.name) || (data && data.fullName) || 'Resume';
  const fontFamily = font || 'system-ui, sans-serif';
  const pdfFileName = fileName || 'resume';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(name)} — Resume PDF Export</title>
<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: ${fontFamily};
    color: #222;
    background: #fff;
    padding: 0;
    line-height: 1.5;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* PDF-optimized print styles */
  @media print {
    body {
      padding: 0;
      margin: 0;
    }

    @page {
      margin: 0.5in;
      size: letter;
    }

    /* Hide the instruction banner when printing */
    #pdf-instruction {
      display: none !important;
    }

    /* Ensure resume content prints properly */
    #resume-document {
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
    }

    /* Prevent page breaks in bad places */
    h1, h2, h3 {
      page-break-after: avoid;
      break-after: avoid;
    }

    /* Keep sections together when possible */
    .experience-block, .education-block {
      page-break-inside: avoid;
      break-inside: avoid;
    }
  }

  @media screen {
    body {
      padding: 20px;
    }

    #resume-document {
      max-width: 8.5in;
      margin: 40px auto;
      padding: 0.5in;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      background: white;
    }
  }

  a {
    color: inherit;
    text-decoration: none;
  }

  /* Ensure all content is visible */
  .no-print,
  .ghost-drag-handle,
  .preview-tooltip,
  .linter-panel,
  button {
    display: none !important;
  }
</style>
</head>
<body>
  <!-- PDF content will be inserted here by JavaScript -->
  ${clone.outerHTML}

  <script>
    // Set document title for PDF filename suggestion
    document.title = '${_esc(pdfFileName)}_resume';

    // Optimize for printing
    window.addEventListener('beforeprint', function() {
      console.log('Preparing for PDF export...');

      // Remove any remaining interactive elements
      const interactiveElements = document.querySelectorAll('button, .tooltip, .overlay');
      interactiveElements.forEach(el => el.style.display = 'none');

      // Ensure proper page layout
      document.body.style.margin = '0';
      document.body.style.padding = '0';
    });

    window.addEventListener('afterprint', function() {
      console.log('PDF export completed');
    });
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// buildResumeHTML(resumeElement, data, font)
// ---------------------------------------------------------------------------

/**
 * Build a clean, print-ready HTML string from a live resume DOM element.
 *
 * Steps:
 *  1. Deep-clone the element.
 *  2. Remove tooltips, linter panels, and other interactive overlays.
 *  3. Wrap in a complete HTML document with inline print styles.
 *
 * @param {HTMLElement} resumeElement - The live DOM node to export.
 * @param {Object} data - Resume data (used for page title).
 * @param {string} font - Font family string.
 * @returns {string} Complete HTML document string.
 */
export function buildResumeHTML(resumeElement, data, font) {
  const clone = resumeElement.cloneNode(true);

  // Remove interactive / non-print elements
  const removeSelectors = [
    '.tooltip',
    '.linter-panel',
    '[data-interactive]',
    '.overlay',
    '.edit-controls',
    '.hover-toolbar',
    'button',
  ];
  for (const selector of removeSelectors) {
    const nodes = clone.querySelectorAll(selector);
    nodes.forEach((node) => node.remove());
  }

  const name = (data && data.name) || 'Resume';
  const fontFamily = font || 'system-ui, sans-serif';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${_esc(name)} — Resume</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${fontFamily};
    color: #222;
    background: #fff;
    padding: 0.5in;
    line-height: 1.5;
  }

  /* Hide any non-print elements */
  .no-print,
  .ghost-drag-handle,
  .preview-tooltip,
  .linter-panel,
  button {
    display: none !important;
  }

  @media print {
    body { padding: 0; }
    @page { margin: 0.5in; }
    .no-print,
    .ghost-drag-handle,
    .preview-tooltip,
    .linter-panel,
    button {
      display: none !important;
    }
  }

  @media screen {
    body {
      max-width: 8.5in;
      margin: 0 auto;
    }
  }

  a { color: inherit; text-decoration: none; }
  /* Preserve the resume element's own styles */
</style>
</head>
<body>
${clone.outerHTML}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Trigger a file download by creating a temporary anchor element.
 *
 * @param {Blob} blob - File content.
 * @param {string} filename - Download file name.
 */
function _triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Escape HTML special characters to prevent injection.
 *
 * @param {string} str
 * @returns {string}
 */
function _esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sanitize a file name by removing characters that are problematic
 * on common file systems.
 *
 * @param {string} name
 * @returns {string}
 */
function _sanitizeFileName(name) {
  if (!name) return 'untitled';
  return String(name)
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 100) || 'untitled';
}
