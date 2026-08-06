"use strict";

/*
 * Pure-logic tests for scripts/bilibili-auto-cdn.js.
 *
 * Loon itself does not run these tests. They run with Node and protect the
 * parts most likely to damage playback if changed incorrectly: classification,
 * raw URL preservation, Range validation, cache isolation, and safe fallback.
 */

var assert = require("assert");
var fs = require("fs");
var vm = require("vm");
var core = require("../scripts/bilibili-auto-cdn.js");

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write("ok - " + name + "\n");
  } catch (error) {
    failed += 1;
    process.stderr.write("not ok - " + name + "\n");
    process.stderr.write(String(error.stack || error) + "\n");
  }
}

function memoryStore() {
  var data = {};
  return {
    data: data,
    read: function (key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    write: function (value, key) {
      data[key] = value;
      return true;
    }
  };
}

function settings(overrides) {
  var raw = {
    Candidates: core.constants.DEFAULT_CANDIDATES.join(","),
    BStarAsStandard: false,
    PCDNStrategy: "best-upos",
    MCDNStrategy: "proxy-all",
    RewriteAkamai: false,
    ProbeBytes: "524288",
    TimeoutMs: "3000",
    Rounds: "1",
    CacheMinutes: "60",
    Route: "follow-rule",
    LogLevel: "WARN"
  };
  Object.keys(overrides || {}).forEach(function (key) { raw[key] = overrides[key]; });
  return core.parseSettings(raw);
}

function request(url, headers, method) {
  return { url: url, headers: headers || {}, method: method || "GET" };
}

function binary(size) {
  return new Uint8Array(size);
}

function quietLogger() {
  return { debug: function () {}, info: function () {}, warn: function () {} };
}

function runtimeFor(store, done, httpClient, notifications) {
  return {
    storage: store,
    notification: {
      post: function (title, subtitle, content) {
        notifications.push({ title: title, subtitle: subtitle, content: content });
      }
    },
    httpClient: httpClient,
    network: { key: "wifi:test", label: "Wi-Fi: test" },
    logger: quietLogger(),
    done: done
  };
}

test("accepts only ordinary Bilibili candidate hosts", function () {
  assert.strictEqual(core.validateCandidateHost("upos-tf-all-hw.bilivideo.com"), true);
  assert.strictEqual(core.validateCandidateHost("cn-hk-eq-bcache-01.bilivideo.com"), true);
  assert.strictEqual(core.validateCandidateHost("https://evil.example"), false);
  assert.strictEqual(core.validateCandidateHost("127.0.0.1"), false);
  assert.strictEqual(core.validateCandidateHost("upos-bstar1-mirrorali.bilivideo.com"), false);
  assert.strictEqual(core.validateCandidateHost("upos-hz-mirrorakam.akamaized.net"), false);
  assert.strictEqual(core.validateCandidateHost("proxy-tf-all-ws.bilivideo.com"), false);
});

test("filters invalid and duplicate candidate arguments", function () {
  var parsed = core.parseSettings({
    Candidates: "upos-tf-all-hw.bilivideo.com,evil.example,upos-tf-all-hw.bilivideo.com",
    LogLevel: "DEBUG"
  });
  assert.deepStrictEqual(parsed.candidates, ["upos-tf-all-hw.bilivideo.com"]);
  assert.deepStrictEqual(parsed.rejectedCandidates, ["evil.example"]);
  assert.strictEqual(parsed.logLevel, "DEBUG");
});

test("falls back to the built-in pool if every candidate is invalid", function () {
  assert.deepStrictEqual(core.parseSettings({ Candidates: "evil.example,127.0.0.1" }).candidates,
    core.constants.DEFAULT_CANDIDATES);
});

test("raw URL parsing leaves the signed tail untouched", function () {
  var url = "https://UPOS-SZ-MIRRORALI.BILIVIDEO.COM:443/upgcxcode/a.m4s?upsig=a%2Bb&x=1+2";
  var parsed = core.parseRawUrl(url);
  assert.strictEqual(parsed.hostname, "upos-sz-mirrorali.bilivideo.com");
  assert.strictEqual(parsed.port, "443");
  assert.strictEqual(parsed.tail, "/upgcxcode/a.m4s?upsig=a%2Bb&x=1+2");
});

test("host replacement preserves path and query bytes exactly", function () {
  var original = "https://upos-a.bilivideo.com/upgcxcode/a.m4s?upsig=z%2F1+2&deadline=9";
  var result = core.replaceHostnameOnly(original, "upos-tf-all-hw.bilivideo.com", false);
  assert.strictEqual(result,
    "https://upos-tf-all-hw.bilivideo.com/upgcxcode/a.m4s?upsig=z%2F1+2&deadline=9");
});

test("PCDN canonicalization removes a non-standard source port", function () {
  var canonical = core.canonicalizeForCandidateProbe(
    request("http://1.2.3.4:4480/upgcxcode/a.m4s?token=a%2Bb", { Range: "bytes=5-" }),
    settings()
  );
  assert.strictEqual(canonical.url.indexOf(":4480"), -1);
  assert.strictEqual(canonical.url,
    "http://upos-sz-mirroraliov.bilivideo.com/upgcxcode/a.m4s?token=a%2Bb");
});

test("classification gives live the highest media priority", function () {
  assert.strictEqual(core.classifyRequest(request(
    "https://upos-bstar1-mirrorali.bilivideo.com:4480/live-bvc/1.flv"
  )), "live");
});

test("MCDN beats the broad PCDN port heuristic", function () {
  assert.strictEqual(core.classifyRequest(request(
    "https://xy.mcdn.bilivideo.cn:4483/upgcxcode/a.m4s"
  )), "mcdn");
});

test("classifies PCDN signals", function () {
  assert.strictEqual(core.classifyRequest(request(
    "http://1.2.3.4:4480/upgcxcode/a.m4s"
  )), "pcdn");
  assert.strictEqual(core.classifyRequest(request(
    "https://edge.mountaintoys.cn/upgcxcode/a.m4s?os=mcdn"
  )), "pcdn");
});

test("BStar Akamai is BStar, not generic Akamai", function () {
  assert.strictEqual(core.classifyRequest(request(
    "https://upos-bstar1-mirrorakam.akamaized.net/upgcxcode/a.m4s"
  )), "bstar");
});

test("classifies generic Akamai separately", function () {
  assert.strictEqual(core.classifyRequest(request(
    "https://upos-hz-mirrorakam.akamaized.net/upgcxcode/a.m4s"
  )), "akamai");
});

test("classifies OV, TF, Ali, and HK as ordinary", function () {
  [
    "https://upos-sz-mirroraliov.bilivideo.com/upgcxcode/a.m4s",
    "https://upos-tf-all-hw.bilivideo.com/upgcxcode/a.m4s",
    "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s",
    "https://cn-hk-eq-bcache-01.bilivideo.com/upgcxcode/a.m4s"
  ].forEach(function (url) {
    assert.strictEqual(core.classifyRequest(request(url)), "ordinary", url);
  });
});

test("non-GET requests do not enter media handling", function () {
  assert.strictEqual(core.classifyRequest(request(
    "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s", {}, "POST"
  )), "unknown");
});

test("probe header lookup is case-insensitive", function () {
  assert.strictEqual(core.isProbeRequest({ "x-bili-cdn-probe": "1" }), true);
  assert.strictEqual(core.isProbeRequest({ "X-Bili-Cdn-Probe": "0" }), false);
});

test("rewriting updates Host and an existing :authority only", function () {
  var rewritten = core.rewriteToHost(request(
    "https://upos-a.bilivideo.com/upgcxcode/a.m4s?x=1",
    { host: "upos-a.bilivideo.com", ":authority": "upos-a.bilivideo.com", Range: "bytes=0-" }
  ), "upos-tf-all-hw.bilivideo.com", false);
  assert.strictEqual(rewritten.headers.host, "upos-tf-all-hw.bilivideo.com");
  assert.strictEqual(rewritten.headers[":authority"], "upos-tf-all-hw.bilivideo.com");
  assert.strictEqual(rewritten.headers.Range, "bytes=0-");
});

test("builds a fixed Range from an open-ended request", function () {
  assert.deepStrictEqual(core.buildFixedProbeRange("bytes=8388608-", 1048576), {
    start: 8388608,
    end: 9437183,
    expectedBytes: 1048576,
    header: "bytes=8388608-9437183"
  });
});

test("uses byte zero when the App request has no Range", function () {
  assert.strictEqual(core.buildFixedProbeRange("", 524288).header, "bytes=0-524287");
});

test("rejects suffix, multi-range, and malformed Range headers", function () {
  assert.strictEqual(core.buildFixedProbeRange("bytes=-100", 100), null);
  assert.strictEqual(core.buildFixedProbeRange("bytes=0-1,3-4", 100), null);
  assert.strictEqual(core.buildFixedProbeRange("items=0-", 100), null);
});

test("accepts a correct binary 206 response", function () {
  var range = core.buildFixedProbeRange("bytes=100-", 1000);
  var result = core.validateProbe(
    "upos-tf-all-hw.bilivideo.com",
    range,
    null,
    { status: 206, headers: { "content-range": "bytes 100-1099/9999", "content-type": "video/mp4" } },
    binary(1000),
    20
  );
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.effectiveMbps, 0.4);
});

