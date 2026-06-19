import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { endpointFor, normalizeRestRoot, preflightWordPressDraft } from "../scripts/lib/wp-draft-preflight.mjs";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async text() { return JSON.stringify(body); } };
}

async function withTempReport(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "wp-preflight-test-"));
  try {
    return await fn(path.join(dir, "wp-rest-preflight.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("/bike/wp-json/ を正しく正規化できる", () => {
  assert.equal(normalizeRestRoot("https://poi-poi.co.jp/bike/wp-json/"), "https://poi-poi.co.jp/bike/wp-json/");
  assert.equal(normalizeRestRoot("https://poi-poi.co.jp/bike"), "https://poi-poi.co.jp/bike/wp-json/");
});

test("WP_REST_ROOTに /wp-json/wp/v2/ が含まれる場合は明確にFAILする", () => {
  assert.throws(
    () => normalizeRestRoot("https://poi-poi.co.jp/bike/wp-json/wp/v2/"),
    /wp-json\/wp\/v2/
  );
});

test("存在しないWP_POST_TYPEの場合はPOST前にFAILする", async () => withTempReport(async (reportPath) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || "GET" });
    if (url.endsWith("/wp-json/")) return jsonResponse(200, { namespaces: ["wp/v2"], routes: {} });
    if (url.endsWith("/wp-json/wp/v2/types")) return jsonResponse(200, { post: { slug: "post", rest_base: "posts" } });
    throw new Error(`unexpected url: ${url}`);
  };
  const result = await preflightWordPressDraft({
    restRoot: "https://poi-poi.co.jp/bike/wp-json/",
    postType: "missing_type",
    endpoint: "https://poi-poi.co.jp/bike/wp-json/wp/v2/missing_type",
    sourceUrl: "https://poi-poi.co.jp/bike/hikaku/ysp.html",
    reportPath,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.match(report.message, /REST base/);
  assert.deepEqual(report.availableRestBases, ["posts"]);
}));

test("プリフライト失敗時はWordPressへPOSTしない", async () => withTempReport(async (reportPath) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || "GET" });
    return jsonResponse(404, { code: "rest_no_route", message: "not found" });
  };
  const result = await preflightWordPressDraft({
    restRoot: "https://poi-poi.co.jp/bike/wp-json/",
    postType: "posts",
    endpoint: "https://poi-poi.co.jp/bike/wp-json/wp/v2/posts",
    sourceUrl: "https://poi-poi.co.jp/bike/hikaku/ysp.html",
    reportPath,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.wordpressErrorCode, "rest_no_route");
}));

test("プリフライト成功時のみPOST対象endpointを許可する", async () => withTempReport(async (reportPath) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method || "GET" });
    if (url.endsWith("/wp-json/")) return jsonResponse(200, { namespaces: ["wp/v2"], routes: { "/wp/v2/posts": { endpoints: [{ methods: ["GET", "POST"] }] } } });
    if (url.endsWith("/wp-json/wp/v2/types")) return jsonResponse(200, { post: { slug: "post", rest_base: "posts" } });
    throw new Error(`unexpected url: ${url}`);
  };
  const endpoint = endpointFor("https://poi-poi.co.jp/bike/wp-json/", "posts");
  const result = await preflightWordPressDraft({
    restRoot: "https://poi-poi.co.jp/bike/wp-json/",
    postType: "posts",
    endpoint,
    sourceUrl: "https://poi-poi.co.jp/bike/hikaku/ysp.html",
    reportPath,
    fetchImpl,
  });
  assert.equal(result.ok, true);
  assert.equal(result.restBase, "posts");
  assert.equal(calls.some((call) => call.method === "POST"), false);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.ok, true);
}));

test("エラーレポートに認証情報が含まれない", async () => withTempReport(async (reportPath) => {
  const fetchImpl = async () => { throw new Error("Basic SECRET_TOKEN user password authorization"); };
  const result = await preflightWordPressDraft({
    restRoot: "https://poi-poi.co.jp/bike/wp-json/",
    postType: "posts",
    endpoint: "https://poi-poi.co.jp/bike/wp-json/wp/v2/posts",
    sourceUrl: "https://poi-poi.co.jp/bike/hikaku/ysp.html",
    reportPath,
    fetchImpl,
  });
  assert.equal(result.ok, false);
  const text = await readFile(reportPath, "utf8");
  assert.doesNotMatch(text, /SECRET_TOKEN/);
}));
