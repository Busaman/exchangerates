import { AnonymousZenCookieJar, parseSetCookieName } from "./zen-session-policy.mjs";
import https from "node:https";
import Decimal from "decimal.js";

const calculatorPages = [
  "https://www.zen.com/currency-converter/",
  "https://www.zen.com/online-currency-exchange/",
  "https://www.zen.com/hu/online-valutavalto/",
];
const expectedEndpoint = "https://www.zen.com/landing_currencies.php";
const timeoutMs = 5_000;
const maximumResponseBytes = 256 * 1024;
const maximumRedirects = 5;
const requiredZenQuoteHeaders = {
  Referer: "https://www.zen.com/hu/online-valutavalto/",
};

if (process.env.ZEN_INVESTIGATION_ENABLED !== "true") {
  console.error("Refusing live ZEN traffic without ZEN_INVESTIGATION_ENABLED=true.");
  process.exit(1);
}

function bodyClassification(status, contentType, text) {
  if (status === 403)
    return /cloudflare|cf-ray|challenge|access denied|just a moment/i.test(text)
      ? "CLOUDFLARE_403"
      : "HTTP_403";
  if (contentType.includes("text/html")) {
    return /cloudflare|cf-ray|challenge|captcha|access denied|just a moment/i.test(text)
      ? "HTML_CHALLENGE_OR_BLOCK"
      : "HTML_PAGE";
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.data !== null &&
      typeof parsed.data === "object" &&
      typeof parsed.data.exchangeRate === "string"
    )
      return "JSON_QUOTE_ENVELOPE";
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      return "JSON_ERROR_ENVELOPE";
    }
    return "JSON_OTHER";
  } catch {
    return "NON_JSON";
  }
}

async function readLimited(response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > maximumResponseBytes) throw new Error("RESPONSE_TOO_LARGE");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new Error("RESPONSE_TOO_LARGE");
  }
  return text;
}

async function sessionFetch(jar, input, init = {}) {
  let url = input;
  const chain = [];
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const cookie = jar.header();
    const startedAt = performance.now();
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          ...(cookie === "" ? {} : { Cookie: cookie }),
        },
        redirect: "manual",
        signal: controller.signal,
      });
      jar.absorbSetCookies(response.headers.getSetCookie?.() ?? []);
      const location = response.headers.get("location");
      chain.push({
        url: new URL(url).origin + new URL(url).pathname,
        status: response.status,
        locationOrigin: location === null ? null : new URL(location, url).origin,
        durationMs: Math.round(performance.now() - startedAt),
      });
      if (response.status < 300 || response.status >= 400 || location === null) {
        return { response, chain };
      }
      const next = new URL(location, url);
      if (next.hostname !== "www.zen.com") throw new Error("CROSS_ORIGIN_REDIRECT_REJECTED");
      url = next.toString();
      init = { method: "GET", headers: init.headers };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("TOO_MANY_REDIRECTS");
}

function inspectPageContract(html, pageUrl) {
  const scriptMatches = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)];
  const calculatorScript = scriptMatches
    .map((match) => new URL(match[1], pageUrl).toString())
    .find((url) => url.includes("handleConverterOnLandingPage.js"));
  const publicFieldNames = [
    ...html.matchAll(
      /(?:nonce|csrf|token|session|calculator|locale|market|version)[A-Za-z0-9_-]*/gi,
    ),
  ]
    .map((match) => match[0])
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 25);
  return {
    calculatorScript: calculatorScript ?? null,
    mentionsLandingEndpoint: html.includes("landing_currencies.php"),
    publicStateFieldNames: publicFieldNames,
  };
}