test("rejects 200 because an ignored Range may download the full file", function () {
  var range = core.buildFixedProbeRange("bytes=0-", 1000);
  var result = core.validateProbe("host", range, null,
    { status: 200, headers: {} }, binary(1000), 20);
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.reason, "http-200");
});

test("rejects mismatched Content-Range and textual error bodies", function () {
  var range = core.buildFixedProbeRange("bytes=100-", 1000);
  var mismatch = core.validateProbe("host", range, null,
    { status: 206, headers: { "Content-Range": "bytes 0-999/9999" } }, binary(1000), 20);
  var html = core.validateProbe("host", range, null,
    { status: 206, headers: { "Content-Range": "bytes 100-1099/9999", "Content-Type": "text/html" } },
    binary(1000), 20);
  assert.strictEqual(mismatch.reason, "range-start-mismatch");
  assert.strictEqual(html.reason, "unexpected-content-type");
});

test("rejects a Content-Range that exceeds the requested end or body length", function () {
  var range = core.buildFixedProbeRange("bytes=100-", 1000);
  var tooFar = core.validateProbe("host", range, null,
    { status: 206, headers: { "Content-Range": "bytes 100-1200/9999" } }, binary(1000), 20);
  var wrongLength = core.validateProbe("host", range, null,
    { status: 206, headers: { "Content-Range": "bytes 100-1099/9999" } }, binary(999), 20);
  assert.strictEqual(tooFar.reason, "range-end-mismatch");
  assert.strictEqual(wrongLength.reason, "range-length-mismatch");
});

