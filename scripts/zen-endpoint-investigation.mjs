const endpoint = "https://www.zen.com/landing_currencies.php";
const calculatorPage = "https://www.zen.com/gb/online-currency-exchange/";
const timeoutMs = 5_000;
const maximumResponseBytes = 64 * 1024;

if (process.env.ZEN_INVESTIGATION_ENABLED !== "true") {
  console.error("Refusing live ZEN traffic without ZEN_INVESTIGATION_ENABLED=true.");
  process.exit(1);
}

const baseHeaders = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
};

const variants = [
  { name: "MINIMAL", headers: {} },
  { name: "BROWSER_ACCEPT", headers: { Accept: "application/json, text/javascript, */*; q=0.01" } },
  { name: "OFFICIAL_ORIGIN", headers: { Origin: "https://www.zen.com" } },
  { name: "CALCULATOR_REFERER", headers: { Referer: calculatorPage } },
  {
    name: "DESCRIPTIVE_USER_AGENT",
    headers: { "User-Agent": "NeoRate technical ZEN endpoint investigation" },
  },
  {
    name: "JUSTIFIED_COMBINATION",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-GB,en;q=0.9",
      Origin: "https://www.zen.com",
      Referer: calculatorPage,
      "User-Agent": "NeoRate technical ZEN endpoint investigation",
      "X-Requested-With": "XMLHttpRequest",
    },
  },
];

const requests = [
  ...variants.map((variant) => ({
    ...variant,
    sourceCurrency: "HUF",
    targetCurrency: "EUR",
    amount: "1000.00",
  })),
  {
    ...variants.at(-1),
    name: "JUSTIFIED_COMBINATION_REVERSE",
    sourceCurrency: "EUR",
    targetCurrency: "HUF",
    amount: "1000.00",
  },
];

function classifyBody(status, contentType, text) {
  if (status === 403) return "HTTP_403_BLOCK";
  if (contentType.includes("text/html")) {
    return /cloudflare|challenge|captcha|access denied/i.test(text)
      ? "HTML_CHALLENGE_OR_BLOCK"
      : "HTML_OTHER";
  }
  try {
    const parsed = JSON.parse(text);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.data !== null &&
      typeof parsed.data === "object" &&
      typeof parsed.data.exchangeRate === "string"
    ) {
      return "JSON_QUOTE_ENVELOPE";
    }
    if (parsed !== null && typeof parsed === "object" && "error" in parsed) {
      return "JSON_ERROR_ENVELOPE";
    }
    return "JSON_OTHER";
  } catch {
    return "MALFORMED_OR_NON_JSON";
  }
}

async function runProbe(input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  const body = new URLSearchParams({
    action: "change_currency",
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    amount: input.amount,
    endpoint: "change_currency",
  }).toString();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { ...baseHeaders, ...input.headers },
      body,
      redirect: "manual",
      signal: controller.signal,
    });
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > maximumResponseBytes) throw new Error("RESPONSE_TOO_LARGE");
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
      throw new Error("RESPONSE_TOO_LARGE");
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    return {
      variant: input.name,
      direction: `${input.sourceCurrency}-${input.targetCurrency}`,
      status: response.status,
      contentType: contentType.split(";")[0] || "MISSING",
      bodyClassification: classifyBody(response.status, contentType, text),
      redirectLocationPresent: response.headers.has("location"),
      serverCategory: response.headers.get("server") ?? "UNDISCLOSED",
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      variant: input.name,
      direction: `${input.sourceCurrency}-${input.targetCurrency}`,
      status: null,
      contentType: null,
      bodyClassification: error?.name === "AbortError" ? "TIMEOUT" : "NETWORK_OR_CLIENT_ERROR",
      redirectLocationPresent: false,
      serverCategory: "UNAVAILABLE",
      durationMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

const results = [];
for (const request of requests) {
  results.push(await runProbe(request));
}

console.log(
  JSON.stringify(
    {
      investigatedAt: new Date().toISOString(),
      runtime: `node-${process.versions.node}`,
      requestCount: results.length,
      privacy: "No Cookie or Authorization header was sent or logged.",
      results,
    },
    null,
    2,
  ),
);

if (results.some((result) => result.bodyClassification === "JSON_QUOTE_ENVELOPE")) {
  process.exitCode = 0;
} else {
  process.exitCode = 2;
}
