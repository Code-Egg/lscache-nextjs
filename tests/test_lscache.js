import assert from "node:assert/strict";
import test from "node:test";
import { lscacheMiddleware, purgeAllLSCache } from "lscache-nestjs";

function assertEqualWithInfo(testName, label, actual, expected) {
  const match = actual === expected;
  console.log(
    `[TEST] ${testName} | Expected ${label}: ${expected} | Result ${label}: ${actual} | ${match ? "MATCH" : "NO MATCH"}`
  );
  assert.equal(actual, expected);
}

function createHeaders() {
  const map = new Map();
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
    url: pathname,
    path: pathname,
    headers: {
      cookie
    }
  };
}

function createResponse() {
  const headers = createHeaders();
  return {
    headers,
    setHeader(name, value) {
      headers.set(name, value);
    },
    getHeader(name) {
      return headers.get(name);
    }
  };
}

test("public cache header: public,max-age=60", () => {
  const applyLSCache = lscacheMiddleware();
  const response = createResponse();
  applyLSCache(createRequest({ pathname: "/" }), response);

  const actual = response.getHeader("x-litespeed-cache-control");
  assertEqualWithInfo("public cache header", "x-litespeed-cache-control", actual, "public,max-age=60,stale-while-revalidate=300,stale-if-error=86400");
});

test("private cache header for bypass cookie", () => {
  const applyLSCache = lscacheMiddleware({
    privateOptions: { mode: "cache", maxAge: 180, staleWhileRevalidate: 30, staleIfError: 90 }
  });
  const response = createResponse();
  applyLSCache(createRequest({ pathname: "/account", cookie: "session=abc123" }), response);

  const actual = response.getHeader("x-litespeed-cache-control");
  assertEqualWithInfo("private cache header", "x-litespeed-cache-control", actual, "private,max-age=180,stale-while-revalidate=30,stale-if-error=90");
});

test("admin path is no-cache", () => {
  const applyLSCache = lscacheMiddleware();
  const response = createResponse();
  applyLSCache(createRequest({ pathname: "/admin" }), response);

  const actual = response.getHeader("x-litespeed-cache-control");
  assertEqualWithInfo("admin no-cache", "x-litespeed-cache-control", actual, "no-cache");
});

test("public cache with tag", () => {
  const applyLSCache = lscacheMiddleware({
    publicOptions: {
      tags: ["blog", "frontpage"]
    }
  });
  const response = createResponse();
  applyLSCache(createRequest({ pathname: "/blog" }), response);

  const actualCache = response.getHeader("x-litespeed-cache-control");
  const actualTag = response.getHeader("x-litespeed-tag");
  assertEqualWithInfo("public cache with tag", "x-litespeed-cache-control", actualCache, "public,max-age=60,stale-while-revalidate=300,stale-if-error=86400");
  assertEqualWithInfo("public cache with tag", "x-litespeed-tag", actualTag, "blog,frontpage");
});

test("public maxAge=0 or cacheability=no-cache sets no-cache", () => {
  const byMaxAge = lscacheMiddleware({
    publicOptions: {
      maxAge: 0
    }
  });
  const responseByMaxAge = createResponse();
  byMaxAge(createRequest({ pathname: "/news" }), responseByMaxAge);
  assertEqualWithInfo(
    "public maxAge=0",
    "x-litespeed-cache-control",
    responseByMaxAge.getHeader("x-litespeed-cache-control"),
    "no-cache"
  );

  const byCacheability = lscacheMiddleware({
    publicOptions: {
      cacheability: "no-cache",
      maxAge: 120
    }
  });
  const responseByCacheability = createResponse();
  byCacheability(createRequest({ pathname: "/news" }), responseByCacheability);
  assertEqualWithInfo(
    "public cacheability=no-cache",
    "x-litespeed-cache-control",
    responseByCacheability.getHeader("x-litespeed-cache-control"),
    "no-cache"
  );
});

test("purge all", async () => {
  let capturedOptions;
  const fetchImpl = async (_endpoint, options) => {
    capturedOptions = options;
    return { ok: true, status: 200 };
  };

  await purgeAllLSCache({
    endpoint: "https://example.com/purge",
    token: "secret",
    fetchImpl
  });

  const body = JSON.parse(capturedOptions.body);
  assertEqualWithInfo("purge all", "purgeAll", body.purgeAll, true);
});