test("multi-round ranking uses median and requires a majority", function () {
  var raw = [
    { host: "a", success: true, status: 206, bytes: 100, elapsedMs: 10, effectiveMbps: 8, reason: "ok" },
    { host: "a", success: true, status: 206, bytes: 100, elapsedMs: 20, effectiveMbps: 4, reason: "ok" },
    { host: "a", success: false, status: 500, bytes: 0, elapsedMs: 30, effectiveMbps: 0, reason: "http-500" },
    { host: "b", success: true, status: 206, bytes: 100, elapsedMs: 10, effectiveMbps: 9, reason: "ok" },
    { host: "b", success: false, status: 500, bytes: 0, elapsedMs: 10, effectiveMbps: 0, reason: "http-500" },
    { host: "b", success: false, status: 500, bytes: 0, elapsedMs: 10, effectiveMbps: 0, reason: "http-500" }
  ];
  var ranking = core.aggregateRanking(raw, ["a", "b"], 3);
  assert.strictEqual(ranking[0].host, "a");
  assert.strictEqual(ranking[0].effectiveMbps, 6);
  assert.strictEqual(ranking[1].success, false);
});

test("a near-tie keeps the source host to avoid needless switching", function () {
  var ranking = [
    { host: "fast", success: true, effectiveMbps: 100 },
    { host: "current", success: true, effectiveMbps: 96 }
  ];
  assert.strictEqual(core.chooseBest(ranking, "current").host, "current");
});

