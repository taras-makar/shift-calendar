const CACHE_NAME = 'shift-calendar-cache-v1';
const CALENDAR_URL = './calendar.html';
const VERSION_URL = './version.json';
const MANIFEST_URL = './manifest.webmanifest';
const ICON_180_URL = './icon-180.png';
const ICON_192_URL = './icon-192.png';
const ICON_512_URL = './icon-512.png';
const STATIC_ASSET_FILENAMES = new Set([
  'calendar.html',
  'version.json',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png'
]);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.allSettled([
      cacheResource(cache, CALENDAR_URL),
      cacheResource(cache, VERSION_URL),
      cacheResource(cache, MANIFEST_URL),
      cacheResource(cache, ICON_180_URL),
      cacheResource(cache, ICON_192_URL),
      cacheResource(cache, ICON_512_URL)
    ]);

    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter(name => name.startsWith('shift-calendar-') && name !== CACHE_NAME)
        .map(name => caches.delete(name))
    );

    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(handleDocumentRequest());
    return;
  }

  const requestUrl = new URL(request.url);
  const assetFilename = getAssetFilename(requestUrl);
  if (requestUrl.origin === self.location.origin && STATIC_ASSET_FILENAMES.has(assetFilename)) {
    event.respondWith(handleAssetRequest(request));
  }
});

async function handleAssetRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      await cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    return new Response('Shift Calendar asset is unavailable offline.', {
      status: 503,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  }
}

function getAssetFilename(requestUrl) {
  const pathname = requestUrl.pathname.replace(/\/$/, '');
  return pathname.split('/').pop();
}

async function handleDocumentRequest() {
  const cache = await caches.open(CACHE_NAME);
  const cachedCalendar = await cache.match(CALENDAR_URL);

  try {
    const [cachedVersion, networkVersion] = await Promise.all([
      readVersion(cache),
      fetchVersion()
    ]);

    if (cachedCalendar && cachedVersion && networkVersion && cachedVersion === networkVersion) {
      return cachedCalendar;
    }

    const [calendarResponse, versionResponse] = await Promise.all([
      fetch(CALENDAR_URL, { cache: 'no-store' }),
      fetch(VERSION_URL, { cache: 'no-store' })
    ]);

    if (calendarResponse.ok && versionResponse.ok) {
      await Promise.all([
        cache.put(CALENDAR_URL, calendarResponse.clone()),
        cache.put(VERSION_URL, versionResponse.clone())
      ]);

      return calendarResponse;
    }

    if (cachedCalendar) {
      return cachedCalendar;
    }
  } catch (error) {
    if (cachedCalendar) {
      return cachedCalendar;
    }
  }

  return new Response('Shift Calendar is unavailable offline.', {
    status: 503,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}

async function cacheResource(cache, url) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.ok) {
      await cache.put(url, response.clone());
    }
  } catch (error) {
    console.warn(`Failed to cache ${url}:`, error);
  }
}

async function fetchVersion() {
  const response = await fetch(VERSION_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${VERSION_URL}: ${response.status}`);
  }

  const version = await parseVersionResponse(response);
  if (!version) {
    throw new Error(`Malformed ${VERSION_URL}`);
  }

  return version;
}

async function readVersion(cache) {
  const cachedResponse = await cache.match(VERSION_URL);
  if (!cachedResponse) {
    return null;
  }

  return parseVersionResponse(cachedResponse);
}

async function parseVersionResponse(response) {
  const text = await response.text();

  try {
    const parsed = JSON.parse(text);
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch (error) {
    return null;
  }
}
