const DEFAULT_HEADER = "x-litespeed-cache-control";
const DEFAULT_PURGE_HEADER = "x-lscache-key";

function getHeaderValue(headers, name) {
  if (!headers) {
    return undefined;
  }

  if (typeof headers.get === "function") {
    return headers.get(name);
  }

  const lowerName = String(name).toLowerCase();
  return headers[name] ?? headers[lowerName];
}

function setHeaderValue(response, name, value) {
  if (response?.headers && typeof response.headers.set === "function") {
    response.headers.set(name, value);
    return;
  }

  if (typeof response?.setHeader === "function") {
    response.setHeader(name, value);
    return;
  }

  if (typeof response?.header === "function") {
    response.header(name, value);
  }
}

function withNoCacheControl(response, cacheControlHeader = DEFAULT_HEADER) {
  setHeaderValue(response, cacheControlHeader, "no-cache");
}

function withPrivateControl(response, opts = {}) {
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
    setHeaderValue(response, cacheControlHeader, value);
    return;
  }

  setHeaderValue(response, cacheControlHeader, "private,no-cache");
}

function withPublicControl(response, opts = {}) {
  const {
    cacheControlHeader = DEFAULT_HEADER,
    tagHeader = "x-litespeed-tag",
    tags = [],
    cacheability = "public",
    maxAge = 60,
    staleWhileRevalidate = 300,
    staleIfError = 86400,
    vary = ["accept-encoding"]
  } = opts;

  if (Number(maxAge) === 0 || cacheability === "no-cache") {
    withNoCacheControl(response, cacheControlHeader);
    return;
  }

  const value = [
    `public,max-age=${maxAge}`,
    `stale-while-revalidate=${staleWhileRevalidate}`,
    `stale-if-error=${staleIfError}`
  ].join(",");

  setHeaderValue(response, cacheControlHeader, value);
  setHeaderValue(response, "vary", Array.isArray(vary) ? vary.join(",") : String(vary));

  if (Array.isArray(tags) && tags.length > 0) {
    setHeaderValue(response, tagHeader, tags.map((tag) => String(tag)).join(","));
  }
}

function getRequestPathname(request) {
  if (request?.nextUrl?.pathname) {
    return request.nextUrl.pathname;
  }

  if (request?.path) {
    return request.path;
  }

  const rawUrl = request?.url;
  if (!rawUrl) {
    return "";
  }

  if (typeof rawUrl === "string" && rawUrl.startsWith("/")) {
    return rawUrl.split("?")[0];
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
    const reqCookies = getHeaderValue(request?.headers, "cookie") || "";
    const hasBypassCookie = cookieBypassList.some((cookieName) => reqCookies.includes(`${cookieName}=`));

    if (isAdminPath(pathname)) {
      withNoCacheControl(response, cacheControlHeader);
      return response;
    }

    if (!shouldCache(request)) {
      withPrivateControl(response, { cacheControlHeader });
      return response;
    }

    if (hasBypassCookie) {
      withPrivateControl(response, {
        cacheControlHeader,
        ...privateOptions
      });
      return response;
    }

    withPublicControl(response, {
      cacheControlHeader,
      ...publicOptions
    });

    return response;
  };
}

export function verifyPurgeRequest(request, { token, header = DEFAULT_PURGE_HEADER } = {}) {
  const provided = getHeaderValue(request?.headers, header);
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
