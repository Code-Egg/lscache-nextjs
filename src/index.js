const DEFAULT_HEADER = "x-litespeed-cache-control";
const DEFAULT_PURGE_HEADER = "x-lscache-key";

function withPrivateControl(headers, cacheControlHeader = DEFAULT_HEADER) {
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

export function lscacheMiddleware(config = {}) {
  const {
    shouldCache = (request) => request.method === "GET",
    cookieBypassList = ["session", "next-auth.session-token"],
    cacheControlHeader = DEFAULT_HEADER,
    publicOptions = {}
  } = config;

  return function applyLSCache(request, response) {
    const reqCookies = request?.headers?.get?.("cookie") || "";
    const hasBypassCookie = cookieBypassList.some((cookieName) => reqCookies.includes(`${cookieName}=`));

    if (!shouldCache(request) || hasBypassCookie) {
      withPrivateControl(response.headers, cacheControlHeader);
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

export async function purgeLSCache({
  endpoint,
  token,
  header = DEFAULT_PURGE_HEADER,
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

  const payload = {
    tags: Array.isArray(tags) ? tags : [String(tags)],
    urls: Array.isArray(urls) ? urls : [String(urls)]
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
