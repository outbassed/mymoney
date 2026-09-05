(() => {
  'use strict';

  const STORAGE_KEY = 'mymoney:debts:v1';
  const MAIN_STORAGE_KEY = 'mymoney:data:v1';
  const VERSION = '1.1.0';
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });
  let debts = loadDebts();
  let editingId = null;
  let debtType = 'finite';
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);

  function loadDebts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveDebts() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(debts));
  }

  function uid() {
    return `debt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function currentMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function formatMonth(key) {
    if (!/^\d{4}-\d{2}$/.test(String(key))) return '';
    const [year, month] = key.split('-').map(Number);
    const text = monthFmt.format(new Date(year, month - 1, 1));
    return text.charAt(0).toUpperCase() + text.slice(1).replace('.', '');
  }

  function monthIndex(key) {
    const [year, month] = String(key).split('-').map(Number);
    return year * 12 + month - 1;
  }

  function monthCount(start, end) {
    if (!start || !end) return 0;
    return Math.max(0, monthIndex(end) - monthIndex(start) + 1);
  }

  function activeInMonth(debt, key) {
    if (!debt.startMonth || monthIndex(key) < monthIndex(debt.startMonth)) return false;
    if (debt.type === 'finite') return Boolean(debt.endMonth) && monthIndex(key) <= monthIndex(debt.endMonth);
    if (debt.endedMonth) return monthIndex(key) <= monthIndex(debt.endedMonth);
    return true;
  }

  function parseMoney(value) {
    let text = String(value ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!text) return NaN;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const n = Number(text);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function showToast(message) {
    const toast = $('#toast');
    if (!toast) return;
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('show');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function openSheet(sheet) {
    document.querySelectorAll('.bottom-sheet').forEach(item => item.classList.remove('open'));
    $('#sheetBackdrop')?.classList.add('show');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    debtsSheet.classList.remove('open');
    $('#sheetBackdrop')?.classList.remove('show');
    document.body.style.overflow = '';
    hideForm();
  }

  function makeSettingsButton() {
    if ($('#debtsBtn')) return;
    const groups = document.querySelectorAll('.more-page .settings-group');
    const group = groups[0];
    if (!group) return;
    const button = document.createElement('button');
    button.className = 'settings-item';
    button.id = 'debtsBtn';
    button.innerHTML = '<span class="settings-icon debt"><svg><use href="assets/icons.svg#receipt"></use></svg></span><span><b>Dívidas</b><small>Parcelas, contas e compromissos</small></span><i>›</i>';
    group.insertBefore(button, group.firstChild);
    button.addEventListener('click', () => {
      renderDebts();
      openSheet(debtsSheet);
    });
  }

  const debtsSheet = document.createElement('section');
  debtsSheet.className = 'bottom-sheet debts-sheet';
  debtsSheet.id = 'debtsSheet';
  debtsSheet.setAttribute('role', 'dialog');
  debtsSheet.setAttribute('aria-modal', 'true');
  debtsSheet.setAttribute('aria-label', 'Dívidas');
  debtsSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-title-row">
      <div><h2>Dívidas</h2><p>Veja o que já está comprometido sem complicar.</p></div>
      <button class="close-btn" id="closeDebts" type="button">×</button>
    </div>
    <div class="debt-summary">
      <div><span>Comprometido neste mês</span><strong class="money-value" id="debtMonthlyTotal">R$ 0,00</strong></div>
      <div><span>Dívidas ativas</span><strong id="debtActiveCount">0</strong></div>
    </div>
    <div class="debts-toolbar"><button class="primary-wide" id="newDebtBtn" type="button"><svg><use href="assets/icons.svg#plus"></use></svg>Adicionar dívida</button></div>
    <div id="debtList" class="debt-list"></div>
    <div id="debtEmpty" class="empty-state debt-empty"><svg><use href="assets/icons.svg#receipt"></use></svg><strong>Nenhuma dívida anotada</strong><span>Adicione parcelas, empréstimos ou contas sem data para acabar.</span></div>
    <div class="debt-form-panel" id="debtFormPanel" hidden>
      <h3 id="debtFormTitle">Nova dívida</h3>
      <form id="debtForm">
        <label class="field"><span>Nome da dívida</span><input id="debtName" maxlength="45" placeholder="Ex.: Celular" required></label>
        <label class="amount-field"><span>Valor mensal</span><div><small>R$</small><input id="debtAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" required></div></label>
        <div class="debt-form-grid">
          <label class="field"><span>Começa em</span><input id="debtStart" type="month" required></label>
          <label class="field"><span>Dia do vencimento</span><input id="debtDueDay" type="number" inputmode="numeric" min="1" max="31" placeholder="10" required></label>
        </div>
        <span class="form-label">Duração</span>
        <div class="debt-type"><button type="button" data-debt-type="finite" class="active">Tem data para acabar</button><button type="button" data-debt-type="indefinite">Indeterminada</button></div>
        <label class="field debt-end-field" id="debtEndField"><span>Termina em</span><input id="debtEnd" type="month"></label>
        <label class="field"><span>Observação <em>opcional</em></span><input id="debtNote" maxlength="90" placeholder="Ex.: financiamento do celular"></label>
        <div class="debt-form-actions"><button class="secondary-wide" id="cancelDebtForm" type="button">Cancelar</button><button class="primary-wide" type="submit">Salvar</button></div>
      </form>
    </div>`;
  document.body.appendChild(debtsSheet);

  const list = $('#debtList', debtsSheet);
  const empty = $('#debtEmpty', debtsSheet);
  const formPanel = $('#debtFormPanel', debtsSheet);
  const form = $('#debtForm', debtsSheet);
  const nameInput = $('#debtName', debtsSheet);
  const amountInput = $('#debtAmount', debtsSheet);
  const startInput = $('#debtStart', debtsSheet);
  const dueInput = $('#debtDueDay', debtsSheet);
  const endInput = $('#debtEnd', debtsSheet);
  const noteInput = $('#debtNote', debtsSheet);
  const endField = $('#debtEndField', debtsSheet);

  function setDebtType(type) {
    debtType = type === 'indefinite' ? 'indefinite' : 'finite';
    debtsSheet.querySelectorAll('[data-debt-type]').forEach(button => button.classList.toggle('active', button.dataset.debtType === debtType));
    endField.hidden = debtType === 'indefinite';
    endInput.required = debtType === 'finite';
  }

  function showForm(debt = null) {
    editingId = debt?.id || null;
    $('#debtFormTitle', debtsSheet).textContent = debt ? 'Editar dívida' : 'Nova dívida';
    nameInput.value = debt?.name || '';
    amountInput.value = debt ? String(debt.amount).replace('.', ',') : '';
    startInput.value = debt?.startMonth || currentMonthKey();
    dueInput.value = debt?.dueDay || '';
    endInput.value = debt?.endMonth || '';
    noteInput.value = debt?.note || '';
    setDebtType(debt?.type || 'finite');
    formPanel.hidden = false;
    formPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => nameInput.focus(), 120);
  }

  function hideForm() {
    editingId = null;
    form.reset();
    setDebtType('finite');
    formPanel.hidden = true;
  }

  function paidThisMonth(debt) {
    return Array.isArray(debt.paidMonths) && debt.paidMonths.includes(currentMonthKey());
  }

  function togglePaid(id) {
    const debt = debts.find(item => item.id === id);
    const key = currentMonthKey();
    if (!debt || !activeInMonth(debt, key)) return;
    debt.paidMonths = Array.isArray(debt.paidMonths) ? debt.paidMonths : [];
    const index = debt.paidMonths.indexOf(key);
    if (index >= 0) debt.paidMonths.splice(index, 1);
    else debt.paidMonths.push(key);
    saveDebts();
    renderDebts();
    showToast(index >= 0 ? 'Pagamento deste mês desmarcado.' : 'Dívida marcada como paga neste mês.');
  }

  function endIndefinite(id) {
    const debt = debts.find(item => item.id === id);
    if (!debt || debt.type !== 'indefinite') return;
    if (!window.confirm(`Encerrar “${debt.name}” a partir deste mês?`)) return;
    debt.endedMonth = currentMonthKey();
    saveDebts();
    renderDebts();
    showToast('Dívida encerrada.');
  }

  function deleteDebt(id) {
    const debt = debts.find(item => item.id === id);
    if (!debt || !window.confirm(`Excluir “${debt.name}”?`)) return;
    debts = debts.filter(item => item.id !== id);
    saveDebts();
    renderDebts();
    showToast('Dívida excluída.');
  }

  function renderDebts() {
    const now = currentMonthKey();
    const active = debts.filter(debt => activeInMonth(debt, now));
    const total = active.reduce((sum, debt) => sum + (Number(debt.amount) || 0), 0);
    $('#debtMonthlyTotal', debtsSheet).textContent = money.format(total);
    $('#debtActiveCount', debtsSheet).textContent = String(active.length);
    list.innerHTML = '';
    empty.hidden = debts.length > 0;

    const ordered = [...debts].sort((a, b) => {
      const aa = activeInMonth(a, now) ? 0 : 1;
      const bb = activeInMonth(b, now) ? 0 : 1;
      return aa - bb || String(a.name).localeCompare(String(b.name), 'pt-BR');
    });

    for (const debt of ordered) {
      const activeNow = activeInMonth(debt, now);
      const paidNow = paidThisMonth(debt);
      const paidMonths = Array.isArray(debt.paidMonths) ? debt.paidMonths : [];
      const card = document.createElement('article');
      card.className = `debt-card${activeNow ? '' : ' ended'}`;

      let chips = `<span class="debt-chip">Vence dia ${debt.dueDay}</span>`;
      let progress = '';
      if (debt.type === 'finite') {
        const totalMonths = monthCount(debt.startMonth, debt.endMonth);
        const validPaid = paidMonths.filter(key => monthIndex(key) >= monthIndex(debt.startMonth) && monthIndex(key) <= monthIndex(debt.endMonth)).length;
        const left = Math.max(0, totalMonths - validPaid);
        const pct = totalMonths ? Math.min(100, Math.round((validPaid / totalMonths) * 100)) : 0;
        chips += `<span class="debt-chip">Termina ${escapeHtml(formatMonth(debt.endMonth))}</span>`;
        if (activeNow) chips += `<span class="debt-chip ${paidNow ? 'paid' : 'pending'}">Este mês: ${paidNow ? 'Pago' : 'Pendente'}</span>`;
        progress = `<div class="debt-progress"><i style="width:${pct}%"></i></div><div class="debt-progress-label"><span>${validPaid} paga${validPaid === 1 ? '' : 's'}</span><span>${left} falta${left === 1 ? '' : 'm'}</span></div>`;
      } else {
        chips += debt.endedMonth ? `<span class="debt-chip">Encerrada ${escapeHtml(formatMonth(debt.endedMonth))}</span>` : '<span class="debt-chip">Sem data de término</span>';
        if (activeNow) chips += `<span class="debt-chip ${paidNow ? 'paid' : 'pending'}">Este mês: ${paidNow ? 'Pago' : 'Pendente'}</span>`;
      }

      card.innerHTML = `
        <div class="debt-card-top"><div class="debt-card-title"><b>${escapeHtml(debt.name)}</b><small>Desde ${escapeHtml(formatMonth(debt.startMonth))}</small></div><div class="debt-amount money-value">${money.format(Number(debt.amount) || 0)}/mês</div></div>
        <div class="debt-info">${chips}</div>${progress}
        ${debt.note ? `<p class="debt-note">${escapeHtml(debt.note)}</p>` : ''}
        <div class="debt-actions">
          ${activeNow ? `<button class="${paidNow ? 'unpay' : 'pay'}" type="button" data-pay>${paidNow ? 'Desmarcar pago' : 'Marcar como pago'}</button>` : ''}
          <button type="button" data-edit>Editar</button>
          ${debt.type === 'indefinite' && !debt.endedMonth ? '<button class="end" type="button" data-end>Encerrar</button>' : '<button class="debt-danger" type="button" data-delete>Excluir</button>'}
        </div>`;

      $('[data-pay]', card)?.addEventListener('click', () => togglePaid(debt.id));
      $('[data-edit]', card)?.addEventListener('click', () => showForm(debt));
      $('[data-end]', card)?.addEventListener('click', () => endIndefinite(debt.id));
      $('[data-delete]', card)?.addEventListener('click', () => deleteDebt(debt.id));
      list.appendChild(card);
    }

    document.body.classList.toggle('hidden-values', Boolean(readMainSettings().hideValues));
  }

  function readMainSettings() {
    try {
      return JSON.parse(localStorage.getItem(MAIN_STORAGE_KEY) || '{}').settings || {};
    } catch {
      return {};
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    const amount = parseMoney(amountInput.value);
    const startMonth = startInput.value;
    const dueDay = Number(dueInput.value);
    const endMonth = endInput.value;
    if (!name) return showToast('Digite o nome da dívida.');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Digite um valor mensal válido.');
    if (!startMonth) return showToast('Escolha o mês inicial.');
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return showToast('Escolha um dia de vencimento entre 1 e 31.');
    if (debtType === 'finite' && !endMonth) return showToast('Escolha quando a dívida termina.');
    if (debtType === 'finite' && monthIndex(endMonth) < monthIndex(startMonth)) return showToast('O fim não pode ser antes do início.');

    const existing = editingId ? debts.find(item => item.id === editingId) : null;
    const payload = {
      id: existing?.id || uid(),
      name,
      amount,
      startMonth,
      dueDay,
      type: debtType,
      endMonth: debtType === 'finite' ? endMonth : null,
      endedMonth: debtType === 'indefinite' ? (existing?.endedMonth || null) : null,
      note: noteInput.value.trim(),
      paidMonths: Array.isArray(existing?.paidMonths) ? existing.paidMonths : [],
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    if (existing) debts = debts.map(item => item.id === existing.id ? payload : item);
    else debts.push(payload);
    saveDebts();
    hideForm();
    renderDebts();
    showToast(existing ? 'Dívida atualizada.' : 'Dívida adicionada.');
  });

  $('#closeDebts', debtsSheet).addEventListener('click', closeSheet);
  $('#newDebtBtn', debtsSheet).addEventListener('click', () => showForm());
  $('#cancelDebtForm', debtsSheet).addEventListener('click', hideForm);
  debtsSheet.querySelectorAll('[data-debt-type]').forEach(button => button.addEventListener('click', () => setDebtType(button.dataset.debtType)));

  function installBackupHooks() {
    const exportBtn = $('#exportBackup');
    const importInput = $('#importBackup');
    if (exportBtn) {
      exportBtn.addEventListener('click', event => {
        event.stopImmediatePropagation();
        let mainData = {};
        try { mainData = JSON.parse(localStorage.getItem(MAIN_STORAGE_KEY) || '{}'); } catch {}
        const payload = { app: 'MyMoney', version: VERSION, exportedAt: new Date().toISOString(), data: mainData, debts };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `mymoney-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Backup completo exportado.');
      }, true);
    }
    if (importInput) {
      importInput.addEventListener('change', async event => {
        event.stopImmediatePropagation();
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
          const parsed = JSON.parse(await file.text());
          const mainData = parsed.data || parsed;
          if (!Array.isArray(mainData.transactions) || !Array.isArray(mainData.goals)) throw new Error('invalid');
          if (!window.confirm('Restaurar este backup e substituir os dados atuais?')) return;
          localStorage.setItem(MAIN_STORAGE_KEY, JSON.stringify(mainData));
          if (Array.isArray(parsed.debts)) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed.debts));
          else localStorage.removeItem(STORAGE_KEY);
          window.location.reload();
        } catch {
          showToast('Esse arquivo de backup não é válido.');
        }
      }, true);
    }
  }

  makeSettingsButton();
  installBackupHooks();
  renderDebts();
})();