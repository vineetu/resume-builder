/**
 * Global progress bar — shows/hides an animated bar at the top of the page.
 * Tracks named tasks and renders a collapsible task list in the nav bar.
 */

/** @type {Map<string, {label: string, status: 'active'|'done'}>} */
const _tasks = new Map();
let _clearTimer = null;
let _dropdownOpen = false;

// ── Public API ──────────────────────────────────────────────────────────

export function showProgress(label = 'Working...') {
  clearTimeout(_clearTimer);
  _tasks.set(label, { label, status: 'active' });
  _syncUI();
}

export function hideProgress(label = 'Working...') {
  const entry = _tasks.get(label);
  if (entry) {
    entry.status = 'done';
  }
  _syncUI();

  const allDone = [..._tasks.values()].every((t) => t.status === 'done');
  if (allDone && _tasks.size > 0) {
    _clearTimer = setTimeout(() => {
      _tasks.clear();
      _dropdownOpen = false;
      _syncUI();
    }, 2000);
  }
}

// ── DOM helpers ─────────────────────────────────────────────────────────

function _syncUI() {
  // Animated bar at top
  const bar = document.getElementById('global-progress');
  if (bar) {
    const hasActive = [..._tasks.values()].some((t) => t.status === 'active');
    if (_tasks.size > 0 && hasActive) {
      bar.classList.add('active');
    } else {
      bar.classList.remove('active');
    }
  }

  // Pill in nav bar
  _renderPill();
}

function _renderPill() {
  const mount = document.getElementById('progress-pill-mount');
  if (!mount) return;

  let pill = mount.querySelector('.progress-pill');
  if (!pill) {
    pill = document.createElement('div');
    pill.className = 'progress-pill';
    pill.addEventListener('click', (e) => {
      e.stopPropagation();
      _dropdownOpen = !_dropdownOpen;
      _renderPill();
    });
    mount.appendChild(pill);

    document.addEventListener('click', () => {
      if (_dropdownOpen) {
        _dropdownOpen = false;
        _renderPill();
      }
    });
  }

  if (_tasks.size === 0) {
    pill.style.display = 'none';
    return;
  }
  pill.style.display = 'flex';

  const activeCount = [..._tasks.values()].filter((t) => t.status === 'active').length;
  const doneCount = [..._tasks.values()].filter((t) => t.status === 'done').length;
  const total = _tasks.size;

  // Label
  let pillLabel = pill.querySelector('.progress-pill-label');
  if (!pillLabel) {
    pillLabel = document.createElement('span');
    pillLabel.className = 'progress-pill-label';
    pill.appendChild(pillLabel);
  }

  // Caret
  let pillCaret = pill.querySelector('.progress-pill-caret');
  if (!pillCaret) {
    pillCaret = document.createElement('span');
    pillCaret.className = 'progress-pill-caret';
    pillCaret.textContent = '\u25BE';
    pill.appendChild(pillCaret);
  }

  if (activeCount > 0) {
    pillLabel.textContent = `${activeCount} task${activeCount > 1 ? 's' : ''} running`;
  } else {
    pillLabel.textContent = `${doneCount}/${total} done`;
  }

  pillCaret.classList.toggle('open', _dropdownOpen);

  // Dropdown
  let dropdown = pill.querySelector('.progress-dropdown');
  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.className = 'progress-dropdown';
    pill.appendChild(dropdown);
  }

  dropdown.style.display = _dropdownOpen ? '' : 'none';
  dropdown.innerHTML = '';

  for (const [, task] of _tasks) {
    const row = document.createElement('div');
    row.className = 'progress-task ' + (task.status === 'done' ? 'task-done' : 'task-active');

    const icon = document.createElement('span');
    icon.className = 'progress-task-icon';
    icon.textContent = task.status === 'done' ? '\u2713' : '\u25CB';

    const text = document.createElement('span');
    text.className = 'progress-task-text';
    text.textContent = task.label;

    row.appendChild(icon);
    row.appendChild(text);
    dropdown.appendChild(row);
  }
}
