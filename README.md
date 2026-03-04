# lscache-nextjs

LSCache helpers for Next.js applications running behind LiteSpeed.

## What this provides

- Middleware helper to set LSCache response headers
- Cookie-based cache bypass (for logged-in/session users)
- Purge request verification helper
- Purge tag builder helper

## Install

```bash
npm i lscache-nextjs
```

## Usage in Next.js middleware

```js
// middleware.js
import { NextResponse } from "next/server";
import { lscacheMiddleware } from "lscache-nextjs";

const applyLSCache = lscacheMiddleware({
  shouldCache: (req) => req.method === "GET" && !req.nextUrl.pathname.startsWith("/api"),
  cookieBypassList: ["next-auth.session-token", "session"],
  privateOptions: {
    mode: "cache",
    maxAge: 120,
    staleWhileRevalidate: 300,
    staleIfError: 86400
  }
});

export function middleware(request) {
  const response = NextResponse.next();
  return applyLSCache(request, response);
}
```

## Purge endpoint example

```js
// app/api/lscache/purge/route.js
import { NextResponse } from "next/server";
import {
  verifyPurgeRequest,
  buildPurgeTags,
  purgeLSCache,
  purgeAllLSCache,
  purgeLSCacheByTags
} from "lscache-nextjs";

export async function POST(request) {
  if (!verifyPurgeRequest(request, { token: process.env.LSCACHE_PURGE_TOKEN })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const base = {
    endpoint: process.env.LSCACHE_PURGE_ENDPOINT,
    token: process.env.LSCACHE_PURGE_TOKEN
  };

  if (payload?.purgeAll) {
    await purgeAllLSCache(base);
    return NextResponse.json({ ok: true, scope: "all" });
  }

  const tags = buildPurgeTags(payload);
  if (tags.length > 0) {
    await purgeLSCacheByTags(tags, base);
    return NextResponse.json({ ok: true, scope: "tags", tags });
  }

  await purgeLSCache({
    ...base,
    urls: payload?.urls || []
  });

  return NextResponse.json({ ok: true, scope: "urls" });
}
```

### Performance testing
**Cached case**
h2load -n 50000 -c 50 https://x.x.x.x/blog

finished in 6.18s, 8091.08 req/s, 399.64KB/s
requests: 50000 total, 50000 started, 50000 done, 50000 succeeded, 0 failed, 0 errored, 0 timeout
status codes: 50000 2xx, 0 3xx, 0 4xx, 0 5xx

**No cache case**
h2load -n 50000 -c 50 https://x.x.x.x/blog

finished in 16.68s, 2998.27 req/s, 146.51KB/s
requests: 50000 total, 50000 started, 50000 done, 50000 succeeded, 0 failed, 0 errored, 0 timeout
status codes: 50000 2xx, 0 3xx, 0 4xx, 0 5xx

## Notes

- This package sets `x-litespeed-cache-control` values for LiteSpeed.
- Deploy behind LiteSpeed/OpenLiteSpeed with LSCache enabled.
- `privateOptions.mode` defaults to `"no-cache"`. Set `privateOptions.mode: "cache"` to enable private cache headers for cookie-bypassed users.
- `/admin` and all subpaths under `/admin/*` are always set to `private,no-cache`, even when `privateOptions.mode` is `"cache"`.
- Purge helpers support:
- `purgeAllLSCache()` for global purge
- `purgeLSCacheByTags(tags)` for tag-based purge
- `purgeLSCache({ purgeAll, tags, urls })` for full control
- Add path rules in LiteSpeed if you need finer-grained cache behavior.
