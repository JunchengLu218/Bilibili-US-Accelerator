/*
 * Bilibili US Auto Accelerator for Loon - experimental first version
 *
 * This file deliberately uses old-fashioned `var` and callback functions.
 * They are a little more verbose than async/await, but work on more Loon builds
 * and make it obvious when `$done()` is finally called.
 *
 * The script has two entry modes:
 *   1. http-request: classify a media request, reuse a valid result, or save a
 *      short-lived sample URL for later. It never benchmarks in the first
 *      version, so the first playback request is not held up.
 *   2. generic: benchmark the newest saved sample serially, cache the ranking,
 *      notify the user, and finish. A later App request uses the cached host.
 */

(function () {
  "use strict";

  var SCHEMA_VERSION = 2;
  var STORE_PREFIX = "bili_auto_cdn:v2";
  var LAST_RESULT_SUMMARY_KEY = STORE_PREFIX + ":last-result-summary";
  var PROBE_HEADER = "X-Bili-CDN-Probe";
  var CAPTURE_TTL_MS = 5 * 60 * 1000;
  var UNKNOWN_NETWORK_CACHE_MAX_MS = 15 * 60 * 1000;
  var MCDN_PROXY_HOST = "proxy-tf-all-ws.bilivideo.com";

  var DEFAULT_CANDIDATES = [
    "upos-sz-mirroraliov.bilivideo.com",
    "upos-tf-all-hw.bilivideo.com",
    "upos-tf-all-tx.bilivideo.com",
    "upos-sz-mirrorali.bilivideo.com"
  ];

  var PROFILES = [
    "standard-upos",
    "standard-bstar",
    "pcdn",
    "mcdn",
    "akamai"
  ];

  var LOG_LEVELS = { DEBUG: 10, INFO: 20, WARN: 30 };

  /* -----------------------------------------------------------------------
   * Small, pure helpers
   * -------------------------------------------------------------------- */

  function trim(value) {
    return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  }

  function lower(value) {
    return trim(value).toLowerCase();
  }

  function contains(list, value) {
    return list.indexOf(value) !== -1;
  }

  function toInteger(value, allowed, fallback) {
    var number = parseInt(value, 10);
    return contains(allowed, number) ? number : fallback;
  }

  function toBoolean(value, fallback) {
    if (value === true || lower(value) === "true" || String(value) === "1") {
      return true;
    }
    if (value === false || lower(value) === "false" || String(value) === "0") {
      return false;
    }
    return fallback;
  }

  function enumValue(value, allowed, fallback) {
    var normalized = lower(value);
    return contains(allowed, normalized) ? normalized : fallback;
  }

  function getArgument(raw, name) {
    if (!raw || typeof raw !== "object") return undefined;
    if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];

    /* Be forgiving if a future Loon build changes only the key casing. */
    var wanted = name.toLowerCase();
    var keys = Object.keys(raw);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].toLowerCase() === wanted) return raw[keys[i]];
    }
    return undefined;
  }

  /**
   * A candidate receives the original signed path, so the allowlist must be
   * intentionally narrow. A syntactically valid arbitrary hostname is unsafe.
   */
  function validateCandidateHost(value) {
    var host = lower(value);
    if (!host || !/^[a-z0-9.-]+$/.test(host)) return false;
    if (!/^(?:upos-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com$/.test(host)) {
      return false;
    }
    if (host.indexOf("bstar") !== -1) return false;
    if (host.indexOf("mcdn") !== -1) return false;
    if (host === MCDN_PROXY_HOST) return false;
    return true;
  }

  function parseCandidates(value) {
    var source = trim(value) ? String(value).split(",") : DEFAULT_CANDIDATES.slice();
    var valid = [];
    var rejected = [];

    for (var i = 0; i < source.length; i += 1) {
      var host = lower(source[i]);
      if (validateCandidateHost(host)) {
        /* Repeated safe hosts are harmless; silently keep only the first one. */
        if (valid.indexOf(host) === -1) valid.push(host);
      } else if (host) {
        rejected.push(host);
      }
    }

    /* Never let one bad edit turn the candidate pool into an arbitrary host. */
    if (valid.length === 0) valid = DEFAULT_CANDIDATES.slice();
    return { valid: valid, rejected: rejected };
  }

  function parseSettings(raw) {
    var candidateResult = parseCandidates(getArgument(raw, "Candidates"));
    var route = trim(getArgument(raw, "Route")) || "follow-rule";

    /* A policy name is not a URL. Reject control characters and absurd input. */
    if (route.length > 128 || /[\r\n\0]/.test(route)) route = "follow-rule";

    return {
      mode: "manual",
      candidates: candidateResult.valid,
      rejectedCandidates: candidateResult.rejected,
      bStarAsStandard: toBoolean(getArgument(raw, "BStarAsStandard"), false),
      pcdnStrategy: enumValue(
        getArgument(raw, "PCDNStrategy"),
        ["best-upos", "xy-usource", "passthrough"],
        "best-upos"
      ),
      mcdnStrategy: enumValue(
        getArgument(raw, "MCDNStrategy"),
        ["proxy-all", "proxy-upgcxcode", "best-upos", "passthrough"],
        "proxy-all"
      ),
      rewriteAkamai: toBoolean(getArgument(raw, "RewriteAkamai"), false),
      liveStrategy: "passthrough",
      probeBytes: toInteger(getArgument(raw, "ProbeBytes"), [524288, 1048576, 2097152], 1048576),
      timeoutMs: toInteger(getArgument(raw, "TimeoutMs"), [2000, 3000, 5000], 3000),
      rounds: toInteger(getArgument(raw, "Rounds"), [1, 2, 3], 1),
      cacheMinutes: toInteger(getArgument(raw, "CacheMinutes"), [15, 60, 360], 60),
      route: route,
      logLevel: String(getArgument(raw, "LogLevel") || "WARN").toUpperCase()
    };
  }

  /**
   * Parse only the scheme and authority. We intentionally keep `tail` as the
   * original byte-for-byte pathname/query/hash string so signed parameters are
   * never decoded, reordered, or encoded again.
   */
  function parseRawUrl(url) {
    if (typeof url !== "string") return null;
    var match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]+)([\s\S]*)$/.exec(url);
    if (!match) return null;

    var scheme = match[1].toLowerCase();
    var authority = match[2];
    var tail = match[3] || "";
    if (authority.indexOf("@") !== -1) return null;

    var hostname = "";
    var port = "";

    if (authority.charAt(0) === "[") {
      var bracket = authority.indexOf("]");
      if (bracket === -1) return null;
      hostname = authority.slice(0, bracket + 1).toLowerCase();
      if (authority.length > bracket + 1) {
        if (authority.charAt(bracket + 1) !== ":") return null;
        port = authority.slice(bracket + 2);
      }
    } else {
      var colon = authority.lastIndexOf(":");
      if (colon !== -1 && authority.indexOf(":") === colon) {
        hostname = authority.slice(0, colon).toLowerCase();
        port = authority.slice(colon + 1);
      } else {
        hostname = authority.toLowerCase();
      }
    }

    if (!hostname) return null;
    if (port && !/^\d{1,5}$/.test(port)) return null;
    if (port && (parseInt(port, 10) < 1 || parseInt(port, 10) > 65535)) return null;

    var queryAt = tail.indexOf("?");
    var hashAt = tail.indexOf("#");
    var pathEnd = tail.length;
    if (queryAt !== -1 && queryAt < pathEnd) pathEnd = queryAt;
    if (hashAt !== -1 && hashAt < pathEnd) pathEnd = hashAt;

    return {
      scheme: scheme,
      hostname: hostname,
      port: port,
      tail: tail,
      path: tail.slice(0, pathEnd) || "/"
    };
  }

  function isDefaultPort(parsed) {
    if (!parsed || !parsed.port) return true;
    return (parsed.scheme === "http" && parsed.port === "80") ||
      (parsed.scheme === "https" && parsed.port === "443");
  }

  function replaceHostnameOnly(url, newHost, dropPort) {
    var parsed = parseRawUrl(url);
    if (!parsed || !validateCandidateHost(newHost)) return null;
    var portPart = !dropPort && parsed.port ? ":" + parsed.port : "";
    return parsed.scheme + "://" + lower(newHost) + portPart + parsed.tail;
  }

  function isIpv4(hostname) {
    var parts = hostname.split(".");
    if (parts.length !== 4) return false;
    for (var i = 0; i < parts.length; i += 1) {
      if (!/^\d{1,3}$/.test(parts[i])) return false;
      if (parseInt(parts[i], 10) > 255) return false;
    }
    return true;
  }

  function hasQueryFlag(rawTail, name, expected) {
    var queryAt = rawTail.indexOf("?");
    if (queryAt === -1) return false;
    var query = rawTail.slice(queryAt + 1).split("#")[0];
    var pieces = query.split("&");
    for (var i = 0; i < pieces.length; i += 1) {
      var equalAt = pieces[i].indexOf("=");
      var key = lower(equalAt === -1 ? pieces[i] : pieces[i].slice(0, equalAt));
      var value = lower(equalAt === -1 ? "" : pieces[i].slice(equalAt + 1));
      if (key === lower(name) && (expected == null || value === lower(expected))) return true;
    }
    return false;
  }

  /** Classification order is security-relevant; do not casually reorder it. */
  function classifyRequest(request) {
    if (!request || String(request.method || "GET").toUpperCase() !== "GET") return "unknown";
    var parsed = parseRawUrl(request.url);
    if (!parsed || (parsed.scheme !== "http" && parsed.scheme !== "https")) return "unknown";

    var host = parsed.hostname;
    var path = parsed.path.toLowerCase();

    /* 1. Live paths must never fall into the VOD host-swap branch. */
    if (path.indexOf("/live-bvc/") !== -1) return "live";

    /* 2. MCDN comes before the broad non-standard-port PCDN heuristic. */
    if (/\.mcdn\.bilivideo\.(?:cn|com|net)$/.test(host) || host === MCDN_PROXY_HOST) {
      return "mcdn";
    }

    /* 3. PCDN signals are intentionally heuristic and are kept explicit. */
    if (
      parsed.port === "4480" ||
      parsed.port === "4483" ||
      parsed.port === "8000" ||
      parsed.port === "8082" ||
      parsed.port === "9102" ||
      isIpv4(host) ||
      /(?:^|\.)[^.]*mountaintoys\.cn$/.test(host) ||
      /(?:^|\.)[^.]*szbdyd\.com$/.test(host) ||
      hasQueryFlag(parsed.tail, "os", "mcdn") ||
      hasQueryFlag(parsed.tail, "xy_usource", null)
    ) {
      return "pcdn";
    }

    /* 4. BStar must come before Akamai: bstar1 also has an Akamai hostname. */
    if (host.indexOf("bstar1") !== -1) return "bstar";

    /* 5. Akamai is a source category, never a candidate target. */
    if (/^upos-[a-z0-9-]+-mirrorakam\.akamaized\.net$/.test(host)) return "akamai";

    /* 6. Normal UPOS includes overseas, TF, Ali and Hong Kong families. */
    if (
      path.indexOf("/upgcxcode/") !== -1 &&
      /^(?:upos-[a-z0-9-]+|cn-hk-eq-[a-z0-9-]+)\.bilivideo\.com$/.test(host) &&
      isDefaultPort(parsed)
    ) {
      return "ordinary";
    }

    return "unknown";
  }

  function getHeaderCaseInsensitive(headers, wantedName) {
    if (!headers || typeof headers !== "object") return undefined;
    var wanted = wantedName.toLowerCase();
    var names = Object.keys(headers);
    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === wanted) return headers[names[i]];
    }
    return undefined;
  }

  function setHeaderCaseInsensitive(headers, wantedName, value, onlyIfPresent) {
    var copy = headers || {};
    var wanted = wantedName.toLowerCase();
    var names = Object.keys(copy);
    var found = false;

    for (var i = 0; i < names.length; i += 1) {
      if (names[i].toLowerCase() === wanted) {
        copy[names[i]] = value;
        found = true;
      }
    }

    if (!found && !onlyIfPresent) copy[wantedName] = value;
    return copy;
  }

  function isProbeRequest(headers) {
    return String(getHeaderCaseInsensitive(headers, PROBE_HEADER) || "") === "1";
  }

  function rewriteToHost(request, bestHost, dropPort) {
    var rewrittenUrl = replaceHostnameOnly(request.url, bestHost, dropPort);
    if (!rewrittenUrl) return null;

    var parsed = parseRawUrl(rewrittenUrl);
    var authority = parsed.hostname + (parsed.port ? ":" + parsed.port : "");
    var headers = {};
    var originalHeaders = request.headers || {};
    var names = Object.keys(originalHeaders);
    for (var i = 0; i < names.length; i += 1) headers[names[i]] = originalHeaders[names[i]];

    setHeaderCaseInsensitive(headers, "Host", authority, false);
    setHeaderCaseInsensitive(headers, ":authority", authority, true);
    return { url: rewrittenUrl, headers: headers };
  }

  /**
   * Convert `bytes=8388608-` to an exact, bounded one-megabyte request. Multi-
   * range and suffix ranges are rejected because guessing could fetch too much.
   */
  function buildFixedProbeRange(originalRange, probeBytes) {
    var text = trim(originalRange);
    var start = 0;

    if (text) {
      if (text.indexOf(",") !== -1) return null;
      var match = /^bytes=(\d+)-(\d*)$/i.exec(text);
      if (!match) return null;
      start = parseInt(match[1], 10);
      if (!isFinite(start) || start < 0) return null;
    }

    var end = start + probeBytes - 1;
    if (!isFinite(end) || end < start) return null;
    return {
      start: start,
      end: end,
      expectedBytes: probeBytes,
      header: "bytes=" + start + "-" + end
    };
  }

  function parseContentRange(value) {
    var match = /^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i.exec(trim(value));
    if (!match) return null;
    return {
      start: parseInt(match[1], 10),
      end: parseInt(match[2], 10),
      total: match[3]
    };
  }

  function binaryLength(data) {
    if (typeof Uint8Array !== "undefined" && data instanceof Uint8Array) return data.byteLength;
    if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) return data.byteLength;
    return 0;
  }

  /** Accept only a controlled binary 206 response for the requested range. */
  function validateProbe(host, rangeInfo, error, response, data, elapsedMs) {
    var status = response && parseInt(response.status || response.statusCode, 10);
    var headers = response && response.headers ? response.headers : {};
    var contentRange = parseContentRange(getHeaderCaseInsensitive(headers, "Content-Range"));
    var contentType = lower(getHeaderCaseInsensitive(headers, "Content-Type"));
    var bytes = binaryLength(data);
    var minimumBytes = Math.floor(rangeInfo.expectedBytes * 0.9);
    var maximumBytes = rangeInfo.expectedBytes + 1024;

    var reason = "ok";
    if (error) reason = "network-error";
    else if (status !== 206) reason = "http-" + (status || "unknown");
    else if (!contentRange) reason = "invalid-content-range";
    else if (contentRange.start !== rangeInfo.start) reason = "range-start-mismatch";
    else if (contentRange.end < contentRange.start || contentRange.end > rangeInfo.end) reason = "range-end-mismatch";
    else if (!bytes) reason = "non-binary-body";
    else if (bytes !== contentRange.end - contentRange.start + 1) reason = "range-length-mismatch";
    else if (bytes < minimumBytes) reason = "body-too-small";
    else if (bytes > maximumBytes) reason = "body-too-large";
    else if (/html|json|xml/.test(contentType)) reason = "unexpected-content-type";

    var success = reason === "ok";
    return {
      host: host,
      success: success,
      status: status || 0,
      bytes: bytes,
      elapsedMs: elapsedMs,
      effectiveMbps: success && elapsedMs > 0 ? bytes * 8 / elapsedMs / 1000 : 0,
      reason: reason
    };
  }

  function median(numbers) {
    if (!numbers.length) return 0;
    var sorted = numbers.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function aggregateRanking(rawResults, candidates, rounds) {
    var ranking = [];
    var minimumSuccesses = Math.ceil(rounds / 2);

    for (var i = 0; i < candidates.length; i += 1) {
      var host = candidates[i];
      var hostResults = rawResults.filter(function (item) { return item.host === host; });
      var successes = hostResults.filter(function (item) { return item.success; });
      var mbps = successes.map(function (item) { return item.effectiveMbps; });
      var elapsed = successes.map(function (item) { return item.elapsedMs; });
      var bytes = successes.map(function (item) { return item.bytes; });
      var last = hostResults.length ? hostResults[hostResults.length - 1] : null;
      var accepted = successes.length >= minimumSuccesses;

      ranking.push({
        host: host,
        success: accepted,
        status: accepted ? 206 : (last ? last.status : 0),
        successes: successes.length,
        attempts: hostResults.length,
        bytes: accepted ? Math.round(median(bytes)) : 0,
        elapsedMs: accepted ? Math.round(median(elapsed)) : 0,
        effectiveMbps: accepted ? median(mbps) : 0,
        reason: accepted ? "ok" : (last ? last.reason : "not-tested")
      });
    }

    ranking.sort(function (a, b) {
      if (a.success !== b.success) return a.success ? -1 : 1;
      if (a.effectiveMbps !== b.effectiveMbps) return b.effectiveMbps - a.effectiveMbps;
      return candidates.indexOf(a.host) - candidates.indexOf(b.host);
    });
    return ranking;
  }

  function chooseBest(ranking, currentHost) {
    var successful = ranking.filter(function (item) { return item.success; });
    if (!successful.length) return null;

    var fastest = successful[0];
    var almostTied = successful.filter(function (item) {
      return fastest.effectiveMbps === 0 ||
        (fastest.effectiveMbps - item.effectiveMbps) / fastest.effectiveMbps < 0.05;
    });

    for (var i = 0; i < almostTied.length; i += 1) {
      if (almostTied[i].host === lower(currentHost)) return almostTied[i];
    }
    return fastest;
  }

  /* -----------------------------------------------------------------------
   * Storage and cache helpers
   * -------------------------------------------------------------------- */

  function hashText(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16);
  }

  function settingsFingerprint(settings, profile) {
    return hashText(JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      profile: profile,
      candidates: settings.candidates,
      probeBytes: settings.probeBytes,
      rounds: settings.rounds,
      route: settings.route,
      bStarAsStandard: settings.bStarAsStandard,
      pcdnStrategy: settings.pcdnStrategy,
      mcdnStrategy: settings.mcdnStrategy,
      rewriteAkamai: settings.rewriteAkamai,
      liveStrategy: settings.liveStrategy
    }));
  }

  function storeKey(kind, networkKey, profile) {
    return STORE_PREFIX + ":" + kind + ":" + encodeURIComponent(networkKey) + ":" + profile;
  }

  function readJson(storage, key) {
    try {
      var raw = storage.read(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_error) {
      return null;
    }
  }

  function writeJson(storage, key, value) {
    try {
      return storage.write(JSON.stringify(value), key);
    } catch (_error) {
      return false;
    }
  }

  /*
   * Return a reason as well as the cached value.  A plain null is safe for
   * normal operation, but it cannot tell a tester whether the current script
   * saw a different Wi-Fi name, different plugin arguments, an expired entry,
   * or no shared storage entry at all.
   */
  function inspectResult(storage, networkKey, profile, settings, now) {
    var key = storeKey("result", networkKey, profile);
    var currentFingerprint = settingsFingerprint(settings, profile);
    var result = readJson(storage, key);
    var status = "valid";

    if (!result) status = "missing";
    else if (result.schemaVersion !== SCHEMA_VERSION) status = "schema-mismatch";
    else if (result.networkKey !== networkKey) status = "network-mismatch";
    else if (result.profile !== profile) status = "profile-mismatch";
    else if (result.settingsFingerprint !== currentFingerprint) status = "settings-mismatch";
    else if (!result.expiresAt || result.expiresAt <= now) status = "expired";
    else if (!validateCandidateHost(result.bestHost)) status = "invalid-best-host";
    else if (settings.candidates.indexOf(result.bestHost) === -1) status = "best-host-not-in-candidates";

    return {
      status: status,
      key: key,
      networkKey: networkKey,
      profile: profile,
      currentFingerprint: currentFingerprint,
      storedFingerprint: result && result.settingsFingerprint ? result.settingsFingerprint : "none",
      result: status === "valid" ? result : null,
      lastSummary: readJson(storage, LAST_RESULT_SUMMARY_KEY)
    };
  }

  function readValidResult(storage, networkKey, profile, settings, now) {
    return inspectResult(storage, networkKey, profile, settings, now).result;
  }

  function shortFingerprint(value) {
    var text = trim(value);
    return text ? text.slice(0, 8) : "none";
  }

  function cacheInspectionLog(inspection) {
    var parts = [
      "Cache lookup status=" + inspection.status,
      "network=" + inspection.networkKey,
      "profile=" + inspection.profile,
      "current-fp=" + shortFingerprint(inspection.currentFingerprint),
      "stored-fp=" + shortFingerprint(inspection.storedFingerprint)
    ];
    var last = inspection.lastSummary;
    if (last) {
      parts.push(
        "last=" + String(last.networkKey || "unknown") + "/" +
        String(last.profile || "unknown") + "/" +
        shortFingerprint(last.settingsFingerprint)
      );
    } else {
      parts.push("last=none");
    }
    return parts.join(" ");
  }

  function saveCapture(storage, networkKey, profile, trafficClass, request, benchmarkUrl, settings, now) {
    var headers = request.headers || {};
    var safeHeaders = {};
    var optionalHeaders = ["User-Agent", "Referer", "Origin"];

    for (var i = 0; i < optionalHeaders.length; i += 1) {
      var value = getHeaderCaseInsensitive(headers, optionalHeaders[i]);
      if (value) safeHeaders[optionalHeaders[i]] = String(value);
    }

    /* sourceHost describes the App request, not the temporary candidate URL
     * used to normalize a PCDN/MCDN sample. This matters for tie handling. */
    var parsed = parseRawUrl(request.url);
    var capture = {
      schemaVersion: SCHEMA_VERSION,
      networkKey: networkKey,
      profile: profile,
      trafficClass: trafficClass,
      url: benchmarkUrl,
      sourceHost: parsed ? parsed.hostname : "unknown",
      range: String(getHeaderCaseInsensitive(headers, "Range") || ""),
      headers: safeHeaders,
      capturedAt: now,
      expiresAt: now + CAPTURE_TTL_MS,
      settingsFingerprint: settingsFingerprint(settings, profile)
    };

    return writeJson(storage, storeKey("capture", networkKey, profile), capture);
  }

  function expireCapture(storage, networkKey, profile) {
    /* Loon remove() clears all script data, so overwrite only this one key. */
    return writeJson(storage, storeKey("capture", networkKey, profile), {
      schemaVersion: SCHEMA_VERSION,
      networkKey: networkKey,
      profile: profile,
      expiresAt: 0
    });
  }

  function findLatestCapture(storage, networkKey, now) {
    var latest = null;
    for (var i = 0; i < PROFILES.length; i += 1) {
      var item = readJson(storage, storeKey("capture", networkKey, PROFILES[i]));
      if (!item || item.networkKey !== networkKey || item.profile !== PROFILES[i]) continue;
      if (!item.expiresAt || item.expiresAt <= now || !parseRawUrl(item.url)) continue;
      if (!latest || item.capturedAt > latest.capturedAt) latest = item;
    }
    return latest;
  }

  function acquireLock(storage, networkKey, profile, settings, now) {
    var key = storeKey("lock", networkKey, profile);
    var existing = readJson(storage, key);
    if (existing && existing.expiresAt > now) return null;

    var maximumWorkMs = settings.candidates.length * settings.rounds * settings.timeoutMs + 10000;
    var owner = String(now) + "-" + String(Math.floor(Math.random() * 1000000));
    var lock = { owner: owner, startedAt: now, expiresAt: now + Math.min(maximumWorkMs, 110000) };
    if (!writeJson(storage, key, lock)) return null;
    return owner;
  }

  function releaseLock(storage, networkKey, profile, owner) {
    var key = storeKey("lock", networkKey, profile);
    var existing = readJson(storage, key);
    if (existing && existing.owner !== owner) return false;
    return writeJson(storage, key, { owner: owner, expiresAt: 0 });
  }

  function saveResult(storage, networkKey, capture, settings, ranking, best, now) {
    var cacheMs = settings.cacheMinutes * 60 * 1000;
    if (networkKey === "network:unknown") {
      cacheMs = Math.min(cacheMs, UNKNOWN_NETWORK_CACHE_MAX_MS);
    }

    var result = {
      schemaVersion: SCHEMA_VERSION,
      networkKey: networkKey,
      candidateFingerprint: hashText(settings.candidates.join("|")),
      settingsFingerprint: settingsFingerprint(settings, capture.profile),
      profile: capture.profile,
      bestHost: best.host,
      ranking: ranking,
      testedAt: now,
      expiresAt: now + cacheMs
    };

    var saved = writeJson(storage, storeKey("result", networkKey, capture.profile), result);
    if (saved) {
      /* This compact record lets another entry explain a missing current-key
       * result without storing the signed video URL or request headers. */
      writeJson(storage, LAST_RESULT_SUMMARY_KEY, {
        schemaVersion: SCHEMA_VERSION,
        networkKey: networkKey,
        profile: capture.profile,
        bestHost: best.host,
        settingsFingerprint: result.settingsFingerprint,
        testedAt: result.testedAt,
        expiresAt: result.expiresAt
      });
    }
    return saved;
  }

  /* -----------------------------------------------------------------------
   * Special traffic helpers
   * -------------------------------------------------------------------- */

  function getRawQueryValue(url, wantedName) {
    var parsed = parseRawUrl(url);
    if (!parsed) return null;
    var queryAt = parsed.tail.indexOf("?");
    if (queryAt === -1) return null;
    var query = parsed.tail.slice(queryAt + 1).split("#")[0].split("&");

    for (var i = 0; i < query.length; i += 1) {
      var equalAt = query[i].indexOf("=");
      var rawKey = equalAt === -1 ? query[i] : query[i].slice(0, equalAt);
      if (lower(rawKey) === lower(wantedName)) {
        return equalAt === -1 ? "" : query[i].slice(equalAt + 1);
      }
    }
    return null;
  }

  function safelyDecode(value) {
    var decoded = value;
    for (var i = 0; i < 2; i += 1) {
      try {
        var next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch (_error) {
        return null;
      }
    }
    return decoded;
  }

  function extractValidatedXySourceHost(url) {
    var raw = getRawQueryValue(url, "xy_usource");
    if (raw == null || raw === "") return null;
    var decoded = safelyDecode(raw.replace(/\+/g, "%20"));
    if (!decoded) return null;

    var possibleHost = lower(decoded);
    var parsed = parseRawUrl(decoded);
    if (parsed) {
      /* A full xy_usource URL is reduced to its host, but only after checking
       * that it is a normal HTTP(S) origin without a surprising port. */
      if ((parsed.scheme !== "http" && parsed.scheme !== "https") || !isDefaultPort(parsed)) return null;
      possibleHost = parsed.hostname;
    }
    return validateCandidateHost(possibleHost) ? possibleHost : null;
  }

  function canonicalizeForCandidateProbe(request, settings) {
    var url = replaceHostnameOnly(request.url, settings.candidates[0], true);
    if (!url) return null;
    var copy = { url: url, method: request.method, headers: request.headers || {} };
    return copy;
  }

  function wrapMcdnProxyOnce(request) {
    var parsed = parseRawUrl(request.url);
    if (!parsed) return null;
    if (parsed.hostname === MCDN_PROXY_HOST && getRawQueryValue(request.url, "url") != null) return null;

    var proxyUrl = "http://" + MCDN_PROXY_HOST + "/?url=" + encodeURIComponent(request.url);
    var headers = {};
    var names = Object.keys(request.headers || {});
    for (var i = 0; i < names.length; i += 1) headers[names[i]] = request.headers[names[i]];
    setHeaderCaseInsensitive(headers, "Host", MCDN_PROXY_HOST, false);
    setHeaderCaseInsensitive(headers, ":authority", MCDN_PROXY_HOST, true);
    return { url: proxyUrl, headers: headers };
  }

  function profileAllowed(profile, settings) {
    if (profile === "standard-upos") return true;
    if (profile === "standard-bstar") return settings.bStarAsStandard;
    if (profile === "pcdn") return settings.pcdnStrategy === "best-upos";
    if (profile === "mcdn") return settings.mcdnStrategy === "best-upos";
    if (profile === "akamai") return settings.rewriteAkamai;
    return false;
  }

  /* -----------------------------------------------------------------------
   * Loon runtime helpers
   * -------------------------------------------------------------------- */

  function getNetworkInfo(configApi) {
    var ssid = "";
    try {
      var config = JSON.parse(configApi.getConfig() || "{}");
      ssid = trim(config.ssid);
    } catch (_error) {
      ssid = "";
    }
    return ssid ? { key: "wifi:" + ssid, label: "Wi-Fi: " + ssid } :
      { key: "network:unknown", label: "网络: unknown" };
  }

  function safeErrorText(error) {
    var text = trim(error && error.message ? error.message : error);
    if (!text) return "unknown error";
    return text.replace(/https?:\/\/\S+/gi, "[URL hidden]").slice(0, 160);
  }

  function createLogger(level) {
    var selected = LOG_LEVELS[level] || LOG_LEVELS.WARN;
    function emit(kind, message) {
      if ((LOG_LEVELS[kind] || 999) < selected) return;
      if (typeof console !== "undefined" && console.log) {
        console.log("[Bili Auto CDN][" + kind + "] " + message);
      }
    }
    return {
      debug: function (message) { emit("DEBUG", message); },
      info: function (message) { emit("INFO", message); },
      warn: function (message) { emit("WARN", message); }
    };
  }

  function notify(notificationApi, title, subtitle, content) {
    if (notificationApi && typeof notificationApi.post === "function") {
      notificationApi.post(title, subtitle, content);
    }
  }

  /*
   * A generic script is opened as a result page inside Loon.  Calling
   * `$done()` without a payload closes the JavaScript engine correctly, but
   * that page can only display "empty content".  Return the same information
   * as the notification so users can always see what happened, even when iOS
   * notification permission is disabled.
   */
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function genericResult(title, subtitle, content) {
    return {
      title: title,
      htmlMessage:
        '<div style="font-family:-apple-system;line-height:1.45;padding:8px">' +
        '<p><strong>' + escapeHtml(subtitle) + '</strong></p>' +
        '<pre style="white-space:pre-wrap;word-break:break-word;font-family:-apple-system">' +
        escapeHtml(content) +
        "</pre></div>"
    };
  }

  function finishManual(runtime, title, subtitle, content) {
    notify(runtime.notification, title, subtitle, content);
    runtime.done(genericResult(title, subtitle, content));
  }

  function benchmarkSerially(capture, settings, httpClient, logger, callback) {
    var rangeInfo = buildFixedProbeRange(capture.range, settings.probeBytes);
    if (!rangeInfo) {
      callback(new Error("捕获到的 Range 格式不支持安全测速"));
      return;
    }

    var completed = false;
    function finishBenchmark(error, ranking) {
      if (completed) return;
      completed = true;
      callback(error, ranking);
    }

    var jobs = [];
    for (var round = 0; round < settings.rounds; round += 1) {
      for (var candidate = 0; candidate < settings.candidates.length; candidate += 1) {
        jobs.push({ round: round + 1, host: settings.candidates[candidate] });
      }
    }

    var rawResults = [];
    var index = 0;

    function runNext() {
      if (index >= jobs.length) {
        finishBenchmark(null, aggregateRanking(rawResults, settings.candidates, settings.rounds));
        return;
      }

      var job = jobs[index];
      index += 1;
      var candidateUrl = replaceHostnameOnly(capture.url, job.host, true);
      if (!candidateUrl) {
        rawResults.push({
          host: job.host,
          success: false,
          status: 0,
          bytes: 0,
          elapsedMs: 0,
          effectiveMbps: 0,
          reason: "invalid-candidate-url"
        });
        runNext();
        return;
      }

      var headers = {};
      var savedHeaderNames = Object.keys(capture.headers || {});
      for (var h = 0; h < savedHeaderNames.length; h += 1) {
        headers[savedHeaderNames[h]] = capture.headers[savedHeaderNames[h]];
      }
      headers.Range = rangeInfo.header;
      headers.Accept = "*/*";
      headers[PROBE_HEADER] = "1";

      var params = {
        url: candidateUrl,
        timeout: settings.timeoutMs,
        headers: headers,
        "binary-mode": true,
        "auto-cookie": false,
        "auto-redirect": false,
        alpn: "h2"
      };
      if (lower(settings.route) !== "follow-rule") params.node = settings.route;

      var startedAt = Date.now();
      logger.info("Probe " + index + "/" + jobs.length + ": " + job.host + " (round " + job.round + ")");

      try {
        httpClient.get(params, function (error, response, data) {
          try {
            var elapsedMs = Math.max(1, Date.now() - startedAt);
            var scored = validateProbe(job.host, rangeInfo, error, response, data, elapsedMs);
            rawResults.push(scored);
            logger.info(job.host + ": " + (scored.success ? scored.effectiveMbps.toFixed(1) + " Mbps" : scored.reason));
            runNext();
          } catch (callbackError) {
            finishBenchmark(callbackError);
          }
        });
      } catch (requestError) {
        finishBenchmark(requestError);
      }
    }

    runNext();
  }

  function rankingNotification(networkInfo, capture, ranking, best, cacheMinutes) {
    var lines = [];
    var shown = ranking.slice(0, 8);
    for (var i = 0; i < shown.length; i += 1) {
      if (shown[i].success) {
        lines.push((i + 1) + ". " + shown[i].host + "  " + shown[i].effectiveMbps.toFixed(1) + " Mbps");
      } else {
        lines.push("- " + shown[i].host + "  失败(" + shown[i].reason + ")");
      }
    }
    lines.push("已选择: " + best.host);
    lines.push("有效期: " + cacheMinutes + " 分钟");
    return {
      subtitle: networkInfo.label + " / " + capture.profile,
      content: lines.join("\n")
    };
  }

  /* -----------------------------------------------------------------------
   * Request entry
   * -------------------------------------------------------------------- */

  function handleBenchmarkableRequest(runtime, request, trafficClass, profile, settings, dropPort) {
    var logger = runtime.logger;
    if (!profileAllowed(profile, settings)) {
      runtime.done({});
      return;
    }

    var rangeInfo = buildFixedProbeRange(getHeaderCaseInsensitive(request.headers, "Range"), settings.probeBytes);
    if (!rangeInfo) {
      logger.warn("Skip capture: unsupported Range format for " + trafficClass);
      runtime.done({});
      return;
    }

    var now = Date.now();
    var inspection = inspectResult(runtime.storage, runtime.network.key, profile, settings, now);
    logger.info(cacheInspectionLog(inspection));
    var result = inspection.result;
    if (result) {
      var rewrite = rewriteToHost(request, result.bestHost, dropPort);
      if (rewrite) {
        logger.info("Apply cached host " + result.bestHost + " for " + profile);
        runtime.done(rewrite);
        return;
      }
    }

    var canonical = dropPort ? canonicalizeForCandidateProbe(request, settings) : request;
    if (!canonical) {
      logger.warn("Skip capture: URL cannot be safely canonicalized for " + trafficClass);
      runtime.done({});
      return;
    }

    saveCapture(
      runtime.storage,
      runtime.network.key,
      profile,
      trafficClass,
      request,
      canonical.url,
      settings,
      now
    );
    logger.info("Captured " + trafficClass + " sample from host " + parseRawUrl(request.url).hostname);
    runtime.done({});
  }

  function handleRequest(runtime, request, settings) {
    if (!request || isProbeRequest(request.headers)) {
      runtime.done({});
      return;
    }

    var trafficClass = classifyRequest(request);
    var parsed = parseRawUrl(request.url);
    runtime.logger.info("Classified host " + (parsed ? parsed.hostname : "unknown") + " as " + trafficClass);

    if (trafficClass === "live" || trafficClass === "unknown") {
      runtime.done({});
      return;
    }

    if (trafficClass === "mcdn") {
      if (settings.mcdnStrategy === "passthrough") {
        runtime.done({});
      } else if (settings.mcdnStrategy === "proxy-all") {
        runtime.done(wrapMcdnProxyOnce(request) || {});
      } else if (settings.mcdnStrategy === "proxy-upgcxcode") {
        runtime.done(parsed.path.toLowerCase().indexOf("/upgcxcode/") !== -1 ? (wrapMcdnProxyOnce(request) || {}) : {});
      } else {
        handleBenchmarkableRequest(runtime, request, trafficClass, "mcdn", settings, true);
      }
      return;
    }

    if (trafficClass === "pcdn") {
      if (settings.pcdnStrategy === "passthrough") {
        runtime.done({});
      } else if (settings.pcdnStrategy === "xy-usource") {
        var sourceHost = extractValidatedXySourceHost(request.url);
        runtime.done(sourceHost ? (rewriteToHost(request, sourceHost, true) || {}) : {});
      } else {
        handleBenchmarkableRequest(runtime, request, trafficClass, "pcdn", settings, true);
      }
      return;
    }

    if (trafficClass === "bstar") {
      if (!settings.bStarAsStandard) {
        runtime.done({});
      } else if (!isDefaultPort(parsed)) {
        runtime.logger.warn("Skip BStar rewrite: source uses a non-default port");
        runtime.done({});
      } else {
        handleBenchmarkableRequest(runtime, request, trafficClass, "standard-bstar", settings, false);
      }
      return;
    }

    if (trafficClass === "akamai") {
      if (!settings.rewriteAkamai) {
        runtime.done({});
      } else if (!isDefaultPort(parsed)) {
        runtime.logger.warn("Skip Akamai rewrite: source uses a non-default port");
        runtime.done({});
      } else {
        handleBenchmarkableRequest(runtime, request, trafficClass, "akamai", settings, false);
      }
      return;
    }

    handleBenchmarkableRequest(runtime, request, trafficClass, "standard-upos", settings, false);
  }

  /* -----------------------------------------------------------------------
   * Manual generic entry
   * -------------------------------------------------------------------- */

  function runManualBenchmark(runtime, settings) {
    var now = Date.now();
    var capture = findLatestCapture(runtime.storage, runtime.network.key, now);

    if (!runtime.httpClient || typeof runtime.httpClient.get !== "function") {
      finishManual(
        runtime,
        "Bilibili CDN 无法开始测速",
        runtime.network.label,
        "当前脚本环境没有可用的 $httpClient.get API。"
      );
      return;
    }

    if (!capture) {
      finishManual(
        runtime,
        "Bilibili CDN 暂无可测速样本",
        runtime.network.label,
        "请先在哔哩哔哩中播放一个未缓存片段，并在 5 分钟内再次运行本脚本。"
      );
      return;
    }

    if (!profileAllowed(capture.profile, settings)) {
      finishManual(
        runtime,
        "Bilibili CDN 样本已被当前设置禁用",
        runtime.network.label + " / " + capture.profile,
        "请播放当前设置允许处理的分片，再重新运行测速。"
      );
      return;
    }

    var owner = acquireLock(runtime.storage, runtime.network.key, capture.profile, settings, now);
    if (!owner) {
      finishManual(
        runtime,
        "Bilibili CDN 测速正在运行",
        runtime.network.label + " / " + capture.profile,
        "检测到尚未过期的测速锁，请稍后再试。"
      );
      return;
    }

    benchmarkSerially(capture, settings, runtime.httpClient, runtime.logger, function (error, ranking) {
      var finishedAt = Date.now();
      releaseLock(runtime.storage, runtime.network.key, capture.profile, owner);

      if (error) {
        runtime.logger.warn("Benchmark stopped: " + safeErrorText(error));
        finishManual(
          runtime,
          "Bilibili CDN 测速未完成",
          runtime.network.label + " / " + capture.profile,
          safeErrorText(error) + "。原始播放路线未被修改。"
        );
        return;
      }

      var best = chooseBest(ranking, capture.sourceHost);
      if (!best) {
        expireCapture(runtime.storage, runtime.network.key, capture.profile);
        finishManual(
          runtime,
          "Bilibili CDN 测速全部失败",
          runtime.network.label + " / " + capture.profile,
          "没有候选通过 206、Content-Range 和二进制长度检查；原始播放路线未被修改。"
        );
        return;
      }

      if (!saveResult(runtime.storage, runtime.network.key, capture, settings, ranking, best, finishedAt)) {
        finishManual(
          runtime,
          "Bilibili CDN 结果保存失败",
          runtime.network.label + " / " + capture.profile,
          "测速已完成，但无法写入 Loon 本地存储；原始播放路线未被修改。"
        );
        return;
      }

      var savedInspection = inspectResult(
        runtime.storage,
        runtime.network.key,
        capture.profile,
        settings,
        finishedAt
      );
      if (savedInspection.status !== "valid") {
        finishManual(
          runtime,
          "Bilibili CDN 结果回读失败",
          runtime.network.label + " / " + capture.profile,
          "缓存写入后无法通过当前设置读取，状态: " + savedInspection.status + "。原始播放路线未被修改。"
        );
        return;
      }

      expireCapture(runtime.storage, runtime.network.key, capture.profile);
      var notice = rankingNotification(runtime.network, capture, ranking, best, settings.cacheMinutes);
      notice.content += "\n缓存网络: " + runtime.network.key;
      notice.content += "\n设置指纹: " + shortFingerprint(savedInspection.currentFingerprint);
      finishManual(runtime, "Bilibili CDN 测速完成", notice.subtitle, notice.content);
    });
  }

  /* Export pure functions for Node unit tests. Loon simply ignores this. */
  var Core = {
    constants: {
      SCHEMA_VERSION: SCHEMA_VERSION,
      STORE_PREFIX: STORE_PREFIX,
      PROBE_HEADER: PROBE_HEADER,
      DEFAULT_CANDIDATES: DEFAULT_CANDIDATES.slice(),
      PROFILES: PROFILES.slice()
    },
    parseSettings: parseSettings,
    validateCandidateHost: validateCandidateHost,
    parseRawUrl: parseRawUrl,
    replaceHostnameOnly: replaceHostnameOnly,
    classifyRequest: classifyRequest,
    getHeaderCaseInsensitive: getHeaderCaseInsensitive,
    setHeaderCaseInsensitive: setHeaderCaseInsensitive,
    isProbeRequest: isProbeRequest,
    rewriteToHost: rewriteToHost,
    buildFixedProbeRange: buildFixedProbeRange,
    parseContentRange: parseContentRange,
    validateProbe: validateProbe,
    aggregateRanking: aggregateRanking,
    chooseBest: chooseBest,
    settingsFingerprint: settingsFingerprint,
    storeKey: storeKey,
    inspectResult: inspectResult,
    readValidResult: readValidResult,
    saveCapture: saveCapture,
    findLatestCapture: findLatestCapture,
    expireCapture: expireCapture,
    acquireLock: acquireLock,
    releaseLock: releaseLock,
    saveResult: saveResult,
    extractValidatedXySourceHost: extractValidatedXySourceHost,
    canonicalizeForCandidateProbe: canonicalizeForCandidateProbe,
    wrapMcdnProxyOnce: wrapMcdnProxyOnce,
    profileAllowed: profileAllowed,
    getNetworkInfo: getNetworkInfo,
    benchmarkSerially: benchmarkSerially,
    handleRequest: handleRequest,
    runManualBenchmark: runManualBenchmark
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Core;

  /* In Node tests there is no `$done`, so stop before touching Loon globals. */
  if (typeof $done === "undefined") return;

  var settings = parseSettings(typeof $argument !== "undefined" ? $argument : {});
  var logger = createLogger(settings.logLevel);
  if (settings.rejectedCandidates.length) {
    logger.warn("Ignored " + settings.rejectedCandidates.length + " invalid candidate host(s)");
  }

  var hasFinished = false;
  function finish(payload) {
    if (hasFinished) return;
    hasFinished = true;
    if (arguments.length === 0) $done();
    else $done(payload);
  }

  var runtime = {
    storage: $persistentStore,
    notification: typeof $notification !== "undefined" ? $notification : null,
    httpClient: typeof $httpClient !== "undefined" ? $httpClient : null,
    network: getNetworkInfo($config),
    logger: logger,
    done: finish
  };

  try {
    if (typeof $request !== "undefined" && typeof $response === "undefined") {
      handleRequest(runtime, $request, settings);
    } else if (typeof $request === "undefined" && typeof $response === "undefined") {
      runManualBenchmark(runtime, settings);
    } else {
      /* The initial plugin deliberately has no http-response mutation. */
      finish({});
    }
  } catch (error) {
    logger.warn("Unhandled error: " + safeErrorText(error));
    if (typeof $request !== "undefined") finish({});
    else {
      finishManual(runtime, "Bilibili CDN 脚本异常", runtime.network.label, safeErrorText(error));
    }
  }
}());