test("profile and strategy changes alter the cache fingerprint", function () {
  var first = settings();
  var second = settings({ BStarAsStandard: true });
  assert.notStrictEqual(core.settingsFingerprint(first, "standard-upos"),
    core.settingsFingerprint(first, "standard-bstar"));
  assert.notStrictEqual(core.settingsFingerprint(first, "standard-upos"),
    core.settingsFingerprint(second, "standard-upos"));
});

test("capture persists only minimal headers and never cookies", function () {
  var store = memoryStore();
  var now = 1000;
  var current = settings();
  core.saveCapture(
    store,
    "wifi:test",
    "standard-upos",
    "ordinary",
    request("https://upos-a.bilivideo.com/upgcxcode/a.m4s?secret=1", {
      Range: "bytes=0-",
      Cookie: "SESSDATA=secret",
      Authorization: "secret",
      "User-Agent": "Bilibili/1"
    }),
    "https://upos-a.bilivideo.com/upgcxcode/a.m4s?secret=1",
    current,
    now
  );
  var saved = core.findLatestCapture(store, "wifi:test", now + 1);
  assert.deepStrictEqual(saved.headers, { "User-Agent": "Bilibili/1" });
  assert.strictEqual(saved.range, "bytes=0-");
});

test("captures and results stay isolated by network and profile", function () {
  var store = memoryStore();
  var current = settings({ BStarAsStandard: true });
  core.saveCapture(store, "wifi:a", "standard-upos", "ordinary",
    request("https://upos-a.bilivideo.com/upgcxcode/a.m4s"),
    "https://upos-a.bilivideo.com/upgcxcode/a.m4s", current, 1000);
  core.saveCapture(store, "wifi:a", "standard-bstar", "bstar",
    request("https://upos-bstar1-mirrorali.bilivideo.com/upgcxcode/b.m4s"),
    "https://upos-bstar1-mirrorali.bilivideo.com/upgcxcode/b.m4s", current, 2000);
  assert.strictEqual(core.findLatestCapture(store, "wifi:a", 2001).profile, "standard-bstar");
  assert.strictEqual(core.findLatestCapture(store, "wifi:b", 2001), null);
});

test("expired locks recover and owner checks protect a newer lock", function () {
  var store = memoryStore();
  var current = settings();
  var owner1 = core.acquireLock(store, "wifi:a", "standard-upos", current, 1000);
  assert.ok(owner1);
  assert.strictEqual(core.acquireLock(store, "wifi:a", "standard-upos", current, 1001), null);
  var key = core.storeKey("lock", "wifi:a", "standard-upos");
  var old = JSON.parse(store.read(key));
  old.expiresAt = 0;
  store.write(JSON.stringify(old), key);
  var owner2 = core.acquireLock(store, "wifi:a", "standard-upos", current, 2000);
  assert.ok(owner2);
  assert.notStrictEqual(owner1, owner2);
  assert.strictEqual(core.releaseLock(store, "wifi:a", "standard-upos", owner1), false);
  assert.strictEqual(core.releaseLock(store, "wifi:a", "standard-upos", owner2), true);
});

