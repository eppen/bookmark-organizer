export function promptModal({ title, message, defaultValue = '', confirmText = '确定', cancelText = '取消' }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3></h3>
        <p class="muted" style="margin:0 0 10px"></p>
        <input type="text" />
        <div class="modal-actions">
          <button type="button" data-act="cancel"></button>
          <button type="button" class="primary" data-act="ok"></button>
        </div>
      </div>`;
    backdrop.querySelector('h3').textContent = title;
    backdrop.querySelector('p').textContent = message || '';
    if (!message) backdrop.querySelector('p').style.display = 'none';
    const input = backdrop.querySelector('input');
    input.value = defaultValue;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelText;
    backdrop.querySelector('[data-act="ok"]').textContent = confirmText;

    const close = (val) => {
      backdrop.remove();
      resolve(val);
    };
    backdrop.querySelector('[data-act="cancel"]').onclick = () => close(null);
    backdrop.querySelector('[data-act="ok"]').onclick = () => close(input.value);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });
    root.appendChild(backdrop);
    input.focus();
    input.select();
  });
}

export function confirmModal({ title, message, confirmText = '确定', cancelText = '取消', danger = false }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modalRoot');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3></h3>
        <p class="muted" style="margin:0; white-space: pre-wrap;"></p>
        <div class="modal-actions">
          <button type="button" data-act="cancel"></button>
          <button type="button" data-act="ok"></button>
        </div>
      </div>`;
    backdrop.querySelector('h3').textContent = title;
    backdrop.querySelector('p').textContent = message;
    backdrop.querySelector('[data-act="cancel"]').textContent = cancelText;
    const ok = backdrop.querySelector('[data-act="ok"]');
    ok.textContent = confirmText;
    ok.className = danger ? 'danger' : 'primary';
    const close = (val) => {
      backdrop.remove();
      resolve(val);
    };
    backdrop.querySelector('[data-act="cancel"]').onclick = () => close(false);
    ok.onclick = () => close(true);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
    root.appendChild(backdrop);
    ok.focus();
  });
}