function inspectBundleContract(script) {
  const parameterNames = [
    "action",
    "sourceCurrency",
    "targetCurrency",
    "amount",
    "endpoint",
    "nonce",
    "csrf",
    "locale",
    "market",
    "calculatorId",
    "version",
  ].filter((name) => new RegExp(`\\b${name}\\b`, "i").test(script));
  return {
    mentionsLandingEndpoint: script.includes("landing_currencies.php"),
    mentionsConfiguredApiUrl: /kursywalut\.api_url/.test(script),
    methodNames: [...script.matchAll(/(?:type|method)\s*:\s*["'](GET|POST)["']/gi)]
      .map((match) => match[1].toUpperCase())
      .filter((value, index, values) => values.indexOf(value) === index),
    parameterNames,
    mentionsCookieApi: /document\.cookie|cookieStore/i.test(script),
    mentionsCsrfOrNonce: /csrf|nonce/i.test(script),
  };
}

async function investigatePage(pageUrl, includeReverseQuote) {
  const jar = new AnonymousZenCookieJar();
  try {
    const pageFetch = await sessionFetch(jar, pageUrl, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": pageUrl.includes("/hu/") ? "hu-HU,hu;q=0.9" : "en-GB,en;q=0.9",
        "User-Agent": "NeoRate technical ZEN anonymous-session investigation",
      },
    });
    const pageText = await readLimited(pageFetch.response);
    const pageType = pageFetch.response.headers.get("content-type")?.toLowerCase() ?? "";
    const pageContract = inspectPageContract(pageText, pageUrl);

    let bundle = null;
    if (pageFetch.response.ok && pageContract.calculatorScript !== null) {
      const bundleFetch = await sessionFetch(jar, pageContract.calculatorScript, {
        method: "GET",
        headers: {
          Accept: "*/*",
          Referer: pageUrl,
          "User-Agent": "NeoRate technical ZEN anonymous-session investigation",
        },
      });
      const bundleText = await readLimited(bundleFetch.response);
      bundle = {
        status: bundleFetch.response.status,
        contentType: bundleFetch.response.headers.get("content-type")?.split(";")[0] ?? "MISSING",
        bodyClassification: bodyClassification(
          bundleFetch.response.status,
          bundleFetch.response.headers.get("content-type")?.toLowerCase() ?? "",
          bundleText,
        ),
        contract: inspectBundleContract(bundleText),
      };
    }

    const quotes = [];
    const quoteInputs = [
      { sourceCurrency: "HUF", targetCurrency: "EUR", amount: "1000.00" },
      ...(includeReverseQuote
        ? [{ sourceCurrency: "EUR", targetCurrency: "HUF", amount: "10.00" }]
        : []),
    ];
    for (const quoteInput of quoteInputs) {
      const body = new URLSearchParams({
        action: "change_currency",
        ...quoteInput,
        endpoint: "change_currency",
      }).toString();
      const quoteFetch = await sessionFetch(jar, expectedEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": pageUrl.includes("/hu/") ? "hu-HU,hu;q=0.9" : "en-GB,en;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Origin: "https://www.zen.com",
          Referer: pageUrl,
          "User-Agent": "NeoRate technical ZEN anonymous-session investigation",
          "X-Requested-With": "XMLHttpRequest",
        },
        body,
      });
      const quoteText = await readLimited(quoteFetch.response);
      quotes.push({
        direction: `${quoteInput.sourceCurrency}-${quoteInput.targetCurrency}`,
        status: quoteFetch.response.status,
        contentType: quoteFetch.response.headers.get("content-type")?.split(";")[0] ?? "MISSING",
        bodyClassification: bodyClassification(
          quoteFetch.response.status,
          quoteFetch.response.headers.get("content-type")?.toLowerCase() ?? "",
          quoteText,
        ),
      });
    }

    return {
      requestedPage: pageUrl,
      redirectChain: pageFetch.chain,
      page: {
        status: pageFetch.response.status,
        contentType: pageType.split(";")[0] || "MISSING",
        bodyClassification: bodyClassification(pageFetch.response.status, pageType, pageText),
      },
      cookies: jar.summary(),
      pageContract,
      bundle,
      quoteRequest: {
        method: "POST",
        endpoint: expectedEndpoint,
        parameterNames: ["action", "sourceCurrency", "targetCurrency", "amount", "endpoint"],
      },
      quotes,
    };
  } finally {
    jar.clear();
  }
}

