(() => {
  'use strict';

  const DEBTS_KEY = 'mymoney:debts:v1';
  const MAIN_KEY = 'mymoney:data:v1';
  const nativeSetItem = Storage.prototype.setItem;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  let syncing = false;
  let reloadTimer = null;
  let refreshTimer = null;
  let viewMonth = new Date();
  viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);

  function parseJSON(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readMain() {
    const parsed = parseJSON(localStorage.getItem(MAIN_KEY), {});
    return {
      ...parsed,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      goals: Array.isArray(parsed.goals) ? parsed.goals : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}
    };
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function monthKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  function isScheduledIncome(item) {
    return item?.type === 'income' && String(item.date || '') > todayISO();
  }

  function transactionId(debtId, month) {
    return `debtpay_${String(debtId).replace(/[^a-zA-Z0-9_-]/g, '')}_${String(month).replace('-', '')}`;
  }

  function findDebt(debts, id) {
    return debts.find(item => item && item.id === id);
  }

  function saveMain(data) {
    syncing = true;
    nativeSetItem.call(localStorage, MAIN_KEY, JSON.stringify(data));
    syncing = false;
    scheduleFinancialRefresh();
  }

  function addWalletExpense(debt, month) {
    const main = readMain();
    const id = transactionId(debt.id, month);
    const duplicate = main.transactions.some(item =>
      item.id === id || (item.source === 'debt' && item.debtId === debt.id && item.debtMonth === month)
    );
    if (duplicate) return false;

    const now = Date.now();
    main.transactions.push({
      id,
      type: 'expense',
      amount: Number(debt.amount) || 0,
      categoryId: 'bills',
      description: debt.name || 'Dívida',
      date: todayISO(),
      createdAt: now,
      updatedAt: now,
      source: 'debt',
      debtId: debt.id,
      debtMonth: month,
      generatedByDebt: true
    });
    saveMain(main);
    return true;
  }

  function removeWalletExpense(debtId, month) {
    const main = readMain();
    const id = transactionId(debtId, month);
    const before = main.transactions.length;
    main.transactions = main.transactions.filter(item =>
      item.id !== id && !(item.source === 'debt' && item.debtId === debtId && item.debtMonth === month)
    );
    if (main.transactions.length === before) return false;
    saveMain(main);
    return true;
  }

  function syncPaidMonthChanges(oldDebts, newDebts) {
    let walletChanged = false;
    const ids = new Set([
      ...oldDebts.map(item => item?.id).filter(Boolean),
      ...newDebts.map(item => item?.id).filter(Boolean)
    ]);

    ids.forEach(id => {
      const oldDebt = findDebt(oldDebts, id);
      const newDebt = findDebt(newDebts, id);
      const oldPaid = new Set(Array.isArray(oldDebt?.paidMonths) ? oldDebt.paidMonths : []);
      const newPaid = new Set(Array.isArray(newDebt?.paidMonths) ? newDebt.paidMonths : []);

      newPaid.forEach(month => {
        if (!oldPaid.has(month) && newDebt) walletChanged = addWalletExpense(newDebt, month) || walletChanged;
      });
      oldPaid.forEach(month => {
        if (!newPaid.has(month)) walletChanged = removeWalletExpense(id, month) || walletChanged;
      });
    });

    if (walletChanged) {
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => location.reload(), 220);
    }
  }

  function injectScheduledIncomeUI() {
    if (!document.querySelector('#futureIncomeStyles')) {
      const style = document.createElement('style');
      style.id = 'futureIncomeStyles';
      style.textContent = `
        .balance-value-row{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;margin:10px 0 20px}
        .balance-value-row #totalBalance{display:block;font-size:34px;line-height:1.1;letter-spacing:-.03em}
        .future-income-balance{font-size:15px;font-weight:850;color:#91a0b4;white-space:nowrap;letter-spacing:-.01em}
        .future-income-balance[hidden]{display:none}
        .scheduled-income{opacity:.82}
        .scheduled-income .tx-value b{color:#a9b8ca}
        .scheduled-income .tx-value small{color:#8fa5bd}
        .hidden-values .future-income-balance,.hidden-values #monthResultPill{filter:blur(7px);user-select:none}
      `;
      document.head.appendChild(style);
    }

    const balance = document.querySelector('#totalBalance');
    if (balance && !document.querySelector('#futureIncomeBalance')) {
      const row = document.createElement('div');
      row.className = 'balance-value-row';
      balance.parentNode.insertBefore(row, balance);
      row.appendChild(balance);
      const future = document.createElement('span');
      future.id = 'futureIncomeBalance';
      future.className = 'future-income-balance money-value';
      future.hidden = true;
      future.title = 'Previsto para receber';
      future.setAttribute('aria-label', 'Valor previsto para receber');
      row.appendChild(future);
    }
  }

  function totals(items) {
    return items.reduce((acc, item) => {
      const value = Number(item.amount) || 0;
      if (item.type === 'income') acc.income += value;
      else if (item.type === 'expense') acc.expense += value;
      return acc;
    }, { income: 0, expense: 0 });
  }

  function setText(selector, text) {
    const el = document.querySelector(selector);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function renderFinancialState() {
    injectScheduledIncomeUI();
    const main = readMain();
    const futureIncomeItems = main.transactions.filter(isScheduledIncome);
    const futureIncome = futureIncomeItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const realized = main.transactions.filter(item => !isScheduledIncome(item));
    const allTotals = totals(realized);
    const realBalance = allTotals.income - allTotals.expense;

    setText('#totalBalance', money.format(realBalance));
    const futureEl = document.querySelector('#futureIncomeBalance');
    if (futureEl) {
      const futureText = `+ ${money.format(futureIncome)}`;
      if (futureEl.textContent !== futureText) futureEl.textContent = futureText;
      futureEl.hidden = futureIncome <= 0;
    }

    const selectedKey = monthKey(viewMonth);
    const monthItems = main.transactions.filter(item => String(item.date || '').slice(0, 7) === selectedKey);
    const realizedMonth = monthItems.filter(item => !isScheduledIncome(item));
    const monthTotals = totals(realizedMonth);
    const monthResult = monthTotals.income - monthTotals.expense;

    setText('#monthIncome', money.format(monthTotals.income));
    setText('#monthExpense', money.format(monthTotals.expense));
    setText('#monthLeft', money.format(monthResult));
    setText('#monthResultPill', `${monthResult >= 0 ? '+' : ''}${money.format(monthResult)}`);
    document.querySelector('#monthResultPill')?.classList.toggle('danger-text', monthResult < 0);

    decorateTransactions(main.transactions);
  }

  function decorateTransactions(transactions = readMain().transactions) {
    const byId = new Map(transactions.map(item => [item.id, item]));
    document.querySelectorAll('.transaction-row[data-transaction-id]').forEach(row => {
      const tx = byId.get(row.dataset.transactionId);
      if (!tx) return;

      const detail = row.querySelector('.tx-copy small');
      const status = row.querySelector('.tx-value small');
      const scheduled = isScheduledIncome(tx);
      row.classList.toggle('scheduled-income', scheduled);

      if (tx.source === 'debt' && detail && !detail.textContent.includes('Dívida')) detail.textContent += ' · Dívida';
      if (scheduled) {
        if (detail && !detail.textContent.includes('Agendado')) detail.textContent += ' · Agendado';
        if (status && status.textContent !== 'Agendado') status.textContent = 'Agendado';
      }
    });
  }

  function scheduleFinancialRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(renderFinancialState, 0);
  }

  Storage.prototype.setItem = function(key, value) {
    if (this !== localStorage || syncing) return nativeSetItem.call(this, key, value);

    if (key === DEBTS_KEY) {
      const oldDebts = parseJSON(localStorage.getItem(DEBTS_KEY), []);
      const result = nativeSetItem.call(this, key, value);
      const newDebts = parseJSON(String(value), []);
      if (Array.isArray(oldDebts) && Array.isArray(newDebts)) syncPaidMonthChanges(oldDebts, newDebts);
      return result;
    }

    const result = nativeSetItem.call(this, key, value);
    if (key === MAIN_KEY) scheduleFinancialRefresh();
    return result;
  };

  function showToast(message) {
    const toast = document.querySelector('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function getTransaction(id) {
    return readMain().transactions.find(item => item.id === id);
  }

  document.addEventListener('click', event => {
    if (event.target.closest('#prevMonth')) {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1);
      setTimeout(renderFinancialState, 0);
    }
    if (event.target.closest('#nextMonth')) {
      viewMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1);
      setTimeout(renderFinancialState, 0);
    }

    const row = event.target.closest('.transaction-row[data-transaction-id]');
    if (!row) return;
    const tx = getTransaction(row.dataset.transactionId);
    if (!tx || tx.source !== 'debt') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast('Esse gasto é controlado pela dívida.');
  }, true);

  const observer = new MutationObserver(() => scheduleFinancialRefresh());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function scheduleMidnightRefresh() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    setTimeout(() => {
      renderFinancialState();
      scheduleMidnightRefresh();
    }, Math.max(1000, next.getTime() - now.getTime()));
  }

  document.addEventListener('DOMContentLoaded', renderFinancialState, { once: true });
  scheduleMidnightRefresh();
})();