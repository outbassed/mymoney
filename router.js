(() => {
  'use strict';

  const VERSION = '1.8';
  const GITHUB_REPO_BASE = '/mymoney';
  const basePath = location.hostname.endsWith('.github.io') ? GITHUB_REPO_BASE : '';
  let applyingRoute = false;

  const routeToPage = {
    '/': 'home',
    '/inicio': 'home',
    '/historico': 'history',
    '/metas': 'goals',
    '/mais': 'more',
    '/mais/dividas': 'more',
    '/mais/dividas/nova': 'more',
    '/mais/rascunho': 'more',
    '/mais/simulacao': 'more',
    '/mais/categorias': 'more',
    '/mais/backup': 'more'
  };

  function currentRoute() {
    let path = location.pathname || '/';
    if (basePath && path.startsWith(basePath)) path = path.slice(basePath.length) || '/';
    path = path.replace(/\/+$/, '') || '/';
    return routeToPage[path] ? path : '/inicio';
  }

  function fullPath(route) {
    return `${basePath}${route === '/' ? '/inicio' : route}` || '/inicio';
  }

  function renderPage(page, smooth = false) {
    document.querySelectorAll('.tab-page').forEach(section => {
      section.classList.toggle('active', section.dataset.page === page);
    });
    document.querySelectorAll('.nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === page);
    });
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
    if (page === 'history') document.querySelector('#historySearch')?.dispatchEvent(new Event('input'));
  }

  function closeOpenSheets() {
    document.querySelectorAll('.bottom-sheet.open').forEach(sheet => sheet.classList.remove('open'));
    document.querySelector('#sheetBackdrop')?.classList.remove('show');
    document.body.style.overflow = '';
  }

  function openSubroute(route) {
    if (route === '/mais/dividas' || route === '/mais/dividas/nova') {
      const debtsBtn = document.querySelector('#debtsBtn');
      if (debtsBtn) {
        debtsBtn.click();
        if (route === '/mais/dividas/nova') setTimeout(() => document.querySelector('[data-debt-tab="new"]')?.click(), 0);
      }
      return;
    }
    if (route === '/mais/rascunho' || route === '/mais/simulacao') {
      document.querySelector('#simulationBtn')?.click();
      return;
    }
    if (route === '/mais/categorias') {
      document.querySelector('#categoriesBtn')?.click();
      return;
    }
    if (route === '/mais/backup') document.querySelector('#backupBtn')?.click();
  }

  function applyRoute({ smooth = false } = {}) {
    const route = currentRoute();
    const page = routeToPage[route] || 'home';
    applyingRoute = true;
    closeOpenSheets();
    renderPage(page, smooth);
    if (route.startsWith('/mais/')) setTimeout(() => openSubroute(route), 0);
    setTimeout(() => { applyingRoute = false; }, 10);
    document.title = route === '/inicio' ? 'MyMoney' : `MyMoney · ${route.split('/').filter(Boolean).map(part => ({ historico: 'Histórico', metas: 'Metas', mais: 'Mais', dividas: 'Dívidas', nova: 'Nova dívida', rascunho: 'Rascunho', simulacao: 'Rascunho', categorias: 'Categorias', backup: 'Backup' }[part] || part)).join(' · ')}`;
  }

  function navigate(route, { replace = false, smooth = true } = {}) {
    const normalized = routeToPage[route] ? route : '/inicio';
    history[replace ? 'replaceState' : 'pushState']({ route: normalized }, '', fullPath(normalized));
    applyRoute({ smooth });
  }

  function restore404Route() {
    const stored = sessionStorage.getItem('mymoney:spa-route');
    if (!stored) return false;
    sessionStorage.removeItem('mymoney:spa-route');
    const route = stored.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/inicio';
    history.replaceState({ route }, '', fullPath(routeToPage[route] ? route : '/inicio'));
    return true;
  }

  document.addEventListener('click', event => {
    const nav = event.target.closest('.nav-item[data-nav]');
    if (nav) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate({ home: '/inicio', history: '/historico', goals: '/metas', more: '/mais' }[nav.dataset.nav] || '/inicio');
      return;
    }

    const go = event.target.closest('[data-go]');
    if (go) {
      event.preventDefault();
      event.stopImmediatePropagation();
      navigate({ home: '/inicio', history: '/historico', goals: '/metas', more: '/mais' }[go.dataset.go] || '/inicio');
      return;
    }

    if (!applyingRoute && event.target.closest('#debtsBtn')) { history.pushState({ route: '/mais/dividas' }, '', fullPath('/mais/dividas')); return; }
    if (!applyingRoute && event.target.closest('#simulationBtn')) { history.pushState({ route: '/mais/rascunho' }, '', fullPath('/mais/rascunho')); return; }
    if (!applyingRoute && event.target.closest('#categoriesBtn')) { history.pushState({ route: '/mais/categorias' }, '', fullPath('/mais/categorias')); return; }
    if (!applyingRoute && event.target.closest('#backupBtn')) { history.pushState({ route: '/mais/backup' }, '', fullPath('/mais/backup')); return; }
    if (!applyingRoute && event.target.closest('[data-debt-tab="new"]')) { history.pushState({ route: '/mais/dividas/nova' }, '', fullPath('/mais/dividas/nova')); return; }
    if (!applyingRoute && event.target.closest('[data-debt-tab="list"]')) { history.pushState({ route: '/mais/dividas' }, '', fullPath('/mais/dividas')); return; }

    const debtClose = event.target.closest('#closeDebts');
    const simulationClose = event.target.closest('#closeSimulation');
    const categoryClose = event.target.closest('#categoriesSheet [data-close-sheet]');
    const backupClose = event.target.closest('#backupSheet [data-close-sheet]');
    const backdropClose = event.target.closest('#sheetBackdrop');
    if (!applyingRoute && (debtClose || simulationClose || categoryClose || backupClose || (backdropClose && currentRoute().startsWith('/mais/')))) {
      history.pushState({ route: '/mais' }, '', fullPath('/mais'));
    }
  }, true);

  window.addEventListener('popstate', () => applyRoute({ smooth: false }));

  restore404Route();
  if (currentRoute() === '/' || !routeToPage[currentRoute()]) history.replaceState({ route: '/inicio' }, '', fullPath('/inicio'));
  applyRoute({ smooth: false });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(`service-worker.js?v=${VERSION}`, { updateViaCache: 'none' })
      .then(registration => registration.update().catch(() => {}))
      .catch(() => {});
  }
})();