const MAX_TOASTS = 3;

export function showToast(message, { type = 'info', duration = 2200 } = {}) {
  const container = document.getElementById('toastContainer');
  if (!container || !message) return;

  while (container.children.length >= MAX_TOASTS) {
    container.firstElementChild.remove();
  }

  const item = document.createElement('div');
  item.className = `toast-item toast-${type}`;
  item.textContent = message;
  container.appendChild(item);

  setTimeout(() => {
    item.classList.add('fade-out');
    setTimeout(() => {
      item.remove();
    }, 220);
  }, duration);
}