test("unknown-network result TTL is capped at 15 minutes", function () {
  var store = memoryStore();
  var current = settings({ CacheMinutes: "360" });
  var capture = { profile: "standard-upos" };
  var ranking = [{ host: current.candidates[0], success: true, effectiveMbps: 1 }];
  core.saveResult(store, "network:unknown", capture, current, ranking, ranking[0], 1000);
  var key = core.storeKey("result", "network:unknown", "standard-upos");
  var saved = JSON.parse(store.read(key));
  assert.strictEqual(saved.expiresAt, 1000 + 15 * 60 * 1000);
});

test("a result is invalid across profiles or changed settings", function () {
  var store = memoryStore();
  var current = settings();
  var best = { host: current.candidates[0], success: true, effectiveMbps: 1 };
  core.saveResult(store, "wifi:a", { profile: "standard-upos" }, current, [best], best, 1000);
  assert.ok(core.readValidResult(store, "wifi:a", "standard-upos", current, 1001));
  assert.strictEqual(core.readValidResult(store, "wifi:a", "standard-bstar", current, 1001), null);
  assert.strictEqual(core.readValidResult(store, "wifi:a", "standard-upos",
    settings({ Route: "DIRECT" }), 1001), null);
});

test("cache inspection distinguishes missing keys and changed settings", function () {
  var store = memoryStore();
  var current = settings({ Candidates: "upos-tf-all-hw.bilivideo.com" });
  var best = { host: "upos-tf-all-hw.bilivideo.com", success: true, effectiveMbps: 8 };
  core.saveResult(store, "wifi:@2P", { profile: "standard-upos" }, current, [best], best, 1000);

  var valid = core.inspectResult(store, "wifi:@2P", "standard-upos", current, 1001);
  assert.strictEqual(valid.status, "valid");
  assert.strictEqual(valid.result.bestHost, best.host);

  var differentNetwork = core.inspectResult(store, "network:unknown", "standard-upos", current, 1001);
  assert.strictEqual(differentNetwork.status, "missing");
  assert.strictEqual(differentNetwork.lastSummary.networkKey, "wifi:@2P");
  assert.strictEqual(differentNetwork.lastSummary.profile, "standard-upos");

  var differentSettings = core.inspectResult(
    store,
    "wifi:@2P",
    "standard-upos",
    settings({ Route: "DIRECT" }),
    1001
  );
  assert.strictEqual(differentSettings.status, "settings-mismatch");
});

test("xy_usource accepts a safe Bilibili host and rejects arbitrary targets", function () {
  var safe = "http://edge.szbdyd.com:4480/upgcxcode/a.m4s?xy_usource=" +
    encodeURIComponent("upos-tf-all-tx.bilivideo.com");
  var unsafe = "http://edge.szbdyd.com:4480/upgcxcode/a.m4s?xy_usource=" +
    encodeURIComponent("https://evil.example/a");
  assert.strictEqual(core.extractValidatedXySourceHost(safe), "upos-tf-all-tx.bilivideo.com");
  assert.strictEqual(core.extractValidatedXySourceHost(unsafe), null);
  assert.strictEqual(core.extractValidatedXySourceHost(
    "http://edge.szbdyd.com:4480/upgcxcode/a.m4s?xy_usource=" +
      encodeURIComponent("https://upos-tf-all-tx.bilivideo.com:8443/a")
  ), null);
});

test("MCDN proxy wraps the exact URL once", function () {
  var original = request("https://xy.mcdn.bilivideo.cn:4483/upgcxcode/a.m4s?upsig=a%2Bb", {
    Host: "xy.mcdn.bilivideo.cn:4483"
  });
  var wrapped = core.wrapMcdnProxyOnce(original);
  assert.strictEqual(wrapped.url,
    "http://proxy-tf-all-ws.bilivideo.com/?url=" + encodeURIComponent(original.url));
  assert.strictEqual(wrapped.headers.Host, "proxy-tf-all-ws.bilivideo.com");
  assert.strictEqual(core.wrapMcdnProxyOnce(request(wrapped.url, wrapped.headers)), null);
});

