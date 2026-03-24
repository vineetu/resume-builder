// settings.js — Settings page for cache management and system controls

import { clearGeminiCache } from '../gemini.js';
import { appState, getApiKey, setApiKey } from '../app.js';

// ── Cache utilities ──────────────────────────────────────────────────────────

function calculateStorageSize() {
  let totalSize = 0;
  const sizes = {
    localStorage: 0,
    sessionStorage: 0,
    geminiCache: 0
  };

  // Calculate localStorage size
  for (const key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      const value = localStorage.getItem(key);
      if (value) {
        sizes.localStorage += key.length + value.length;
      }
    }
  }

  // Calculate sessionStorage size (including Gemini cache)
  for (const key in sessionStorage) {
    if (sessionStorage.hasOwnProperty(key)) {
      const value = sessionStorage.getItem(key);
      if (value) {
        const itemSize = key.length + value.length;
        sizes.sessionStorage += itemSize;

        // Track Gemini cache specifically
        if (key.startsWith('gemini_cache_')) {
          sizes.geminiCache += itemSize;
        }
      }
    }
  }

  sizes.total = sizes.localStorage + sizes.sessionStorage;
  return sizes;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getGeminiCacheStats() {
  const cacheIndex = sessionStorage.getItem('gemini_cache_index');
  const entries = cacheIndex ? JSON.parse(cacheIndex) : [];
  return {
    entryCount: entries.length,
    maxEntries: 20
  };
}

// ── Settings page renderer ──────────────────────────────────────────────────

