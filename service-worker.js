/**
 * ============================================================================
 * CREDENCIAL INTELIGENTE ITTLA - SERVICE WORKER (PWA OFFLINE)
 * Archivo: service-worker.js
 * Propósito: Permite abrir la aplicación e interactuar sin conexión a internet.
 *            Almacena en caché los recursos esenciales de la interfaz.
 * 
 * NOTA DE ARQUITECTURA:
 * La conexión Web Bluetooth (BLE) con el ESP32 se gestiona directamente desde
 * el contexto activo de la aplicación (app.js / bluetooth-service.js) mientras
 * la pantalla permanece abierta, conforme a las especificaciones de Web Bluetooth.
 * ============================================================================
 */

const CACHE_NAME = 'ittla-credencial-pwa-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/database.js',
  './js/bluetooth-service.js',
  './js/attendance-service.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// 1. INSTALACIÓN: Precarga en caché de todos los recursos necesarios
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.info('[Service Worker] Precargando activos estáticos para modo offline...');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// 2. ACTIVACIÓN: Limpieza de versiones previas de caché
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            console.info(`[Service Worker] Eliminando caché obsoleta: ${name}`);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 3. INTERCEPTOR FETCH: Estrategia Cache First con fallback a red
self.addEventListener('fetch', (event) => {
  // Ignorar solicitudes no GET o extensiones de navegador
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Almacenar en caché dinámicamente si es respuesta válida
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Si no hay red y se solicitaba navegación HTML, retornar index en caché
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
