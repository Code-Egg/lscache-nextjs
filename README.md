# lscache-nestjs

A simple LiteSpeed Cache helper package for NestJS applications.

## Prerequisite

- Run your NestJS app behind LiteSpeed/OpenLiteSpeed.
- Ensure LiteSpeed cache is enabled and writable.

## Installation

```bash
npm i lscache-nestjs
```

## Basic usage (NestJS / Express middleware)

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { lscacheMiddleware } from "lscache-nestjs";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const applyLSCache = lscacheMiddleware({
    shouldCache: (req) => req.method === "GET",
    cookieBypassList: ["session", "next-auth.session-token"],
    privateOptions: {
      mode: "cache",
      maxAge: 180
    },
    publicOptions: {
      maxAge: 60
    }
  });

  app.use((req, res, next) => {
    applyLSCache(req, res);
    next();
  });

  await app.listen(3000);
}
bootstrap();
```

## Real example: main page and post page

If you want different cache behavior by URL, create multiple middleware instances and apply by route:

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { lscacheMiddleware } from "lscache-nestjs";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const mainPageCache = lscacheMiddleware({
    publicOptions: {
      maxAge: 120,
      tags: ["home"]
    }
  });

  const postPageCache = lscacheMiddleware({
    publicOptions: {
      maxAge: 300,
      tags: ["post"]
    }
  });

  app.use((req, res, next) => {
    if (req.path === "/") {
      mainPageCache(req, res);
    } else if (req.path.startsWith("/post")) {
      postPageCache(req, res);
    }
    next();
  });

  await app.listen(3000);
}
bootstrap();
```

### Route map example (different TTL by path)

```ts
// main.ts
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { lscacheMiddleware } from "lscache-nestjs";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const cache120 = lscacheMiddleware({
    publicOptions: { maxAge: 120, tags: ["blog"] }
  });
  const cache600 = lscacheMiddleware({
    publicOptions: { maxAge: 600, tags: ["post"] }
  });
  const noCache = lscacheMiddleware({
    publicOptions: { maxAge: 0 }
  });

  app.use((req, res, next) => {
    if (req.path === "/blog") {
      cache120(req, res);
    } else if (req.path.startsWith("/post/")) {
      cache600(req, res);
    } else if (req.path.startsWith("/admin")) {
      noCache(req, res);
    }
    next();
  });

  await app.listen(3000);
}
bootstrap();
```

## Cache-control examples

### Admin page (no-cache)

`/admin` and `/admin/*` are always set to:

- `x-litespeed-cache-control: no-cache`

### Public page (cached publicly)

Default public response header:

- `x-litespeed-cache-control: public,max-age=60`

### Private page (cached privately)

When request has a bypass cookie (for example `session=...`) and `privateOptions.mode` is `"cache"`:

- `x-litespeed-cache-control: private,max-age=180`

### Contact page example (private cache 180s)

```ts
const applyLSCache = lscacheMiddleware({
  cookieBypassList: ["session"],
  privateOptions: {
    mode: "cache",
    maxAge: 180
  }
});

app.use((req, res, next) => {
  if (req.path === "/contact") {
    applyLSCache(req, res);
  }
  next();
});
```

Result on `/contact` when `session` cookie exists:

- `x-litespeed-cache-control: private,max-age=180`

### Public cache with tags

```ts
const applyLSCache = lscacheMiddleware({
  publicOptions: {
    maxAge: 300,
    tags: ["blog", "frontpage"]
  }
});
```

Result:

- `x-litespeed-cache-control: public,max-age=300`
- `x-litespeed-tag: blog,frontpage`

### Force no-cache like lscache-django

```ts
const applyLSCache = lscacheMiddleware({
  publicOptions: { maxAge: 0 }
});
// or
const applyLSCache2 = lscacheMiddleware({
  publicOptions: { cacheability: "no-cache" }
});
```

Both set:

- `x-litespeed-cache-control: no-cache`

## Purge cache examples

```ts
// lscache.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller('lscache')
export class LSCacheController {
  @Get('purge-all')
  purgeAll(@Res() res: Response) {
    res.setHeader('X-LiteSpeed-Purge', '*');
    return res.status(200).json({
      ok: true,
      purge: 'all',
    });
  }
}
```

Test purge-all URL:

```bash
curl -k -X POST https://your-site.com/lscache/purge-all
```

You can also use helper functions (`verifyPurgeRequest`, `buildPurgeTags`, `purgeLSCache`, `purgeAllLSCache`, `purgeLSCacheByTags`) for custom purge endpoint flows.

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

### Restart NodeJS Process
LiteSpeed/OpenLiteSpeed comes with python in detached mode by default, so you will need to restart python with following command to make any new settings take effect:

```
pkill lsnode
```