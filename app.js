(() => {
  'use strict';

  const VERSION = '1.0.0';
  const STORAGE_KEY = 'mymoney:data:v1';
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const monthFormatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });

  const defaultCategories = [
    { id: 'salary', name: 'Salário', type: 'income', icon: 'wallet', color: '#62e8a7' },
    { id: 'extra', name: 'Extra', type: 'income', icon: 'spark', color: '#67b7ff' },
    { id: 'food', name: 'Comida', type: 'expense', icon: 'food', color: '#ff9f6e' },
    { id: 'market', name: 'Mercado', type: 'expense', icon: 'cart', color: '#ffd166' },
    { id: 'transport', name: 'Transporte', type: 'expense', icon: 'car', color: '#67b7ff' },
    { id: 'bills', name: 'Contas', type: 'expense', icon: 'receipt', color: '#a78bfa' },
    { id: 'leisure', name: 'Lazer', type: 'expense', icon: 'game', color: '#ff7fb4' },
    { id: 'shopping', name: 'Compras', type: 'expense', icon: 'bag', color: '#79d9d0' },
    { id: 'health', name: 'Saúde', type: 'expense', icon: 'heart', color: '#ff7f86' },
    { id: 'other', name: 'Outros', type: 'expense', icon: 'grid', color: '#98a2b3' }
  ];

  const freshState = () => ({
    transactions: [],
    goals: [],
    categories: defaultCategories,
    settings: { hideValues: false }
  });

  let state = loadState();
  let selectedMonth = new Date();
  selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
  let transactionType = 'income';
  let selectedCategoryId = 'salary';
  let editingTransactionId = null;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const els = {
    app: $('#app'), monthLabel: $('#monthLabel'), prevMonth: $('#prevMonth'), nextMonth: $('#nextMonth'),
    totalBalance: $('#totalBalance'), monthIncome: $('#monthIncome'), monthExpense: $('#monthExpense'), monthLeft: $('#monthLeft'),
    monthCount: $('#monthCount'), largestExpense: $('#largestExpense'), monthResultPill: $('#monthResultPill'),
    recentTransactions: $('#recentTransactions'), homeEmpty: $('#homeEmpty'), historyList: $('#historyList'), historyEmpty: $('#historyEmpty'),
    historySearch: $('#historySearch'), historyFilter: $('#historyFilter'), toggleValues: $('#toggleValues'), hideValuesSwitch: $('#hideValuesSwitch'),
    backdrop: $('#sheetBackdrop'), transactionSheet: $('#transactionSheet'), transactionForm: $('#transactionForm'), transactionTitle: $('#transactionTitle'),
    amountInput: $('#amountInput'), descriptionInput: $('#descriptionInput'), dateInput: $('#dateInput'), categoryPicker: $('#categoryPicker'),
    goalSheet: $('#goalSheet'), goalForm: $('#goalForm'), goalName: $('#goalName'), goalTarget: $('#goalTarget'), goalCurrent: $('#goalCurrent'),
    goalsList: $('#goalsList'), goalsEmpty: $('#goalsEmpty'), backupSheet: $('#backupSheet'), exportBackup: $('#exportBackup'), importBackup: $('#importBackup'),
    installBtn: $('#installBtn'), backupBtn: $('#backupBtn'), categoriesBtn: $('#categoriesBtn'), toast: $('#toast')
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return freshState();
      const parsed = JSON.parse(raw);
      return {
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        categories: Array.isArray(parsed.categories) && parsed.categories.length ? parsed.categories : defaultCategories,
        settings: { hideValues: Boolean(parsed.settings?.hideValues) }
      };
    } catch {
      return freshState();
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function uid(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function parseAmount(value) {
    let text = String(value ?? '').trim().replace(/\s/g, '').replace(/^R\$/i, '');
    if (!text) return NaN;
    if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : NaN;
  }

  function formatAmount(value) {
    return money.format(Number(value) || 0);
  }

  function parseDateParts(dateString) {
    const [year, month, day] = String(dateString).split('-').map(Number);
    return { year, month, day };
  }

  function dateLabel(dateString) {
    const { year, month, day } = parseDateParts(dateString);
    if (!year || !month || !day) return dateString;
    return dateFormatter.format(new Date(Date.UTC(year, month - 1, day)));
  }

  function categoryById(id) {
    return state.categories.find(category => category.id === id) || { id: 'other', name: 'Outros', icon: 'grid', color: '#98a2b3' };
  }

  function monthTransactions() {
    const year = selectedMonth.getFullYear();
    const month = selectedMonth.getMonth() + 1;
    return state.transactions.filter(item => {
      const parts = parseDateParts(item.date);
      return parts.year === year && parts.month === month;
    });
  }

  function sortedTransactions(items) {
    return [...items].sort((a, b) => `${b.date}|${b.createdAt || 0}`.localeCompare(`${a.date}|${a.createdAt || 0}`));
  }

  function totals(items) {
    return items.reduce((acc, item) => {
      if (item.type === 'income') acc.income += Number(item.amount) || 0;
      else acc.expense += Number(item.amount) || 0;
      return acc;
    }, { income: 0, expense: 0 });
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add('show');
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2100);
  }

  function renderAll() {
    renderHome();
    renderHistory();
    renderGoals();
    applyHiddenValues();
  }

  function renderHome() {
    const current = monthTransactions();
    const currentTotals = totals(current);
    const allTotals = totals(state.transactions);
    const result = currentTotals.income - currentTotals.expense;
    const expenses = current.filter(item => item.type === 'expense').map(item => Number(item.amount) || 0);
    const largest = expenses.length ? Math.max(...expenses) : 0;

    let monthName = monthFormatter.format(selectedMonth);
    monthName = monthName.charAt(0).toUpperCase() + monthName.slice(1);
    els.monthLabel.textContent = monthName;
    els.totalBalance.textContent = formatAmount(allTotals.income - allTotals.expense);
    els.monthIncome.textContent = formatAmount(currentTotals.income);
    els.monthExpense.textContent = formatAmount(currentTotals.expense);
    els.monthLeft.textContent = formatAmount(result);
    els.monthCount.textContent = String(current.length);
    els.largestExpense.textContent = formatAmount(largest);
    els.monthResultPill.textContent = `${result >= 0 ? '+' : ''}${formatAmount(result)}`;
    els.monthResultPill.classList.toggle('danger-text', result < 0);

    const recent = sortedTransactions(current).slice(0, 5);
    renderTransactionList(els.recentTransactions, recent);
    els.homeEmpty.hidden = recent.length > 0;
  }

  function renderHistory() {
    const search = els.historySearch.value.trim().toLocaleLowerCase('pt-BR');
    const filter = els.historyFilter.value;
    const filtered = sortedTransactions(state.transactions).filter(item => {
      if (filter !== 'all' && item.type !== filter) return false;
      if (!search) return true;
      const category = categoryById(item.categoryId);
      return `${item.description || ''} ${category.name}`.toLocaleLowerCase('pt-BR').includes(search);
    });
    renderTransactionList(els.historyList, filtered);
    els.historyEmpty.hidden = filtered.length > 0;
  }

  function renderTransactionList(container, items) {
    container.innerHTML = '';
    for (const item of items) {
      const category = categoryById(item.categoryId);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'transaction-row';
      row.dataset.transactionId = item.id;
      row.innerHTML = `
        <span class="tx-icon ${item.type}" style="color:${category.color}"><svg><use href="assets/icons.svg#${category.icon}"></use></svg></span>
        <span class="tx-copy"><b>${escapeHtml(item.description || category.name)}</b><small>${escapeHtml(category.name)} · ${dateLabel(item.date)}</small></span>
        <span class="tx-value"><b class="money-value">${item.type === 'income' ? '+' : '-'} ${formatAmount(item.amount)}</b><small>${item.type === 'income' ? 'Entrada' : 'Gasto'}</small></span>`;
      row.addEventListener('click', () => openTransaction(item.type, item.id));
      container.appendChild(row);
    }
  }

  function renderGoals() {
    els.goalsList.innerHTML = '';
    els.goalsEmpty.hidden = state.goals.length > 0;
    for (const goal of state.goals) {
      const target = Math.max(Number(goal.target) || 0, 0);
      const current = Math.max(Number(goal.current) || 0, 0);
      const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
      const card = document.createElement('article');
      card.className = 'goal-card';
      card.innerHTML = `<div class="goal-top"><div><b>${escapeHtml(goal.name)}</b><div class="goal-meta"><span class="money-value">${formatAmount(current)} de ${formatAmount(target)}</span><span>${percent}%</span></div></div><button type="button" data-delete-goal aria-label="Excluir meta">×</button></div><div class="goal-progress"><i style="width:${percent}%"></i></div><div class="goal-actions"><button type="button" data-add-goal>+ Adicionar valor</button></div>`;
      $('[data-add-goal]', card).addEventListener('click', () => addGoalValue(goal.id));
      $('[data-delete-goal]', card).addEventListener('click', () => deleteGoal(goal.id));
      els.goalsList.appendChild(card);
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function switchPage(page) {
    $$('.tab-page').forEach(section => section.classList.toggle('active', section.dataset.page === page));
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.nav === page));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (page === 'history') renderHistory();
    if (page === 'goals') renderGoals();
  }

  function openSheet(sheet) {
    closeSheets(false);
    els.backdrop.classList.add('show');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheets(removeBackdrop = true) {
    $$('.bottom-sheet').forEach(sheet => sheet.classList.remove('open'));
    if (removeBackdrop) els.backdrop.classList.remove('show');
    document.body.style.overflow = '';
  }

  function renderCategoryPicker() {
    const categories = state.categories.filter(category => category.type === transactionType || category.type === 'both');
    if (!categories.some(category => category.id === selectedCategoryId)) selectedCategoryId = categories[0]?.id || 'other';
    els.categoryPicker.innerHTML = '';
    categories.forEach(category => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `category-btn${category.id === selectedCategoryId ? ' active' : ''}`;
      button.style.color = category.id === selectedCategoryId ? category.color : '';
      button.innerHTML = `<svg><use href="assets/icons.svg#${category.icon}"></use></svg><span>${escapeHtml(category.name)}</span>`;
      button.addEventListener('click', () => { selectedCategoryId = category.id; renderCategoryPicker(); });
      els.categoryPicker.appendChild(button);
    });
  }

  function setTransactionType(type) {
    transactionType = type === 'expense' ? 'expense' : 'income';
    $$('[data-type]', els.transactionForm).forEach(button => button.classList.toggle('active', button.dataset.type === transactionType));
    if (!editingTransactionId) selectedCategoryId = transactionType === 'income' ? 'salary' : 'food';
    renderCategoryPicker();
  }

  function openTransaction(type = 'expense', id = null) {
    editingTransactionId = id;
    const existing = id ? state.transactions.find(item => item.id === id) : null;
    els.transactionTitle.textContent = existing ? 'Editar movimentação' : 'Nova movimentação';
    if (existing) {
      transactionType = existing.type;
      selectedCategoryId = existing.categoryId;
      els.amountInput.value = String(existing.amount).replace('.', ',');
      els.descriptionInput.value = existing.description || '';
      els.dateInput.value = existing.date;
      deleteTransactionBtn.hidden = false;
    } else {
      transactionType = type === 'income' ? 'income' : 'expense';
      selectedCategoryId = transactionType === 'income' ? 'salary' : 'food';
      els.amountInput.value = '';
      els.descriptionInput.value = '';
      els.dateInput.value = isoToday();
      deleteTransactionBtn.hidden = true;
    }
    $$('[data-type]', els.transactionForm).forEach(button => button.classList.toggle('active', button.dataset.type === transactionType));
    renderCategoryPicker();
    openSheet(els.transactionSheet);
    setTimeout(() => els.amountInput.focus(), 100);
  }

  const deleteTransactionBtn = document.createElement('button');
  deleteTransactionBtn.type = 'button';
  deleteTransactionBtn.className = 'secondary-wide danger-button';
  deleteTransactionBtn.textContent = 'Excluir movimentação';
  deleteTransactionBtn.hidden = true;
  els.transactionForm.insertBefore(deleteTransactionBtn, els.transactionForm.querySelector('button[type="submit"]'));

  function saveTransaction(event) {
    event.preventDefault();
    const amount = parseAmount(els.amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Digite um valor válido.');
    if (!els.dateInput.value) return showToast('Escolha uma data.');
    const payload = {
      id: editingTransactionId || uid('tx'),
      type: transactionType,
      amount,
      categoryId: selectedCategoryId,
      description: els.descriptionInput.value.trim(),
      date: els.dateInput.value,
      createdAt: editingTransactionId ? (state.transactions.find(item => item.id === editingTransactionId)?.createdAt || Date.now()) : Date.now(),
      updatedAt: Date.now()
    };
    if (editingTransactionId) state.transactions = state.transactions.map(item => item.id === editingTransactionId ? payload : item);
    else state.transactions.push(payload);
    saveState();
    renderAll();
    closeSheets();
    showToast(editingTransactionId ? 'Movimentação atualizada.' : 'Movimentação salva.');
    editingTransactionId = null;
  }

  function deleteCurrentTransaction() {
    if (!editingTransactionId) return;
    state.transactions = state.transactions.filter(item => item.id !== editingTransactionId);
    saveState();
    renderAll();
    closeSheets();
    editingTransactionId = null;
    showToast('Movimentação excluída.');
  }

  function createGoal(event) {
    event.preventDefault();
    const name = els.goalName.value.trim();
    const target = parseAmount(els.goalTarget.value);
    const current = Math.max(0, parseAmount(els.goalCurrent.value) || 0);
    if (!name) return showToast('Dê um nome para a meta.');
    if (!Number.isFinite(target) || target <= 0) return showToast('Digite um valor de meta válido.');
    state.goals.push({ id: uid('goal'), name, target, current, createdAt: Date.now() });
    saveState();
    renderGoals();
    applyHiddenValues();
    els.goalForm.reset();
    closeSheets();
    showToast('Meta criada.');
  }

  function addGoalValue(id) {
    const goal = state.goals.find(item => item.id === id);
    if (!goal) return;
    const answer = window.prompt(`Quanto você quer adicionar em “${goal.name}”?`, '');
    if (answer === null) return;
    const amount = parseAmount(answer);
    if (!Number.isFinite(amount) || amount <= 0) return showToast('Valor inválido.');
    goal.current = Math.round(((Number(goal.current) || 0) + amount) * 100) / 100;
    saveState();
    renderGoals();
    applyHiddenValues();
    showToast('Valor adicionado à meta.');
  }

  function deleteGoal(id) {
    const goal = state.goals.find(item => item.id === id);
    if (!goal || !window.confirm(`Excluir a meta “${goal.name}”?`)) return;
    state.goals = state.goals.filter(item => item.id !== id);
    saveState();
    renderGoals();
    showToast('Meta excluída.');
  }

  function applyHiddenValues() {
    const hidden = Boolean(state.settings.hideValues);
    document.body.classList.toggle('hidden-values', hidden);
    els.hideValuesSwitch.checked = hidden;
  }

  function toggleHiddenValues(force) {
    state.settings.hideValues = typeof force === 'boolean' ? force : !state.settings.hideValues;
    saveState();
    applyHiddenValues();
    showToast(state.settings.hideValues ? 'Valores ocultados.' : 'Valores visíveis.');
  }

  function exportBackup() {
    const payload = { app: 'MyMoney', version: VERSION, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mymoney-backup-${isoToday()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('Backup exportado.');
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const data = parsed.data || parsed;
      if (!Array.isArray(data.transactions) || !Array.isArray(data.goals)) throw new Error('invalid');
      if (!window.confirm('Restaurar este backup e substituir os dados atuais?')) return;
      state = {
        transactions: data.transactions,
        goals: data.goals,
        categories: Array.isArray(data.categories) && data.categories.length ? data.categories : defaultCategories,
        settings: { hideValues: Boolean(data.settings?.hideValues) }
      };
      saveState();
      renderAll();
      closeSheets();
      showToast('Backup restaurado.');
    } catch {
      showToast('Esse arquivo de backup não é válido.');
    }
  }

  function createCategoriesSheet() {
    const sheet = document.createElement('section');
    sheet.className = 'bottom-sheet';
    sheet.id = 'categoriesSheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Categorias');
    sheet.innerHTML = `<div class="sheet-handle"></div><div class="sheet-title-row"><div><h2>Categorias</h2><p>As mais usadas ficam sempre fáceis de achar.</p></div><button class="close-btn" data-close-sheet>×</button></div><div id="categoriesManageList" class="manage-categories"></div><form id="newCategoryForm" class="new-category-form"><label class="field"><span>Nova categoria de gasto</span><input id="newCategoryName" maxlength="18" placeholder="Ex.: Pets"></label><button class="secondary-wide" type="submit"><svg><use href="assets/icons.svg#plus"></use></svg>Adicionar categoria</button></form>`;
    document.body.appendChild(sheet);
    $('[data-close-sheet]', sheet).addEventListener('click', () => closeSheets());
    $('#newCategoryForm', sheet).addEventListener('submit', event => {
      event.preventDefault();
      const input = $('#newCategoryName', sheet);
      const name = input.value.trim();
      if (!name) return showToast('Digite o nome da categoria.');
      state.categories.push({ id: uid('cat'), name, type: 'expense', icon: 'grid', color: '#79d9d0', custom: true });
      input.value = '';
      saveState();
      renderCategoriesManage(sheet);
      showToast('Categoria adicionada.');
    });
    return sheet;
  }

  const categoriesSheet = createCategoriesSheet();

  function renderCategoriesManage(sheet = categoriesSheet) {
    const list = $('#categoriesManageList', sheet);
    list.innerHTML = '';
    state.categories.forEach(category => {
      const row = document.createElement('div');
      row.className = 'manage-category-row';
      row.innerHTML = `<span style="color:${category.color}"><svg><use href="assets/icons.svg#${category.icon}"></use></svg></span><b>${escapeHtml(category.name)}</b>${category.custom ? '<button type="button" aria-label="Excluir categoria">×</button>' : '<small>Padrão</small>'}`;
      if (category.custom) $('button', row).addEventListener('click', () => {
        const inUse = state.transactions.some(item => item.categoryId === category.id);
        if (inUse) return showToast('Essa categoria está sendo usada.');
        state.categories = state.categories.filter(item => item.id !== category.id);
        saveState();
        renderCategoriesManage(sheet);
      });
      list.appendChild(row);
    });
  }

  async function installApp() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      return;
    }
    showToast('Use “Adicionar à tela inicial” no menu do navegador.');
  }

  function bindEvents() {
    $$('.nav-item').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.nav)));
    $$('[data-go]').forEach(button => button.addEventListener('click', () => switchPage(button.dataset.go)));
    $('#mainAddBtn').addEventListener('click', () => openTransaction('expense'));
    $$('[data-open-transaction]').forEach(button => button.addEventListener('click', () => openTransaction(button.dataset.openTransaction)));
    $$('[data-close-sheet]').forEach(button => button.addEventListener('click', () => closeSheets()));
    els.backdrop.addEventListener('click', () => closeSheets());
    $$('[data-type]', els.transactionForm).forEach(button => button.addEventListener('click', () => setTransactionType(button.dataset.type)));
    els.transactionForm.addEventListener('submit', saveTransaction);
    deleteTransactionBtn.addEventListener('click', deleteCurrentTransaction);
    els.prevMonth.addEventListener('click', () => { selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() - 1, 1); renderHome(); applyHiddenValues(); });
    els.nextMonth.addEventListener('click', () => { selectedMonth = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1); renderHome(); applyHiddenValues(); });
    els.historySearch.addEventListener('input', renderHistory);
    els.historyFilter.addEventListener('change', renderHistory);
    els.toggleValues.addEventListener('click', () => toggleHiddenValues());
    els.hideValuesSwitch.addEventListener('change', () => toggleHiddenValues(els.hideValuesSwitch.checked));
    $('#newGoalBtn').addEventListener('click', () => openSheet(els.goalSheet));
    els.goalForm.addEventListener('submit', createGoal);
    els.backupBtn.addEventListener('click', () => openSheet(els.backupSheet));
    els.exportBackup.addEventListener('click', exportBackup);
    els.importBackup.addEventListener('change', importBackup);
    els.categoriesBtn.addEventListener('click', () => { renderCategoriesManage(); openSheet(categoriesSheet); });
    els.installBtn.addEventListener('click', installApp);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeSheets(); });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstallPrompt = event; });
  }

  function revealApp() {
    document.documentElement.classList.add('app-ready');
  }

  function waitForVisualReady() {
    const stylesheet = $('#mainStyles');
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      revealApp();
    };
    if (stylesheet?.sheet) done();
    else stylesheet?.addEventListener('load', done, { once: true });
    if (document.fonts?.ready) document.fonts.ready.then(done).catch(done);
    setTimeout(done, 2200);
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register(`service-worker.js?v=${VERSION}`, { updateViaCache: 'none' });
      registration.update().catch(() => {});
    } catch {
      // O app continua funcionando normalmente sem service worker.
    }
  }

  function init() {
    bindEvents();
    els.dateInput.value = isoToday();
    renderAll();
    waitForVisualReady();
    registerServiceWorker();
  }

  init();
})();