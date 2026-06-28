const CACHE_NAME = 'shift-calendar-cache';
const CALENDAR_URL = './calendar.html';
const VERSION_URL = './version.json';

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.allSettled([
      cacheResource(cache, CALENDAR_URL),
      cacheResource(cache, VERSION_URL)
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
  }
});

async function handleDocumentRequest() {
  const cache = await caches.open(CACHE_NAME);
  const cachedCalendar = await cache.match(CALENDAR_URL);

  try {
    const [cachedVersion, networkVersion] = await Promise.all([
      readVersion(cache),
      fetchVersion()
    ]);

    if (cachedCalendar && cachedVersion === networkVersion) {
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
  } catch (error) {
    if (cachedCalendar) {
      return cachedCalendar;
    }
  }

  if (cachedCalendar) {
    return cachedCalendar;
  }

  return fetch(CALENDAR_URL, { cache: 'no-store' });
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
    throw new Error(`Unable to load ${VERSION_URL}`);
  }

  return parseVersionResponse(response);
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
    return text.trim() || null;
  }
}
