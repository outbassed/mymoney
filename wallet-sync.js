(() => {
  'use strict';

  const DEBTS_KEY = 'mymoney:debts:v1';
  const MAIN_KEY = 'mymoney:data:v1';
  const BALANCE_VIEW_KEY = 'mymoney:balance-side-view:v1';
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

  function balanceView() {
    return localStorage.getItem(BALANCE_VIEW_KEY) === 'realized' ? 'realized' : 'scheduled';
  }

  function setBalanceView(view) {
    localStorage.setItem(BALANCE_VIEW_KEY, view === 'realized' ? 'realized' : 'scheduled');
  }

  function isScheduled(item) {
    return (item?.type === 'income' || item?.type === 'expense') && String(item.date || '') > todayISO();
  }

  function isScheduledIncome(item) {
    return item?.type === 'income' && isScheduled(item);
  }

  function isScheduledExpense(item) {
    return item?.type === 'expense' && isScheduled(item);
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

  function injectScheduledUI() {
    if (!document.querySelector('#scheduledBalanceStyles')) {
      const style = document.createElement('style');
      style.id = 'scheduledBalanceStyles';
      style.textContent = `
        .balance-value-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0 20px}
        .balance-value-row #totalBalance{display:block;font-size:34px;line-height:1.1;letter-spacing:-.03em}
        .balance-side-wrap{display:flex;align-items:center;gap:6px;min-width:0}
        .scheduled-balance-stack{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;min-height:34px;min-width:0}
        .scheduled-balance{font-size:13px;font-weight:850;line-height:1.15;white-space:nowrap;letter-spacing:-.01em}
        .scheduled-balance.income{color:#76ad91}
        .scheduled-balance.expense{color:#bc7f86}
        .scheduled-balance[hidden]{display:none}
        .balance-view-toggle{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(255,255,255,.045);color:#8f9bae;padding:0;cursor:pointer}
        .balance-view-toggle svg{width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .18s ease}
        .balance-view-toggle:active svg{transform:rotate(45deg)}
        .balance-view-toggle:focus-visible{outline:2px solid rgba(110,231,168,.55);outline-offset:2px}
        .scheduled-transaction{opacity:.82}
        .scheduled-transaction.scheduled-income .tx-value b{color:#8caf9d}
        .scheduled-transaction.scheduled-income .tx-value small{color:#7f9d90}
        .scheduled-transaction.scheduled-expense .tx-value b{color:#b98b90}
        .scheduled-transaction.scheduled-expense .tx-value small{color:#a27d82}
        .hidden-values .scheduled-balance,.hidden-values #monthResultPill{filter:blur(7px);user-select:none}
        @media (prefers-reduced-motion:reduce){.balance-view-toggle svg{transition:none}}
      `;
      document.head.appendChild(style);
    }

    const balance = document.querySelector('#totalBalance');
    if (balance && !document.querySelector('#scheduledBalanceStack')) {
      const row = document.createElement('div');
      row.className = 'balance-value-row';
      balance.parentNode.insertBefore(row, balance);
      row.appendChild(balance);

      const side = document.createElement('span');
      side.className = 'balance-side-wrap';

      const stack = document.createElement('span');
      stack.id = 'scheduledBalanceStack';
      stack.className = 'scheduled-balance-stack';

      const top = document.createElement('span');
      top.id = 'futureIncomeBalance';
      top.className = 'scheduled-balance income money-value';
      top.hidden = true;

      const bottom = document.createElement('span');
      bottom.id = 'futureExpenseBalance';
      bottom.className = 'scheduled-balance expense money-value';
      bottom.hidden = true;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = 'balanceViewToggle';
      toggle.className = 'balance-view-toggle';
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-6.5a5.5 5.5 0 0 0-5.1 3.45"/><path d="m17 4 3 3-3 3"/><path d="M4 17h6.5a5.5 5.5 0 0 0 5.1-3.45"/><path d="m7 20-3-3 3-3"/></svg>';
      toggle.addEventListener('click', () => {
        setBalanceView(balanceView() === 'scheduled' ? 'realized' : 'scheduled');
        renderFinancialState();
      });

      stack.append(top, bottom);
      side.append(stack, toggle);
      row.appendChild(side);
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

  function setElementText(el, text) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function renderBalanceSide({ futureIncome, futureExpense, realizedTotals }) {
    const mode = balanceView();
    const top = document.querySelector('#futureIncomeBalance');
    const bottom = document.querySelector('#futureExpenseBalance');
    const toggle = document.querySelector('#balanceViewToggle');
    if (!top || !bottom) return;

    if (mode === 'scheduled') {
      setElementText(top, `+ ${money.format(futureIncome)}`);
      setElementText(bottom, `- ${money.format(futureExpense)}`);
      top.hidden = futureIncome <= 0;
      bottom.hidden = futureExpense <= 0;
      top.title = 'Agendado para receber';
      bottom.title = 'Agendado para gastar';
      top.setAttribute('aria-label', 'Valor agendado para receber');
      bottom.setAttribute('aria-label', 'Valor agendado para gastar');
      if (toggle) {
        toggle.title = 'Mostrar valores já recebidos e gastos';
        toggle.setAttribute('aria-label', 'Mostrar valores já recebidos e gastos');
      }
    } else {
      setElementText(top, `Recebido ${money.format(realizedTotals.income)}`);
      setElementText(bottom, `Gasto ${money.format(realizedTotals.expense)}`);
      top.hidden = false;
      bottom.hidden = false;
      top.title = 'Total já recebido';
      bottom.title = 'Total já gasto';
      top.setAttribute('aria-label', 'Total já recebido');
      bottom.setAttribute('aria-label', 'Total já gasto');
      if (toggle) {
        toggle.title = 'Mostrar valores agendados';
        toggle.setAttribute('aria-label', 'Mostrar valores agendados');
      }
    }
  }

  function renderFinancialState() {
    injectScheduledUI();
    const main = readMain();
    const futureIncomeItems = main.transactions.filter(isScheduledIncome);
    const futureExpenseItems = main.transactions.filter(isScheduledExpense);
    const futureIncome = futureIncomeItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const futureExpense = futureExpenseItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const realized = main.transactions.filter(item => !isScheduled(item));
    const allTotals = totals(realized);
    const realBalance = allTotals.income - allTotals.expense;

    setText('#totalBalance', money.format(realBalance));
    renderBalanceSide({ futureIncome, futureExpense, realizedTotals: allTotals });

    const selectedKey = monthKey(viewMonth);
    const monthItems = main.transactions.filter(item => String(item.date || '').slice(0, 7) === selectedKey);
    const realizedMonth = monthItems.filter(item => !isScheduled(item));
    const monthTotals = totals(realizedMonth);
    const monthResult = monthTotals.income - monthTotals.expense;
    const realizedExpenses = realizedMonth.filter(item => item.type === 'expense').map(item => Number(item.amount) || 0);
    const largestExpense = realizedExpenses.length ? Math.max(...realizedExpenses) : 0;

    setText('#monthIncome', money.format(monthTotals.income));
    setText('#monthExpense', money.format(monthTotals.expense));
    setText('#monthLeft', money.format(monthResult));
    setText('#largestExpense', money.format(largestExpense));
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
      const scheduled = isScheduled(tx);
      const scheduledIncome = isScheduledIncome(tx);
      const scheduledExpense = isScheduledExpense(tx);

      row.classList.toggle('scheduled-transaction', scheduled);
      row.classList.toggle('scheduled-income', scheduledIncome);
      row.classList.toggle('scheduled-expense', scheduledExpense);

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