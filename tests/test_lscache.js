import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPurgeTags,
  lscacheMiddleware,
  purgeAllLSCache,
  purgeLSCache,
  purgeLSCacheByTags,
  verifyPurgeRequest
} from "../src/index.js";

function createHeaders(initial = {}) {
  const map = new Map(
    Object.entries(initial).map(([key, value]) => [key.toLowerCase(), String(value)])
  );

  return {
    set(key, value) {
      map.set(String(key).toLowerCase(), String(value));
    },
    get(key) {
      return map.get(String(key).toLowerCase()) ?? null;
    }
  };
}

function createRequest({ method = "GET", pathname = "/", cookie = "" } = {}) {
  return {
    method,
    url: `https://example.com${pathname}`,
    nextUrl: { pathname },
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "cookie") {
          return cookie || null;
        }
        return null;
      }
    }
  };
}

function createResponse() {
  return {
    headers: createHeaders()
  };
}

test("sets public cache header by default", () => {
  const applyLSCache = lscacheMiddleware();
  const request = createRequest({ pathname: "/" });
  const response = createResponse();

  applyLSCache(request, response);

  assert.equal(
    response.headers.get("x-litespeed-cache-control"),
    "public,max-age=60,stale-while-revalidate=300,stale-if-error=86400"
  );
  assert.equal(response.headers.get("vary"), "accept-encoding");
});

test("sets no-cache when shouldCache returns false", () => {
  const applyLSCache = lscacheMiddleware({
    shouldCache: () => false
  });
  const request = createRequest({ pathname: "/" });
  const response = createResponse();

  applyLSCache(request, response);

  assert.equal(response.headers.get("x-litespeed-cache-control"), "private,no-cache");
});

test("forces admin paths to private no-cache", () => {
  const applyLSCache = lscacheMiddleware({
    privateOptions: {
      mode: "cache",
      maxAge: 180
    }
  });
  const request = createRequest({
    pathname: "/admin/dashboard",
    cookie: "session=abc123"
  });
  const response = createResponse();

  applyLSCache(request, response);

  assert.equal(response.headers.get("x-litespeed-cache-control"), "private,no-cache");
});

test("supports private cache for bypass-cookie users", () => {
  const applyLSCache = lscacheMiddleware({
    privateOptions: {
      mode: "cache",
      maxAge: 180,
      staleWhileRevalidate: 30,
      staleIfError: 90
    }
  });
  const request = createRequest({
    pathname: "/account",
    cookie: "session=abc123"
  });
  const response = createResponse();

  applyLSCache(request, response);

  assert.equal(
    response.headers.get("x-litespeed-cache-control"),
    "private,max-age=180,stale-while-revalidate=30,stale-if-error=90"
  );
});

test("verifyPurgeRequest validates token header", () => {
  const request = {
    headers: {
      get(name) {
        if (name === "x-lscache-key") {
          return "secret";
        }
        return null;
      }
    }
  };

  assert.equal(verifyPurgeRequest(request, { token: "secret" }), true);
  assert.equal(verifyPurgeRequest(request, { token: "wrong" }), false);
});

test("buildPurgeTags builds unique tags from payload", () => {
  const result = buildPurgeTags({
    url: "/posts/1",
    id: 42,
    tags: ["blog", "frontpage", "blog"]
  });

  assert.deepEqual(result.sort(), ["blog", "frontpage", "id:42", "url:/posts/1"].sort());
});

test("purgeLSCache sends tags and urls payload", async () => {
  let capturedOptions;
  const fetchImpl = async (_endpoint, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200
    };
  };

  await purgeLSCache({
    endpoint: "https://example.com/purge",
    token: "secret",
    tags: ["blog"],
    urls: ["/posts/1"],
    fetchImpl
  });

  const body = JSON.parse(capturedOptions.body);
  assert.equal(capturedOptions.headers["x-lscache-key"], "secret");
  assert.deepEqual(body, {
    purgeAll: false,
    tags: ["blog"],
    urls: ["/posts/1"]
  });
});

test("purgeAllLSCache sends purgeAll payload", async () => {
  let capturedOptions;
  const fetchImpl = async (_endpoint, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200
    };
  };

  await purgeAllLSCache({
    endpoint: "https://example.com/purge",
    token: "secret",
    fetchImpl
  });

  const body = JSON.parse(capturedOptions.body);
  assert.deepEqual(body, {
    purgeAll: true,
    tags: [],
    urls: []
  });
});

test("purgeLSCacheByTags sends tag-only payload", async () => {
  let capturedOptions;
  const fetchImpl = async (_endpoint, options) => {
    capturedOptions = options;
    return {
      ok: true,
      status: 200
    };
  };

  await purgeLSCacheByTags("frontpage", {
    endpoint: "https://example.com/purge",
    token: "secret",
    fetchImpl
  });

  const body = JSON.parse(capturedOptions.body);
  assert.deepEqual(body, {
    purgeAll: false,
    tags: ["frontpage"],
    urls: []
  });
});

test("purgeLSCache requires purge target unless purgeAll is true", async () => {
  await assert.rejects(
    purgeLSCache({
      endpoint: "https://example.com/purge",
      token: "secret",
      fetchImpl: async () => ({ ok: true, status: 200 })
    }),
    /Provide purgeAll=true or at least one tag\/url to purge/
  );
});
