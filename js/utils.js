export const debounce = (func, wait) => {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

export const throttle = (func, limit) => {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
};

export function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  const textEl = document.getElementById('statusText');
  if (!statusEl || !textEl) return;
  statusEl.className = connected ? 'connection-status connected' : 'connection-status disconnected';
  textEl.textContent = connected ? 'Connected' : 'Disconnected';
}

export function showLoading(show) {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) {
    overlay.classList.toggle('active', show);
  }
}

export function toast(message) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.style.display = 'block';
  setTimeout(() => (toastEl.style.display = 'none'), 3000);
}