test("profile switches enforce independent safety gates", function () {
  var defaults = settings();
  assert.strictEqual(core.profileAllowed("standard-upos", defaults), true);
  assert.strictEqual(core.profileAllowed("standard-bstar", defaults), false);
  assert.strictEqual(core.profileAllowed("akamai", defaults), false);
  assert.strictEqual(core.profileAllowed("standard-bstar", settings({ BStarAsStandard: true })), true);
  assert.strictEqual(core.profileAllowed("akamai", settings({ RewriteAkamai: true })), true);
});

test("network key uses SSID and has a safe unknown fallback", function () {
  assert.deepStrictEqual(core.getNetworkInfo({ getConfig: function () { return '{"ssid":"Home-5G"}'; } }),
    { key: "wifi:Home-5G", label: "Wi-Fi: Home-5G" });
  assert.deepStrictEqual(core.getNetworkInfo({ getConfig: function () { return "invalid"; } }),
    { key: "network:unknown", label: "网络: unknown" });
});

test("serial benchmark sends one job at a time and returns a ranking", function () {
  var current = settings({
    Candidates: "upos-tf-all-hw.bilivideo.com,upos-tf-all-tx.bilivideo.com",
    Rounds: "2"
  });
  var calls = [];
  var httpClient = {
    get: function (params, callback) {
      calls.push(params);
      assert.strictEqual(calls.length <= 4, true);
      callback(null, {
        status: 206,
        headers: {
          "Content-Range": "bytes 0-524287/9999999",
          "Content-Type": "video/mp4"
        }
      }, binary(524288));
    }
  };
  var logger = { info: function () {} };
  var capture = {
    url: "https://upos-a.bilivideo.com/upgcxcode/a.m4s?token=secret",
    range: "bytes=0-",
    headers: {},
    sourceHost: "upos-a.bilivideo.com"
  };
  var callbackCalled = false;
  core.benchmarkSerially(capture, current, httpClient, logger, function (error, ranking) {
    assert.ifError(error);
    assert.strictEqual(calls.length, 4);
    assert.strictEqual(ranking.length, 2);
    assert.strictEqual(ranking[0].success, true);
    calls.forEach(function (call) {
      assert.strictEqual(call.headers[core.constants.PROBE_HEADER], "1");
      assert.strictEqual(call["binary-mode"], true);
      assert.strictEqual(call["auto-redirect"], false);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(call, "node"), false);
    });
    callbackCalled = true;
  });
  assert.strictEqual(callbackCalled, true);
});

test("manual benchmark explains missing capture in the generic result page", function () {
  var store = memoryStore();
  var notifications = [];
  var outputs = [];
  var unusedHttpClient = { get: function () { throw new Error("must not probe without a capture"); } };

  core.runManualBenchmark(
    runtimeFor(store, function (value) { outputs.push(value); }, unusedHttpClient, notifications),
    settings({})
  );

  assert.strictEqual(outputs.length, 1);
  assert.strictEqual(outputs[0].title, "Bilibili CDN 暂无可测速样本");
  assert.ok(outputs[0].htmlMessage.indexOf("5 分钟内") >= 0);
  assert.strictEqual(notifications[0].title, "Bilibili CDN 暂无可测速样本");
});

