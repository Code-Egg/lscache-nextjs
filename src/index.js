const DEFAULT_HEADER = "x-litespeed-cache-control";
const DEFAULT_PURGE_HEADER = "x-lscache-key";

function withPrivateControl(headers, opts = {}) {
  const {
    cacheControlHeader = DEFAULT_HEADER,
    mode = "no-cache",
    maxAge = 60,
    staleWhileRevalidate = 300,
    staleIfError = 86400
  } = opts;

  if (mode === "cache") {
    const value = [
      `private,max-age=${maxAge}`,
      `stale-while-revalidate=${staleWhileRevalidate}`,
      `stale-if-error=${staleIfError}`
    ].join(",");
    headers.set(cacheControlHeader, value);
    return;
  }

  headers.set(cacheControlHeader, "private,no-cache");
}

function withPublicControl(headers, opts = {}) {
  const {
    cacheControlHeader = DEFAULT_HEADER,
    maxAge = 60,
    staleWhileRevalidate = 300,
    staleIfError = 86400,
    vary = ["accept-encoding"]
  } = opts;

  const value = [
    `public,max-age=${maxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
    `stale-if-error=${staleIfError}`
  ].join(",");

  headers.set(cacheControlHeader, value);
  headers.set("vary", Array.isArray(vary) ? vary.join(",") : String(vary));
}

function getRequestPathname(request) {
  if (request?.nextUrl?.pathname) {
    return request.nextUrl.pathname;
  }

  const rawUrl = request?.url;
  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(rawUrl).pathname || "";
  } catch {
    return "";
  }
}

function isAdminPath(pathname = "") {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

export function lscacheMiddleware(config = {}) {
  const {
    shouldCache = (request) => request.method === "GET",
    cookieBypassList = ["session", "next-auth.session-token"],
    cacheControlHeader = DEFAULT_HEADER,
    privateOptions = {},
    publicOptions = {}
  } = config;

  return function applyLSCache(request, response) {
    const pathname = getRequestPathname(request);
    const reqCookies = request?.headers?.get?.("cookie") || "";
    const hasBypassCookie = cookieBypassList.some((cookieName) => reqCookies.includes(`${cookieName}=`));

    if (isAdminPath(pathname) || !shouldCache(request)) {
      withPrivateControl(response.headers, { cacheControlHeader });
      return response;
    }

    if (hasBypassCookie) {
      withPrivateControl(response.headers, {
        cacheControlHeader,
        ...privateOptions
      });
      return response;
    }

    withPublicControl(response.headers, {
      cacheControlHeader,
      ...publicOptions
    });

    return response;
  };
}

export function verifyPurgeRequest(request, { token, header = DEFAULT_PURGE_HEADER } = {}) {
  const provided = request.headers.get(header);
  return Boolean(token && provided && provided === token);
}

export function buildPurgeTags(payload = {}) {
  const tags = new Set();

  if (payload?.url) {
    tags.add(`url:${payload.url}`);
  }

  if (Array.isArray(payload?.tags)) {
    payload.tags.forEach((t) => tags.add(String(t)));
  }

  if (payload?.id) {
    tags.add(`id:${payload.id}`);
  }

  return Array.from(tags);
}

function normalizeStringList(value) {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }

  return [String(value)];
}

export async function purgeLSCache({
  endpoint,
  token,
  header = DEFAULT_PURGE_HEADER,
  purgeAll = false,
  tags = [],
  urls = [],
  method = "POST",
  extraHeaders = {},
  fetchImpl = fetch,
  signal
} = {}) {
  if (!endpoint) {
    throw new Error("Missing required purge endpoint.");
  }

  if (!token) {
    throw new Error("Missing required purge token.");
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("Invalid fetch implementation.");
  }

  const normalizedTags = normalizeStringList(tags);
  const normalizedUrls = normalizeStringList(urls);

  if (!purgeAll && normalizedTags.length === 0 && normalizedUrls.length === 0) {
    throw new Error("Provide purgeAll=true or at least one tag/url to purge.");
  }

  const payload = {
    purgeAll: Boolean(purgeAll),
    tags: normalizedTags,
    urls: normalizedUrls
  };

  const response = await fetchImpl(endpoint, {
    method,
    headers: {
      "content-type": "application/json",
      [header]: token,
      ...extraHeaders
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Purge failed: HTTP ${response.status} ${text}`.trim());
  }

  return {
    ok: true,
    status: response.status
  };
}

export async function purgeAllLSCache(options = {}) {
  return purgeLSCache({
    ...options,
    purgeAll: true,
    tags: [],
    urls: []
  });
}

export async function purgeLSCacheByTags(tags, options = {}) {
  return purgeLSCache({
    ...options,
    tags,
    purgeAll: false
  });
}
