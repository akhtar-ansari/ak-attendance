// AK Attendance - Service Worker
const CACHE_NAME = 'ak-attendance-v10';
const OFFLINE_PUNCHES_KEY = 'ak_offline_punches';
const FACE_DESCRIPTORS_KEY = 'ak_face_descriptors';
const PUNCH_LOCATIONS_KEY = 'ak_punch_locations';

// Files to cache
const CACHE_FILES = [
  '/ak-attendance/punch/index.html',
  '/ak-attendance/css/main.css',
  '/ak-attendance/js/config/supabase.js',
  '/ak-attendance/js/utils/date-utils.js',
  '/ak-attendance/js/utils/photo-utils.js',
  '/ak-attendance/js/utils/offline-storage.js',
  '/ak-attendance/js/utils/sync-manager.js',
  '/ak-attendance/js/api/punch-api.js',
  '/ak-attendance/js/api/labor-api.js',
  '/ak-attendance/manifest.json',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js',
  'https://justadudewhohacks.github.io/face-api.js/models/tiny_face_detector_model-weights_manifest.json',
  'https://justadudewhohacks.github.io/face-api.js/models/tiny_face_detector_model-shard1',
  'https://justadudewhohacks.github.io/face-api.js/models/face_landmark_68_model-weights_manifest.json',
  'https://justadudewhohacks.github.io/face-api.js/models/face_landmark_68_model-shard1',
  'https://justadudewhohacks.github.io/face-api.js/models/face_recognition_model-weights_manifest.json',
  'https://justadudewhohacks.github.io/face-api.js/models/face_recognition_model-shard1',
  'https://justadudewhohacks.github.io/face-api.js/models/face_recognition_model-shard2'
];

// Install event - cache files
self.addEventListener('install', event => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching files...');
        return cache.addAll(CACHE_FILES);
      })
      .then(() => self.skipWaiting())
      .catch(err => console.log('[SW] Cache failed:', err))
  );
});

// Activate event - clean old caches
self.addEventListener('activate', event => {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // Return cached version
          return cachedResponse;
        }

        // Try network
        return fetch(event.request)
          .then(response => {
            // Cache successful responses
            if (response.status === 200) {
              const responseClone = response.clone();
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, responseClone));
            }
            return response;
          })
          .catch(() => {
            // Offline fallback for HTML pages
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/ak-attendance/punch/index.html');
            }
          });
      })
  );
});

// Background sync event
self.addEventListener('sync', event => {
  console.log('[SW] Sync event:', event.tag);
  if (event.tag === 'sync-punches') {
    event.waitUntil(syncPunches());
  }
});

// Sync punches function
async function syncPunches() {
  console.log('[SW] Syncing punches...');
  // This will be handled by sync-manager.js when app opens
  // Service worker just triggers the event
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'SYNC_PUNCHES' });
  });
}

// Listen for messages from app
self.addEventListener('message', event => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Online event - trigger sync
self.addEventListener('online', () => {
  console.log('[SW] Online detected, triggering sync...');
  self.registration.sync.register('sync-punches');

});