export function renderSettings(container, state) {
  const sizes = calculateStorageSize();
  const cacheStats = getGeminiCacheStats();
  const currentApiKey = getApiKey();

  container.innerHTML = `
    <div class="page-container">
      <div class="page-header">
        <h1>Settings</h1>
        <p class="page-subtitle">Manage your app data, cache, and preferences</p>
      </div>

      <div class="settings-grid">
        <!-- Storage & Cache Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>Storage & Cache</h3>
            <div class="storage-usage-badge">
              ${formatBytes(sizes.total)} used
            </div>
          </div>

          <div class="storage-breakdown">
            <div class="storage-item">
              <div class="storage-item-header">
                <span class="storage-label">Resume Data</span>
                <span class="storage-size">${formatBytes(sizes.localStorage)}</span>
              </div>
              <div class="storage-bar">
                <div class="storage-bar-fill" style="width: ${Math.max(5, (sizes.localStorage / sizes.total) * 100)}%"></div>
              </div>
            </div>

            <div class="storage-item">
              <div class="storage-item-header">
                <span class="storage-label">AI Cache</span>
                <span class="storage-size">${formatBytes(sizes.geminiCache)}</span>
              </div>
              <div class="storage-bar">
                <div class="storage-bar-fill gemini-cache" style="width: ${Math.max(5, (sizes.geminiCache / sizes.total) * 100)}%"></div>
              </div>
              <div class="storage-detail">
                ${cacheStats.entryCount} / ${cacheStats.maxEntries} cache entries
              </div>
            </div>

            <div class="storage-item">
              <div class="storage-item-header">
                <span class="storage-label">Other Session Data</span>
                <span class="storage-size">${formatBytes(sizes.sessionStorage - sizes.geminiCache)}</span>
              </div>
              <div class="storage-bar">
                <div class="storage-bar-fill other-data" style="width: ${Math.max(5, ((sizes.sessionStorage - sizes.geminiCache) / sizes.total) * 100)}%"></div>
              </div>
            </div>
          </div>

          <div class="settings-actions">
            <button id="clear-cache-btn" class="btn-secondary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                <line x1="10" y1="11" x2="10" y2="17"/>
                <line x1="14" y1="11" x2="14" y2="17"/>
              </svg>
              Clear AI Cache
            </button>
            <div class="cache-info">
              Clears ${cacheStats.entryCount} cached AI responses
            </div>
          </div>
        </div>

        <!-- API Key Section -->
        <div class="settings-card">
          <div class="settings-card-header">
            <h3>Gemini API Key</h3>
            <div class="api-status ${currentApiKey ? 'connected' : 'not-connected'}">
              ${currentApiKey ? 'Connected' : 'Not Set'}
            </div>
          </div>

          <div class="api-key-section">
            <div class="api-key-input-group">
              <input
                type="password"
                id="api-key-input"
                class="glass-input"
                placeholder="AIzaSy..."
                value="${currentApiKey}"
                style="font-family: monospace; font-size: 13px;"
              >
              <button id="toggle-key-visibility" class="btn-icon" type="button">
                <svg id="eye-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>

            <div class="api-key-actions">
              <button id="save-api-key" class="btn-primary">Save Key</button>
              <button id="remove-api-key" class="btn-outline" ${!currentApiKey ? 'disabled' : ''}>Remove Key</button>
            </div>

            <div class="api-key-help">
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
                Get your free API key at aistudio.google.com/apikey ↗
              </a>
            </div>
          </div>
        </div>

        <!-- Data Management Section -->
        <div class="settings-card danger-card">
          <div class="settings-card-header">
            <h3>Data Management</h3>
            <div class="danger-badge">Destructive Actions</div>
          </div>

          <div class="danger-actions">
            <div class="danger-action">
              <div class="danger-action-info">
                <h4>Start Over</h4>
                <p>Clear all resume data, job context, and cached AI responses. This cannot be undone.</p>
              </div>
              <button id="start-over-btn" class="btn-danger">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                  <path d="M21 3v5h-5"/>
                  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                  <path d="M3 21v-5h5"/>
                </svg>
                Start Over
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Event listeners
  setupSettingsEventListeners();
}

function setupSettingsEventListeners() {
  // Clear cache button
  const clearCacheBtn = document.getElementById('clear-cache-btn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', () => {
      clearGeminiCache();
      // Refresh the page to show updated cache stats
      window.location.hash = '#settings';
      window.location.reload();
    });
  }

  // API key visibility toggle
  const toggleVisibility = document.getElementById('toggle-key-visibility');
  const apiKeyInput = document.getElementById('api-key-input');
  if (toggleVisibility && apiKeyInput) {
    toggleVisibility.addEventListener('click', () => {
      const isPassword = apiKeyInput.type === 'password';
      apiKeyInput.type = isPassword ? 'text' : 'password';

      const eyeIcon = document.getElementById('eye-icon');
      if (eyeIcon) {
        eyeIcon.innerHTML = isPassword
          ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'
          : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
      }
    });
  }

  // Save API key
  const saveApiKeyBtn = document.getElementById('save-api-key');
  if (saveApiKeyBtn && apiKeyInput) {
    saveApiKeyBtn.addEventListener('click', () => {
      const newKey = apiKeyInput.value.trim();
      setApiKey(newKey);

      // Show success feedback
      saveApiKeyBtn.textContent = 'Saved!';
      saveApiKeyBtn.disabled = true;
      setTimeout(() => {
        saveApiKeyBtn.textContent = 'Save Key';
        saveApiKeyBtn.disabled = false;
        // Refresh to update connection status
        window.location.reload();
      }, 1000);
    });
  }

  // Remove API key
  const removeApiKeyBtn = document.getElementById('remove-api-key');
  if (removeApiKeyBtn) {
    removeApiKeyBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to remove your API key? AI features will be disabled.')) {
        setApiKey('');
        window.location.reload();
      }
    });
  }

  // Start over button
  const startOverBtn = document.getElementById('start-over-btn');
  if (startOverBtn) {
    startOverBtn.addEventListener('click', () => {
      const confirmation = confirm(
        'Are you sure you want to start over?\n\n' +
        'This will permanently delete:\n' +
        '• All resume data\n' +
        '• Job context and analysis\n' +
        '• AI cache and responses\n' +
        '• Original resume snapshot\n\n' +
        'This action cannot be undone.'
      );

      if (confirmation) {
        appState.clearAll();
        appState.setPage('home');
      }
    });
  }
}