test("end-to-end manual flow captures, benchmarks, caches, and rewrites the next request", function () {
  var store = memoryStore();
  var current = settings({
    Candidates: "upos-tf-all-hw.bilivideo.com,upos-tf-all-tx.bilivideo.com"
  });
  var source = request(
    "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s?upsig=secret%2Bvalue",
    { Range: "bytes=4096-", Cookie: "must-not-be-saved" }
  );
  var requestDone = [];
  var notifications = [];

  core.handleRequest(runtimeFor(store, function (value) { requestDone.push(value); }, null, notifications),
    source, current);
  assert.deepStrictEqual(requestDone, [{}]);
  assert.ok(core.findLatestCapture(store, "wifi:test", Date.now()));

  var httpClient = {
    get: function (params, callback) {
      var range = core.buildFixedProbeRange("bytes=4096-", current.probeBytes);
      callback(null, {
        status: 206,
        headers: {
          "Content-Range": "bytes " + range.start + "-" + range.end + "/9999999",
          "Content-Type": "video/mp4"
        }
      }, binary(current.probeBytes));
    }
  };
  var manualOutputs = [];
  core.runManualBenchmark(
    runtimeFor(store, function (value) { manualOutputs.push(value); }, httpClient, notifications),
    current
  );
  assert.strictEqual(manualOutputs.length, 1);
  assert.strictEqual(manualOutputs[0].title, "Bilibili CDN 测速完成");
  assert.ok(manualOutputs[0].htmlMessage.indexOf("已选择") >= 0);
  assert.strictEqual(notifications[notifications.length - 1].title, "Bilibili CDN 测速完成");
  assert.ok(core.readValidResult(store, "wifi:test", "standard-upos", current, Date.now()));

  var rewriteDone = [];
  core.handleRequest(runtimeFor(store, function (value) { rewriteDone.push(value); }, null, notifications),
    source, current);
  assert.strictEqual(rewriteDone.length, 1);
  assert.strictEqual(rewriteDone[0].url,
    "https://upos-tf-all-hw.bilivideo.com/upgcxcode/a.m4s?upsig=secret%2Bvalue");
  assert.strictEqual(rewriteDone[0].headers.Host, "upos-tf-all-hw.bilivideo.com");
  assert.strictEqual(rewriteDone[0].headers.Range, "bytes=4096-");
  assert.strictEqual(rewriteDone[0].headers.Cookie, "must-not-be-saved");
});

test("end-to-end all-candidate failure saves no best host and preserves playback", function () {
  var store = memoryStore();
  var current = settings({ Candidates: "upos-tf-all-hw.bilivideo.com" });
  var source = request(
    "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s?upsig=secret",
    { Range: "bytes=0-" }
  );
  var notifications = [];
  core.handleRequest(runtimeFor(store, function () {}, null, notifications), source, current);

  var manualOutputs = [];
  core.runManualBenchmark(runtimeFor(store, function (value) { manualOutputs.push(value); }, {
    get: function (_params, callback) {
      callback(null, { status: 403, headers: { "Content-Type": "text/html" } }, binary(10));
    }
  }, notifications), current);

  assert.strictEqual(manualOutputs.length, 1);
  assert.strictEqual(manualOutputs[0].title, "Bilibili CDN 测速全部失败");
  assert.ok(manualOutputs[0].htmlMessage.indexOf("原始播放路线未被修改") >= 0);
  assert.strictEqual(notifications[notifications.length - 1].title, "Bilibili CDN 测速全部失败");
  assert.strictEqual(core.readValidResult(store, "wifi:test", "standard-upos", current, Date.now()), null);

  var nextDone = [];
  core.handleRequest(runtimeFor(store, function (value) { nextDone.push(value); }, null, notifications),
    source, current);
  assert.deepStrictEqual(nextDone, [{}]);
});

test("BStar stays untouched by default and captures only in its own enabled profile", function () {
  var source = request(
    "https://upos-bstar1-mirrorakam.akamaized.net/upgcxcode/a.m4s?token=secret",
    { Range: "bytes=0-" }
  );
  var store = memoryStore();
  var notifications = [];
  var outputs = [];

  core.handleRequest(runtimeFor(store, function (value) { outputs.push(value); }, null, notifications),
    source, settings());
  assert.deepStrictEqual(outputs, [{}]);
  assert.strictEqual(core.findLatestCapture(store, "wifi:test", Date.now()), null);

  core.handleRequest(runtimeFor(store, function (value) { outputs.push(value); }, null, notifications),
    source, settings({ BStarAsStandard: true }));
  var capture = core.findLatestCapture(store, "wifi:test", Date.now());
  assert.strictEqual(capture.profile, "standard-bstar");
  assert.strictEqual(capture.trafficClass, "bstar");
});