async function nativeHttpsControl({
  sourceCurrency,
  targetCurrency,
  amount,
  profile = "MINIMAL",
  additionalHeaders = {},
}) {
  const body = new URLSearchParams({
    action: "change_currency",
    sourceCurrency,
    targetCurrency,
    amount,
    endpoint: "change_currency",
  }).toString();
  const startedAt = performance.now();
  return new Promise((resolve) => {
    const request = https.request(
      expectedEndpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": "NeoRate technical ZEN anonymous-session investigation",
          ...additionalHeaders,
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > maximumResponseBytes) request.destroy(new Error("RESPONSE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          const classification = bodyClassification(response.statusCode ?? 0, contentType, text);
          let quote = null;
          let validationResult = "NOT_A_QUOTE";
          if (classification === "JSON_QUOTE_ENVELOPE") {
            try {
              const parsed = JSON.parse(text);
              const source = new Decimal(parsed.data.sourceAmount);
              const target = new Decimal(parsed.data.targetAmount);
              const rate = new Decimal(parsed.data.exchangeRate);
              const tolerance = targetCurrency === "EUR" ? new Decimal("0.01") : new Decimal("1");
              const valid =
                source.equals(amount) &&
                source.greaterThan(0) &&
                target.greaterThan(0) &&
                rate.greaterThan(0) &&
                source.times(rate).minus(target).abs().lessThanOrEqualTo(tolerance);
              quote = {
                requestedAmount: amount,
                sourceAmount: source.toFixed(),
                targetAmount: target.toFixed(),
                exchangeRate: rate.toFixed(),
                alternativeProviderAliases: Array.isArray(parsed.data.alternatives)
                  ? parsed.data.alternatives
                      .map((alternative) => alternative?.provider)
                      .filter((provider) => typeof provider === "string")
                  : [],
              };
              validationResult = valid ? "PASS" : "FAIL";
            } catch {
              validationResult = "FAIL";
            }
          }
          resolve({
            profile,
            headerNames: [
              "Content-Type",
              "Content-Length",
              "User-Agent",
              ...Object.keys(additionalHeaders),
            ],
            direction: `${sourceCurrency}-${targetCurrency}`,
            status: response.statusCode ?? null,
            contentType: contentType.split(";")[0] || "MISSING",
            bodyClassification: classification,
            setCookieNames: (response.headers["set-cookie"] ?? [])
              .map(parseSetCookieName)
              .filter((name) => name !== null),
            quote,
            validationResult,
            durationMs: Math.round(performance.now() - startedAt),
          });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("TIMEOUT")));
    request.on("error", (error) =>
      resolve({
        profile,
        headerNames: [
          "Content-Type",
          "Content-Length",
          "User-Agent",
          ...Object.keys(additionalHeaders),
        ],
        status: null,
        direction: `${sourceCurrency}-${targetCurrency}`,
        contentType: null,
        bodyClassification: error.message,
        setCookieNames: [],
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
    request.end(body);
  });
}

const results = [];
const pagesToInvestigate = process.env.ZEN_NATIVE_ONLY === "true" ? [] : calculatorPages;
for (const [index, page] of pagesToInvestigate.entries()) {
  results.push(await investigatePage(page, index === 2));
}
const nativeMatrix = [];
if (process.env.ZEN_HEADER_MATRIX_ONLY === "true") {
  const headerProfiles = [
    { profile: "MINIMAL", additionalHeaders: {} },
    { profile: "MINIMAL_PLUS_JSON_ACCEPT", additionalHeaders: { Accept: "application/json" } },
    { profile: "MINIMAL_PLUS_ORIGIN", additionalHeaders: { Origin: "https://www.zen.com" } },
    {
      profile: "MINIMAL_PLUS_REFERER",
      additionalHeaders: requiredZenQuoteHeaders,
    },
    {
      profile: "MINIMAL_PLUS_X_REQUESTED_WITH",
      additionalHeaders: { "X-Requested-With": "XMLHttpRequest" },
    },
    {
      profile: "MINIMAL_PLUS_ACCEPT_LANGUAGE",
      additionalHeaders: { "Accept-Language": "hu-HU,hu;q=0.9" },
    },
    {
      profile: "MINIMAL_PLUS_BROWSER_ACCEPT",
      additionalHeaders: { Accept: "application/json, text/javascript, */*; q=0.01" },
    },
  ];
  let successfulProfile = null;
  for (const headerProfile of headerProfiles) {
    const result = await nativeHttpsControl({
      sourceCurrency: "HUF",
      targetCurrency: "EUR",
      amount: "1000.00",
      ...headerProfile,
    });
    nativeMatrix.push(result);
    if (result.validationResult === "PASS") {
      successfulProfile = headerProfile;
      break;
    }
  }
  if (successfulProfile !== null) {
    nativeMatrix.push(
      await nativeHttpsControl({
        sourceCurrency: "EUR",
        targetCurrency: "HUF",
        amount: "10.00",
        profile: `${successfulProfile.profile}_REVERSE_CONFIRMATION`,
        additionalHeaders: successfulProfile.additionalHeaders,
      }),
    );
  }
} else {
  const fullMatrix = [
    { sourceCurrency: "HUF", targetCurrency: "EUR", amount: "1000.00" },
    { sourceCurrency: "HUF", targetCurrency: "EUR", amount: "9000.00" },
    { sourceCurrency: "HUF", targetCurrency: "EUR", amount: "100000.00" },
    { sourceCurrency: "EUR", targetCurrency: "HUF", amount: "10.00" },
    { sourceCurrency: "EUR", targetCurrency: "HUF", amount: "1000.00" },
  ];
  const finalSmokeMatrix = [fullMatrix[0], fullMatrix[3]];
  for (const input of process.env.ZEN_FINAL_MINIMAL_ONLY === "true"
    ? finalSmokeMatrix
    : fullMatrix) {
    nativeMatrix.push(
      await nativeHttpsControl({
        ...input,
        profile: "FINAL_MINIMAL_WITH_REQUIRED_REFERER",
        additionalHeaders: requiredZenQuoteHeaders,
      }),
    );
  }
}

console.log(
  JSON.stringify(
    {
      investigatedAt: new Date().toISOString(),
      runtime: `node-${process.versions.node}`,
      privacy:
        "Cookie and token values were neither logged nor persisted; each in-memory jar was destroyed.",
      results,
      nativeMatrix,
    },
    null,
    2,
  ),
);

const validQuote =
  results.some((result) =>
    result.quotes.some((quote) => quote.bodyClassification === "JSON_QUOTE_ENVELOPE"),
  ) || nativeMatrix.some((quote) => quote.validationResult === "PASS");
const invalidNativeQuote =
  process.env.ZEN_HEADER_MATRIX_ONLY === "true"
    ? nativeMatrix.filter((quote) => quote.validationResult === "PASS").length !== 2 ||
      nativeMatrix.at(-1)?.validationResult !== "PASS"
    : nativeMatrix.some((quote) => quote.validationResult !== "PASS");
process.exitCode = validQuote && !invalidNativeQuote ? 0 : 2;
