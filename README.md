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
  cookieBypassList: ["next-auth.session-token", "session"]
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
import { verifyPurgeRequest, buildPurgeTags, purgeLSCache } from "lscache-nextjs";

export async function POST(request) {
  if (!verifyPurgeRequest(request, { token: process.env.LSCACHE_PURGE_TOKEN })) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await request.json();
  const tags = buildPurgeTags(payload);
  await purgeLSCache({
    endpoint: process.env.LSCACHE_PURGE_ENDPOINT,
    token: process.env.LSCACHE_PURGE_TOKEN,
    tags,
    urls: payload.urls || []
  });

  return NextResponse.json({ ok: true, tags });
}
```

## Notes

- This package sets `x-litespeed-cache-control` values for LiteSpeed.
- Deploy behind LiteSpeed/OpenLiteSpeed with LSCache enabled.
- Add path rules in LiteSpeed if you need finer-grained cache behavior.
