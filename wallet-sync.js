(() => {
  'use strict';

  const DEBTS_KEY = 'mymoney:debts:v1';
  const MAIN_KEY = 'mymoney:data:v1';
  const nativeSetItem = Storage.prototype.setItem;
  let syncing = false;
  let reloadTimer = null;

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

  Storage.prototype.setItem = function(key, value) {
    if (this !== localStorage || syncing || key !== DEBTS_KEY) {
      return nativeSetItem.call(this, key, value);
    }

    const oldDebts = parseJSON(localStorage.getItem(DEBTS_KEY), []);
    const result = nativeSetItem.call(this, key, value);
    const newDebts = parseJSON(String(value), []);
    if (Array.isArray(oldDebts) && Array.isArray(newDebts)) syncPaidMonthChanges(oldDebts, newDebts);
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

  function decorateDebtTransactions() {
    document.querySelectorAll('.transaction-row[data-transaction-id]').forEach(row => {
      const tx = getTransaction(row.dataset.transactionId);
      if (!tx || tx.source !== 'debt') return;
      const detail = row.querySelector('.tx-copy small');
      if (detail && !detail.textContent.includes('Dívida')) detail.textContent += ' · Dívida';
    });
  }

  document.addEventListener('click', event => {
    const row = event.target.closest('.transaction-row[data-transaction-id]');
    if (!row) return;
    const tx = getTransaction(row.dataset.transactionId);
    if (!tx || tx.source !== 'debt') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showToast('Esse gasto é controlado pela dívida.');
  }, true);

  const observer = new MutationObserver(decorateDebtTransactions);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', decorateDebtTransactions, { once: true });
})();
