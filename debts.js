(() => {
  'use strict';

  const STORAGE_KEY = 'mymoney:debts:v1';
  const MAIN_STORAGE_KEY = 'mymoney:data:v1';
  const VERSION = '1.2.0';
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthFmt = new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' });
  let debts = loadDebts();
  let createType = 'finite';
  let editType = 'finite';
  let editingId = null;
  let debtFilter = 'active';
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

  function isEnded(debt, key = currentMonthKey()) {
    if (debt.type === 'finite') return Boolean(debt.endMonth) && monthIndex(debt.endMonth) < monthIndex(key);
    return Boolean(debt.endedMonth) && monthIndex(debt.endedMonth) < monthIndex(key);
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
    $$('.bottom-sheet').forEach(item => item.classList.remove('open'));
    $('#sheetBackdrop')?.classList.add('show');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeAllDebtSheets() {
    debtsSheet.classList.remove('open');
    editSheet.classList.remove('open');
    $('#sheetBackdrop')?.classList.remove('show');
    document.body.style.overflow = '';
    editingId = null;
  }

  function makeSettingsButton() {
    if ($('#debtsBtn')) return;
    const groups = $$('.more-page .settings-group');
    const group = groups[0];
    if (!group) return;
    const button = document.createElement('button');
    button.className = 'settings-item';
    button.id = 'debtsBtn';
    button.innerHTML = '<span class="settings-icon debt"><svg><use href="assets/icons.svg#receipt"></use></svg></span><span><b>Dívidas</b><small>Parcelas, contas e compromissos</small></span><i>›</i>';
    group.insertBefore(button, group.firstChild);
    button.addEventListener('click', () => {
      switchDebtTab('list');
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
    <div class="sheet-title-row debt-sheet-title">
      <div><h2>Dívidas</h2><p>Organize seus compromissos sem misturar tudo.</p></div>
      <button class="close-btn" id="closeDebts" type="button">×</button>
    </div>

    <div class="debt-main-tabs" role="tablist" aria-label="Área de dívidas">
      <button type="button" class="active" data-debt-tab="list" role="tab">Minhas dívidas</button>
      <button type="button" data-debt-tab="new" role="tab">Nova dívida</button>
    </div>

    <section class="debt-tab-panel active" data-debt-panel="list">
      <div class="debt-summary">
        <div><span>Comprometido neste mês</span><strong class="money-value" id="debtMonthlyTotal">R$ 0,00</strong></div>
        <div><span>Ativas neste mês</span><strong id="debtActiveCount">0</strong></div>
      </div>
      <div class="debt-list-filter" role="tablist" aria-label="Filtrar dívidas">
        <button type="button" class="active" data-debt-filter="active">Ativas</button>
        <button type="button" data-debt-filter="ended">Encerradas</button>
      </div>
      <div id="debtList" class="debt-list"></div>
      <div id="debtEmpty" class="empty-state debt-empty"><svg><use href="assets/icons.svg#receipt"></use></svg><strong>Nenhuma dívida por aqui</strong><span id="debtEmptyText">Crie sua primeira dívida na aba “Nova dívida”.</span></div>
    </section>

    <section class="debt-tab-panel" data-debt-panel="new">
      <div class="debt-create-intro"><strong>Nova dívida</strong><span>Preencha só o necessário. Depois ela aparece em “Minhas dívidas”.</span></div>
      <form id="createDebtForm" class="debt-form">
        <label class="field"><span>Nome da dívida</span><input id="createDebtName" maxlength="45" placeholder="Ex.: Celular" required></label>
        <label class="amount-field"><span>Valor mensal</span><div><small>R$</small><input id="createDebtAmount" inputmode="decimal" autocomplete="off" placeholder="0,00" required></div></label>
        <div class="debt-form-grid">
          <label class="field"><span>Começa em</span><input id="createDebtStart" type="month" required></label>
          <label class="field"><span>Dia do vencimento</span><input id="createDebtDueDay" type="number" inputmode="numeric" min="1" max="31" placeholder="10" required></label>
        </div>
        <span class="form-label">Duração</span>
        <div class="debt-type" data-type-group="create"><button type="button" data-debt-type="finite" class="active">Tem data para acabar</button><button type="button" data-debt-type="indefinite">Indeterminada</button></div>
        <label class="field debt-end-field" id="createDebtEndField"><span>Termina em</span><input id="createDebtEnd" type="month" required></label>
        <label class="field"><span>Observação <em>opcional</em></span><input id="createDebtNote" maxlength="90" placeholder="Ex.: financiamento do celular"></label>
        <button class="primary-wide" type="submit">Salvar dívida</button>
      </form>
    </section>`;
  document.body.appendChild(debtsSheet);

  const editSheet = document.createElement('section');
  editSheet.className = 'bottom-sheet debt-edit-sheet';
  editSheet.id = 'debtEditSheet';
  editSheet.setAttribute('role', 'dialog');
  editSheet.setAttribute('aria-modal', 'true');
  editSheet.setAttribute('aria-label', 'Editar dívida');
  editSheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-title-row">
      <div><h2>Editar dívida</h2><p>Altere apenas o que precisar.</p></div>
      <button class="close-btn" id="closeDebtEdit" type="button">×</button>
    </div>
    <form id="editDebtForm" class="debt-form">
      <label class="field"><span>Nome da dívida</span><input id="editDebtName" maxlength="45" required></label>
      <label class="amount-field"><span>Valor mensal</span><div><small>R$</small><input id="editDebtAmount" inputmode="decimal" autocomplete="off" required></div></label>
      <div class="debt-form-grid">
        <label class="field"><span>Começa em</span><input id="editDebtStart" type="month" required></label>
        <label class="field"><span>Dia do vencimento</span><input id="editDebtDueDay" type="number" inputmode="numeric" min="1" max="31" required></label>
      </div>
      <span class="form-label">Duração</span>
      <div class="debt-type" data-type-group="edit"><button type="button" data-debt-type="finite">Tem data para acabar</button><button type="button" data-debt-type="indefinite">Indeterminada</button></div>
      <label class="field debt-end-field" id="editDebtEndField"><span>Termina em</span><input id="editDebtEnd" type="month"></label>
      <label class="field"><span>Observação <em>opcional</em></span><input id="editDebtNote" maxlength="90"></label>
      <div class="debt-form-actions"><button class="secondary-wide debt-danger" id="deleteDebtFromEdit" type="button">Excluir</button><button class="primary-wide" type="submit">Salvar alterações</button></div>
    </form>`;
  document.body.appendChild(editSheet);

  const list = $('#debtList', debtsSheet);
  const empty = $('#debtEmpty', debtsSheet);
  const emptyText = $('#debtEmptyText', debtsSheet);
  const createForm = $('#createDebtForm', debtsSheet);
  const editForm = $('#editDebtForm', editSheet);

  const createFields = {
    name: $('#createDebtName', debtsSheet), amount: $('#createDebtAmount', debtsSheet), start: $('#createDebtStart', debtsSheet),
    due: $('#createDebtDueDay', debtsSheet), end: $('#createDebtEnd', debtsSheet), note: $('#createDebtNote', debtsSheet), endField: $('#createDebtEndField', debtsSheet)
  };
  const editFields = {
    name: $('#editDebtName', editSheet), amount: $('#editDebtAmount', editSheet), start: $('#editDebtStart', editSheet),
    due: $('#editDebtDueDay', editSheet), end: $('#editDebtEnd', editSheet), note: $('#editDebtNote', editSheet), endField: $('#editDebtEndField', editSheet)
  };

  function switchDebtTab(tab) {
    const target = tab === 'new' ? 'new' : 'list';
    $$('[data-debt-tab]', debtsSheet).forEach(button => button.classList.toggle('active', button.dataset.debtTab === target));
    $$('[data-debt-panel]', debtsSheet).forEach(panel => panel.classList.toggle('active', panel.dataset.debtPanel === target));
    if (target === 'list') renderDebts();
    if (target === 'new' && !createFields.start.value) createFields.start.value = currentMonthKey();
    debtsSheet.scrollTop = 0;
  }

  function setType(context, type) {
    const normalized = type === 'indefinite' ? 'indefinite' : 'finite';
    const root = context === 'edit' ? editSheet : debtsSheet;
    const fields = context === 'edit' ? editFields : createFields;
    if (context === 'edit') editType = normalized;
    else createType = normalized;
    $$(`[data-type-group="${context}"] [data-debt-type]`, root).forEach(button => button.classList.toggle('active', button.dataset.debtType === normalized));
    fields.endField.hidden = normalized === 'indefinite';
    fields.end.required = normalized === 'finite';
  }

  function validatePayload(fields, type, existing = null) {
    const name = fields.name.value.trim();
    const amount = parseMoney(fields.amount.value);
    const startMonth = fields.start.value;
    const dueDay = Number(fields.due.value);
    const endMonth = fields.end.value;
    if (!name) return showToast('Digite o nome da dívida.');
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Digite um valor mensal válido.');
    if (!startMonth) return showToast('Escolha o mês inicial.');
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return showToast('Escolha um dia de vencimento entre 1 e 31.');
    if (type === 'finite' && !endMonth) return showToast('Escolha quando a dívida termina.');
    if (type === 'finite' && monthIndex(endMonth) < monthIndex(startMonth)) return showToast('O fim não pode ser antes do início.');
    return {
      id: existing?.id || uid(), name, amount, startMonth, dueDay, type,
      endMonth: type === 'finite' ? endMonth : null,
      endedMonth: type === 'indefinite' ? (existing?.endedMonth || null) : null,
      note: fields.note.value.trim(),
      paidMonths: Array.isArray(existing?.paidMonths) ? existing.paidMonths : [],
      createdAt: existing?.createdAt || Date.now(), updatedAt: Date.now()
    };
  }

  function resetCreateForm() {
    createForm.reset();
    createFields.start.value = currentMonthKey();
    setType('create', 'finite');
  }

  function openEdit(debt) {
    editingId = debt.id;
    editFields.name.value = debt.name || '';
    editFields.amount.value = String(debt.amount ?? '').replace('.', ',');
    editFields.start.value = debt.startMonth || currentMonthKey();
    editFields.due.value = debt.dueDay || '';
    editFields.end.value = debt.endMonth || '';
    editFields.note.value = debt.note || '';
    setType('edit', debt.type || 'finite');
    openSheet(editSheet);
    setTimeout(() => editFields.name.focus(), 100);
  }

  function returnToDebtList() {
    editingId = null;
    switchDebtTab('list');
    renderDebts();
    openSheet(debtsSheet);
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

  function deleteDebt(id, fromEdit = false) {
    const debt = debts.find(item => item.id === id);
    if (!debt || !window.confirm(`Excluir “${debt.name}”?`)) return;
    debts = debts.filter(item => item.id !== id);
    saveDebts();
    renderDebts();
    showToast('Dívida excluída.');
    if (fromEdit) returnToDebtList();
  }

  function renderDebts() {
    const now = currentMonthKey();
    const activeThisMonth = debts.filter(debt => activeInMonth(debt, now));
    const total = activeThisMonth.reduce((sum, debt) => sum + (Number(debt.amount) || 0), 0);
    $('#debtMonthlyTotal', debtsSheet).textContent = money.format(total);
    $('#debtActiveCount', debtsSheet).textContent = String(activeThisMonth.length);

    $$('[data-debt-filter]', debtsSheet).forEach(button => button.classList.toggle('active', button.dataset.debtFilter === debtFilter));
    const visible = debts.filter(debt => debtFilter === 'ended' ? isEnded(debt, now) : !isEnded(debt, now));
    const ordered = [...visible].sort((a, b) => {
      const aa = activeInMonth(a, now) ? 0 : 1;
      const bb = activeInMonth(b, now) ? 0 : 1;
      return aa - bb || String(a.name).localeCompare(String(b.name), 'pt-BR');
    });

    list.innerHTML = '';
    empty.hidden = ordered.length > 0;
    emptyText.textContent = debtFilter === 'ended' ? 'Nenhuma dívida encerrada ainda.' : 'Crie sua primeira dívida na aba “Nova dívida”.';

    for (const debt of ordered) {
      const activeNow = activeInMonth(debt, now);
      const ended = isEnded(debt, now);
      const paidNow = paidThisMonth(debt);
      const paidMonths = Array.isArray(debt.paidMonths) ? debt.paidMonths : [];
      const card = document.createElement('article');
      card.className = `debt-card${ended ? ' ended' : ''}`;

      let chips = `<span class="debt-chip">Vence dia ${debt.dueDay}</span>`;
      let progress = '';
      if (debt.type === 'finite') {
        const totalMonths = monthCount(debt.startMonth, debt.endMonth);
        const validPaid = paidMonths.filter(key => monthIndex(key) >= monthIndex(debt.startMonth) && monthIndex(key) <= monthIndex(debt.endMonth)).length;
        const left = Math.max(0, totalMonths - validPaid);
        const pct = totalMonths ? Math.min(100, Math.round((validPaid / totalMonths) * 100)) : 0;
        chips += `<span class="debt-chip">Termina ${escapeHtml(formatMonth(debt.endMonth))}</span>`;
        if (activeNow) chips += `<span class="debt-chip ${paidNow ? 'paid' : 'pending'}">Este mês: ${paidNow ? 'Pago' : 'Pendente'}</span>`;
        else if (!ended) chips += `<span class="debt-chip future">Começa ${escapeHtml(formatMonth(debt.startMonth))}</span>`;
        progress = `<div class="debt-progress"><i style="width:${pct}%"></i></div><div class="debt-progress-label"><span>${validPaid} paga${validPaid === 1 ? '' : 's'}</span><span>${left} falta${left === 1 ? '' : 'm'}</span></div>`;
      } else {
        chips += debt.endedMonth ? `<span class="debt-chip">Encerrada ${escapeHtml(formatMonth(debt.endedMonth))}</span>` : '<span class="debt-chip">Sem data de término</span>';
        if (activeNow) chips += `<span class="debt-chip ${paidNow ? 'paid' : 'pending'}">Este mês: ${paidNow ? 'Pago' : 'Pendente'}</span>`;
        else if (!ended) chips += `<span class="debt-chip future">Começa ${escapeHtml(formatMonth(debt.startMonth))}</span>`;
      }

      card.innerHTML = `
        <div class="debt-card-top"><div class="debt-card-title"><b>${escapeHtml(debt.name)}</b><small>Desde ${escapeHtml(formatMonth(debt.startMonth))}</small></div><div class="debt-amount money-value">${money.format(Number(debt.amount) || 0)}/mês</div></div>
        <div class="debt-info">${chips}</div>${progress}
        ${debt.note ? `<p class="debt-note">${escapeHtml(debt.note)}</p>` : ''}
        <div class="debt-actions">
          ${activeNow ? `<button class="${paidNow ? 'unpay' : 'pay'}" type="button" data-pay>${paidNow ? 'Desmarcar pago' : 'Marcar como pago'}</button>` : ''}
          <button type="button" data-edit>Editar</button>
          ${debt.type === 'indefinite' && !debt.endedMonth ? '<button class="end" type="button" data-end>Encerrar</button>' : ''}
        </div>`;

      $('[data-pay]', card)?.addEventListener('click', () => togglePaid(debt.id));
      $('[data-edit]', card)?.addEventListener('click', () => openEdit(debt));
      $('[data-end]', card)?.addEventListener('click', () => endIndefinite(debt.id));
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

  createForm.addEventListener('submit', event => {
    event.preventDefault();
    const payload = validatePayload(createFields, createType);
    if (!payload) return;
    debts.push(payload);
    saveDebts();
    resetCreateForm();
    debtFilter = 'active';
    switchDebtTab('list');
    renderDebts();
    showToast('Dívida adicionada.');
  });

  editForm.addEventListener('submit', event => {
    event.preventDefault();
    const existing = debts.find(item => item.id === editingId);
    if (!existing) return;
    const payload = validatePayload(editFields, editType, existing);
    if (!payload) return;
    debts = debts.map(item => item.id === existing.id ? payload : item);
    saveDebts();
    showToast('Dívida atualizada.');
    returnToDebtList();
  });

  $('#closeDebts', debtsSheet).addEventListener('click', closeAllDebtSheets);
  $('#closeDebtEdit', editSheet).addEventListener('click', returnToDebtList);
  $('#deleteDebtFromEdit', editSheet).addEventListener('click', () => editingId && deleteDebt(editingId, true));

  $$('[data-debt-tab]', debtsSheet).forEach(button => button.addEventListener('click', () => switchDebtTab(button.dataset.debtTab)));
  $$('[data-debt-filter]', debtsSheet).forEach(button => button.addEventListener('click', () => {
    debtFilter = button.dataset.debtFilter === 'ended' ? 'ended' : 'active';
    renderDebts();
  }));
  $$('[data-type-group="create"] [data-debt-type]', debtsSheet).forEach(button => button.addEventListener('click', () => setType('create', button.dataset.debtType)));
  $$('[data-type-group="edit"] [data-debt-type]', editSheet).forEach(button => button.addEventListener('click', () => setType('edit', button.dataset.debtType)));

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

  resetCreateForm();
  setType('edit', 'finite');
  makeSettingsButton();
  installBackupHooks();
  renderDebts();
})();