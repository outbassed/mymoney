(() => {
  'use strict';

  const STORAGE_KEY = 'mymoney:simulations:v1';
  const MAIN_STORAGE_KEY = 'mymoney:data:v1';
  const AUTO_ID = 'auto';
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  let data = loadData();
  let movementType = 'expense';
  let activeTab = 'simulate';
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function realBalance() {
    try {
      const main = JSON.parse(localStorage.getItem(MAIN_STORAGE_KEY) || '{}');
      const transactions = Array.isArray(main.transactions) ? main.transactions : [];
      const today = todayISO();
      return Math.round(transactions.reduce((sum, item) => {
        const value = Number(item.amount) || 0;
        if (item.type === 'income' && String(item.date || '') > today) return sum;
        if (item.type === 'income') return sum + value;
        if (item.type === 'expense') return sum - value;
        return sum;
      }, 0) * 100) / 100;
    } catch {
      return 0;
    }
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function freshSlot({ id = uid('sim'), name = 'Nova simulação', system = false, initialBalance = realBalance(), movements = [] } = {}) {
    const now = Date.now();
    return { id, name, system, initialBalance: Number(initialBalance) || 0, movements: Array.isArray(movements) ? movements : [], createdAt: now, updatedAt: now };
  }

  function normalizeData(parsed) {
    const slots = Array.isArray(parsed?.slots) ? parsed.slots.filter(Boolean).map(slot => ({
      id: String(slot.id || uid('sim')),
      name: String(slot.name || 'Simulação'),
      system: Boolean(slot.system),
      initialBalance: Number(slot.initialBalance) || 0,
      movements: Array.isArray(slot.movements) ? slot.movements.map(item => ({
        id: String(item.id || uid('move')),
        type: item.type === 'income' ? 'income' : 'expense',
        amount: Math.max(0, Number(item.amount) || 0),
        description: String(item.description || ''),
        createdAt: Number(item.createdAt) || Date.now()
      })) : [],
      createdAt: Number(slot.createdAt) || Date.now(),
      updatedAt: Number(slot.updatedAt) || Date.now()
    })) : [];

    let auto = slots.find(slot => slot.id === AUTO_ID);
    if (!auto) {
      auto = freshSlot({ id: AUTO_ID, name: 'Slot Automático', system: true });
      slots.unshift(auto);
    } else {
      auto.id = AUTO_ID;
      auto.name = 'Slot Automático';
      auto.system = true;
    }

    const activeSlotId = slots.some(slot => slot.id === parsed?.activeSlotId) ? parsed.activeSlotId : AUTO_ID;
    return { activeSlotId, slots };
  }

  function loadData() {
    try {
      return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
      return normalizeData({});
    }
  }

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function currentSlot() {
    return data.slots.find(slot => slot.id === data.activeSlotId) || data.slots.find(slot => slot.id === AUTO_ID);
  }

  function touch(slot = currentSlot()) {
    if (slot) slot.updatedAt = Date.now();
    saveData();
  }

  function parseMoney(value) {
    let text = String(value ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!text) return NaN;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
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

  function makeSettingsButton() {
    if ($('#simulationBtn')) return;
    const group = $('.more-page .settings-group');
    if (!group) return;
    const button = document.createElement('button');
    button.className = 'settings-item';
    button.id = 'simulationBtn';
    button.innerHTML = '<span class="settings-icon simulation"><svg><use href="assets/icons.svg#spark"></use></svg></span><span><b>Simulação</b><small>Teste cenários sem mexer no saldo real</small></span><i>›</i>';
    const debtsBtn = $('#debtsBtn');
    if (debtsBtn?.parentNode === group) debtsBtn.after(button);
    else group.insertBefore(button, group.firstChild);
    button.addEventListener('click', openSimulation);
  }

  const sheet = document.createElement('section');
  sheet.className = 'bottom-sheet simulation-sheet';
  sheet.id = 'simulationSheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Simulação');
  sheet.innerHTML = `
    <div class="sheet-handle"></div>
    <div class="sheet-title-row simulation-title-row">
      <div><h2>Simulação</h2><p>Faça contas à vontade. Nada daqui altera sua carteira real.</p></div>
      <button class="close-btn" id="closeSimulation" type="button">×</button>
    </div>
    <div class="simulation-tabs" role="tablist" aria-label="Área de simulação">
      <button type="button" class="active" data-sim-tab="simulate">Simular</button>
      <button type="button" data-sim-tab="slots">Slots</button>
    </div>

    <section class="simulation-panel active" data-sim-panel="simulate">
      <div class="sim-slot-head">
        <div><span>Slot atual</span><strong id="simCurrentSlot">Slot Automático</strong></div>
        <button type="button" id="simSaveAs">Salvar como novo slot</button>
      </div>

      <div class="sim-balance-card">
        <label><span>Saldo inicial</span><div class="sim-balance-input"><small>R$</small><input id="simInitialBalance" inputmode="decimal" autocomplete="off" aria-label="Saldo inicial da simulação"></div></label>
        <button type="button" id="simUseRealBalance">Usar saldo real</button>
      </div>

      <div class="sim-summary-grid">
        <div><span>Entradas</span><strong class="money-value" id="simIncomeTotal">R$ 0,00</strong></div>
        <div><span>Gastos</span><strong class="money-value" id="simExpenseTotal">R$ 0,00</strong></div>
      </div>
      <div class="sim-result-card"><span>Saldo simulado</span><strong class="money-value" id="simFinalBalance">R$ 0,00</strong></div>

      <form id="simMovementForm" class="sim-movement-form">
        <div class="segmented sim-type"><button type="button" data-sim-type="income">Entrada</button><button type="button" class="active" data-sim-type="expense">Gasto</button></div>
        <div class="sim-add-grid">
          <label class="field"><span>Valor</span><input id="simAmount" inputmode="decimal" autocomplete="off" placeholder="R$ 0,00" required></label>
          <label class="field"><span>Descrição <em>opcional</em></span><input id="simDescription" maxlength="50" placeholder="Ex.: mercado"></label>
        </div>
        <button class="primary-wide" type="submit">Adicionar à simulação</button>
      </form>

      <div class="sim-list-head"><strong>Movimentos simulados</strong><button type="button" id="simClear">Limpar</button></div>
      <div id="simMovementList" class="sim-movement-list"></div>
      <div id="simMovementEmpty" class="empty-state sim-empty"><svg><use href="assets/icons.svg#spark"></use></svg><strong>Nenhum valor simulado</strong><span>Adicione entradas e gastos para testar o cenário.</span></div>
    </section>

    <section class="simulation-panel" data-sim-panel="slots">
      <div class="sim-slots-intro"><div><strong>Seus slots</strong><span>O Slot Automático é padrão do sistema e fica sempre disponível.</span></div><button type="button" id="simCreateSlot">+ Criar slot</button></div>
      <div id="simSlotList" class="sim-slot-list"></div>
    </section>`;
  document.body.appendChild(sheet);

  const initialInput = $('#simInitialBalance', sheet);
  const amountInput = $('#simAmount', sheet);
  const descriptionInput = $('#simDescription', sheet);
  const movementList = $('#simMovementList', sheet);
  const movementEmpty = $('#simMovementEmpty', sheet);
  const slotList = $('#simSlotList', sheet);

  function openSheet() {
    $$('.bottom-sheet').forEach(item => item.classList.remove('open'));
    $('#sheetBackdrop')?.classList.add('show');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    sheet.classList.remove('open');
    $('#sheetBackdrop')?.classList.remove('show');
    document.body.style.overflow = '';
  }

  function openSimulation() {
    data = loadData();
    switchTab('simulate');
    renderAll();
    openSheet();
  }

  function switchTab(tab) {
    activeTab = tab === 'slots' ? 'slots' : 'simulate';
    $$('[data-sim-tab]', sheet).forEach(button => button.classList.toggle('active', button.dataset.simTab === activeTab));
    $$('[data-sim-panel]', sheet).forEach(panel => panel.classList.toggle('active', panel.dataset.simPanel === activeTab));
    if (activeTab === 'slots') renderSlots();
    sheet.scrollTop = 0;
  }

  function slotTotals(slot) {
    return (slot?.movements || []).reduce((acc, item) => {
      const amount = Number(item.amount) || 0;
      if (item.type === 'income') acc.income += amount;
      else acc.expense += amount;
      return acc;
    }, { income: 0, expense: 0 });
  }

  function renderEditor() {
    const slot = currentSlot();
    if (!slot) return;
    const totals = slotTotals(slot);
    const finalBalance = (Number(slot.initialBalance) || 0) + totals.income - totals.expense;
    $('#simCurrentSlot', sheet).textContent = slot.name;
    $('#simSaveAs', sheet).textContent = slot.system ? 'Salvar como novo slot' : 'Duplicar em novo slot';
    initialInput.value = String(Number(slot.initialBalance) || 0).replace('.', ',');
    $('#simIncomeTotal', sheet).textContent = money.format(totals.income);
    $('#simExpenseTotal', sheet).textContent = money.format(totals.expense);
    $('#simFinalBalance', sheet).textContent = money.format(finalBalance);
    $('#simFinalBalance', sheet).classList.toggle('negative', finalBalance < 0);

    movementList.innerHTML = '';
    movementEmpty.hidden = slot.movements.length > 0;
    [...slot.movements].reverse().forEach(item => {
      const row = document.createElement('div');
      row.className = `sim-movement-row ${item.type}`;
      row.innerHTML = `<span class="sim-movement-icon">${item.type === 'income' ? '+' : '−'}</span><span class="sim-movement-copy"><b>${escapeHtml(item.description || (item.type === 'income' ? 'Entrada' : 'Gasto'))}</b><small>${item.type === 'income' ? 'Entrada simulada' : 'Gasto simulado'}</small></span><strong class="money-value">${item.type === 'income' ? '+' : '-'} ${money.format(item.amount)}</strong><button type="button" aria-label="Excluir movimento">×</button>`;
      $('button', row).addEventListener('click', () => removeMovement(item.id));
      movementList.appendChild(row);
    });
  }

  function renderSlots() {
    slotList.innerHTML = '';
    const ordered = [...data.slots].sort((a, b) => {
      if (a.id === AUTO_ID) return -1;
      if (b.id === AUTO_ID) return 1;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });

    ordered.forEach(slot => {
      const totals = slotTotals(slot);
      const finalBalance = (Number(slot.initialBalance) || 0) + totals.income - totals.expense;
      const card = document.createElement('article');
      card.className = `sim-slot-card${slot.id === data.activeSlotId ? ' active' : ''}`;
      card.innerHTML = `
        <div class="sim-slot-card-top"><div><b>${escapeHtml(slot.name)}</b><small>${slot.system ? 'Padrão do sistema · auto-save' : `Alterado ${escapeHtml(dateTime.format(new Date(slot.updatedAt || Date.now())))}`}</small></div>${slot.system ? '<span class="sim-lock">Fixo</span>' : ''}</div>
        <div class="sim-slot-card-result"><span>Saldo final</span><strong class="money-value${finalBalance < 0 ? ' negative' : ''}">${money.format(finalBalance)}</strong></div>
        <div class="sim-slot-actions">
          <button type="button" data-open-slot>${slot.id === data.activeSlotId ? 'Aberto' : 'Abrir'}</button>
          ${slot.system ? '' : '<button type="button" data-rename-slot>Renomear</button><button type="button" data-duplicate-slot>Duplicar</button><button type="button" class="danger" data-delete-slot>Excluir</button>'}
        </div>`;
      $('[data-open-slot]', card).addEventListener('click', () => openSlot(slot.id));
      $('[data-rename-slot]', card)?.addEventListener('click', () => renameSlot(slot.id));
      $('[data-duplicate-slot]', card)?.addEventListener('click', () => duplicateSlot(slot.id));
      $('[data-delete-slot]', card)?.addEventListener('click', () => deleteSlot(slot.id));
      slotList.appendChild(card);
    });
  }

  function renderAll() {
    renderEditor();
    renderSlots();
    document.body.classList.toggle('hidden-values', Boolean(readMainSettings().hideValues));
  }

  function readMainSettings() {
    try {
      return JSON.parse(localStorage.getItem(MAIN_STORAGE_KEY) || '{}').settings || {};
    } catch {
      return {};
    }
  }

  function setMovementType(type) {
    movementType = type === 'income' ? 'income' : 'expense';
    $$('[data-sim-type]', sheet).forEach(button => button.classList.toggle('active', button.dataset.simType === movementType));
  }

  function addMovement(event) {
    event.preventDefault();
    const amount = parseMoney(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Digite um valor válido.');
    const slot = currentSlot();
    if (!slot) return;
    slot.movements.push({ id: uid('move'), type: movementType, amount, description: descriptionInput.value.trim(), createdAt: Date.now() });
    amountInput.value = '';
    descriptionInput.value = '';
    touch(slot);
    renderAll();
    amountInput.focus();
  }

  function removeMovement(id) {
    const slot = currentSlot();
    if (!slot) return;
    slot.movements = slot.movements.filter(item => item.id !== id);
    touch(slot);
    renderAll();
  }

  function setInitialBalanceFromInput() {
    const slot = currentSlot();
    if (!slot) return;
    const amount = parseMoney(initialInput.value);
    if (!Number.isFinite(amount)) {
      initialInput.value = String(Number(slot.initialBalance) || 0).replace('.', ',');
      return showToast('Digite um saldo inicial válido.');
    }
    slot.initialBalance = amount;
    touch(slot);
    renderAll();
  }

  function useRealBalance() {
    const slot = currentSlot();
    if (!slot) return;
    slot.initialBalance = realBalance();
    touch(slot);
    renderAll();
    showToast('Saldo real usado como base.');
  }

  function clearCurrent() {
    const slot = currentSlot();
    if (!slot) return;
    if (!slot.movements.length) return showToast('A simulação já está vazia.');
    if (!window.confirm(`Limpar todos os movimentos de “${slot.name}”?`)) return;
    slot.movements = [];
    touch(slot);
    renderAll();
    showToast('Simulação limpa.');
  }

  function promptSlotName(defaultName = '') {
    const answer = window.prompt('Nome do slot:', defaultName);
    if (answer === null) return null;
    const name = answer.trim().slice(0, 42);
    if (!name) {
      showToast('Digite um nome para o slot.');
      return null;
    }
    return name;
  }

  function createSlot() {
    const name = promptSlotName('Nova simulação');
    if (!name) return;
    const slot = freshSlot({ name });
    data.slots.push(slot);
    data.activeSlotId = slot.id;
    saveData();
    switchTab('simulate');
    renderAll();
    showToast('Slot criado.');
  }

  function saveAsNewSlot() {
    const source = currentSlot();
    if (!source) return;
    const name = promptSlotName(source.system ? 'Minha simulação' : `${source.name} - cópia`);
    if (!name) return;
    const slot = freshSlot({
      name,
      initialBalance: source.initialBalance,
      movements: source.movements.map(item => ({ ...item, id: uid('move') }))
    });
    data.slots.push(slot);
    data.activeSlotId = slot.id;
    saveData();
    renderAll();
    showToast('Simulação salva em um novo slot.');
  }

  function openSlot(id) {
    if (!data.slots.some(slot => slot.id === id)) return;
    data.activeSlotId = id;
    saveData();
    switchTab('simulate');
    renderAll();
  }

  function renameSlot(id) {
    const slot = data.slots.find(item => item.id === id);
    if (!slot || slot.system) return;
    const name = promptSlotName(slot.name);
    if (!name || name === slot.name) return;
    slot.name = name;
    touch(slot);
    renderAll();
    showToast('Slot renomeado.');
  }

  function duplicateSlot(id) {
    const source = data.slots.find(item => item.id === id);
    if (!source || source.system) return;
    const name = promptSlotName(`${source.name} - cópia`);
    if (!name) return;
    const copy = freshSlot({ name, initialBalance: source.initialBalance, movements: source.movements.map(item => ({ ...item, id: uid('move') })) });
    data.slots.push(copy);
    data.activeSlotId = copy.id;
    saveData();
    switchTab('simulate');
    renderAll();
    showToast('Slot duplicado.');
  }

  function deleteSlot(id) {
    const slot = data.slots.find(item => item.id === id);
    if (!slot || slot.system) return;
    if (!window.confirm(`Excluir o slot “${slot.name}”?`)) return;
    data.slots = data.slots.filter(item => item.id !== id);
    if (data.activeSlotId === id) data.activeSlotId = AUTO_ID;
    saveData();
    renderAll();
    showToast('Slot excluído.');
  }

  $('#simMovementForm', sheet).addEventListener('submit', addMovement);
  $('#simUseRealBalance', sheet).addEventListener('click', useRealBalance);
  $('#simClear', sheet).addEventListener('click', clearCurrent);
  $('#simCreateSlot', sheet).addEventListener('click', createSlot);
  $('#simSaveAs', sheet).addEventListener('click', saveAsNewSlot);
  $('#closeSimulation', sheet).addEventListener('click', closeSheet);
  initialInput.addEventListener('change', setInitialBalanceFromInput);
  initialInput.addEventListener('blur', setInitialBalanceFromInput);
  $$('[data-sim-tab]', sheet).forEach(button => button.addEventListener('click', () => switchTab(button.dataset.simTab)));
  $$('[data-sim-type]', sheet).forEach(button => button.addEventListener('click', () => setMovementType(button.dataset.simType)));

  data = normalizeData(data);
  saveData();
  setMovementType('expense');
  makeSettingsButton();
  renderAll();
})();