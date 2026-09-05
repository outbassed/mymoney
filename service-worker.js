const SW_VERSION = '1.4.0';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Intencionalmente sem listener de fetch e sem Cache Storage persistente.
// O navegador busca os arquivos atuais do app normalmente, enquanto os dados
// financeiros permanecem separados no armazenamento local do aparelho.