test("MCDN default request path uses the independent proxy wrapper", function () {
  var outputs = [];
  var source = request(
    "https://xy.mcdn.bilivideo.cn:4483/upgcxcode/a.m4s?token=a%2Bb",
    { Host: "xy.mcdn.bilivideo.cn:4483" }
  );
  core.handleRequest(runtimeFor(memoryStore(), function (value) { outputs.push(value); }, null, []),
    source, settings());
  assert.strictEqual(outputs.length, 1);
  assert.strictEqual(outputs[0].url,
    "http://proxy-tf-all-ws.bilivideo.com/?url=" + encodeURIComponent(source.url));
});

test("Loon-style globals dispatch request, generic, and cached request entries", function () {
  var scriptSource = fs.readFileSync(require.resolve("../scripts/bilibili-auto-cdn.js"), "utf8");
  var store = memoryStore();
  var notices = [];
  var current = settings({ Candidates: "upos-tf-all-hw.bilivideo.com" });
  var rawArguments = {
    Candidates: current.candidates.join(","),
    ProbeBytes: String(current.probeBytes),
    TimeoutMs: String(current.timeoutMs),
    Rounds: String(current.rounds),
    CacheMinutes: String(current.cacheMinutes),
    Route: current.route,
    PCDNStrategy: current.pcdnStrategy,
    MCDNStrategy: current.mcdnStrategy,
    BStarAsStandard: current.bStarAsStandard,
    RewriteAkamai: current.rewriteAkamai,
    LogLevel: "WARN"
  };
  var source = request(
    "https://upos-sz-mirrorali.bilivideo.com/upgcxcode/a.m4s?upsig=vm-secret",
    { Range: "bytes=0-" }
  );

  function baseGlobals(done) {
    return {
      $argument: rawArguments,
      $persistentStore: store,
      $notification: { post: function (title) { notices.push(title); } },
      $config: { getConfig: function () { return '{"ssid":"test"}'; } },
      $done: done,
      console: { log: function () {} },
      Uint8Array: Uint8Array,
      ArrayBuffer: ArrayBuffer,
      setTimeout: setTimeout,
      clearTimeout: clearTimeout
    };
  }

  var firstDone = [];
  var requestGlobals = baseGlobals(function (value) { firstDone.push(value); });
  requestGlobals.$request = source;
  vm.runInNewContext(scriptSource, requestGlobals, { filename: "bilibili-auto-cdn.js" });
  assert.strictEqual(firstDone.length, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(firstDone[0])), {});

  var genericOutputs = [];
  var genericGlobals = baseGlobals(function (value) { genericOutputs.push(value); });
  genericGlobals.$httpClient = {
    get: function (params, callback) {
      var match = /^bytes=(\d+)-(\d+)$/.exec(params.headers.Range);
      callback(null, {
        status: 206,
        headers: {
          "Content-Range": "bytes " + match[1] + "-" + match[2] + "/9999999",
          "Content-Type": "video/mp4"
        }
      }, binary(current.probeBytes));
    }
  };
  vm.runInNewContext(scriptSource, genericGlobals, { filename: "bilibili-auto-cdn.js" });
  assert.strictEqual(genericOutputs.length, 1);
  assert.strictEqual(genericOutputs[0].title, "Bilibili CDN 测速完成");
  assert.ok(genericOutputs[0].htmlMessage.indexOf("已选择") >= 0);
  assert.strictEqual(notices[notices.length - 1], "Bilibili CDN 测速完成");

  var finalDone = [];
  var finalGlobals = baseGlobals(function (value) { finalDone.push(value); });
  finalGlobals.$request = source;
  vm.runInNewContext(scriptSource, finalGlobals, { filename: "bilibili-auto-cdn.js" });
  assert.strictEqual(finalDone[0].url,
    "https://upos-tf-all-hw.bilivideo.com/upgcxcode/a.m4s?upsig=vm-secret");
});

process.stdout.write("\n" + passed + " passed, " + failed + " failed\n");
if (failed) process.exit(1);
