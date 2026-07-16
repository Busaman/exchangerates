const enabled = process.env.REVOLUT_LIVE_TEST_ENABLED === "true";

if (!enabled) {
  console.log("Revolut live probe skipped (set REVOLUT_LIVE_TEST_ENABLED=true to run).");
  process.exit(0);
}

const endpoint = "https://www.revolut.com/api/exchange/quote";
const probes = [
  { majorAmount: "1000", fromCurrency: "HUF", toCurrency: "EUR" },
  { majorAmount: "100000", fromCurrency: "HUF", toCurrency: "EUR" },
  ...["968", "969", "970", "971", "972", "973", "974"].map((majorAmount) => ({
    majorAmount,
    fromCurrency: "EUR",
    toCurrency: "HUF",
  })),
];
const personalPlans = new Set(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"]);

let failed = false;

for (const probe of probes) {
  const apiAmount = new Decimal(probe.majorAmount).times(100).toFixed(0);
  const url = new URL(endpoint);
  url.searchParams.set("amount", apiAmount);
  url.searchParams.set("country", "HU");
  url.searchParams.set("fromCurrency", probe.fromCurrency);
  url.searchParams.set("isRecipientAmount", "false");
  url.searchParams.set("toCurrency", probe.toCurrency);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "hu",
        "User-Agent": "NeoRate/0.1 (+https://github.com/Busaman/exchangerates)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const label = `${probe.majorAmount} ${probe.fromCurrency}->${probe.toCurrency}`;

    if (!response.ok || !contentType.toLowerCase().includes("application/json")) {
      let safeMessage = "non-JSON or unreadable error response";
      try {
        const parsed = JSON.parse(body);
        if (typeof parsed?.message === "string") safeMessage = parsed.message.slice(0, 200);
      } catch {
        // The probe intentionally does not print arbitrary response bodies.
      }
      console.error(`${label}: HTTP ${response.status}; ${safeMessage}`);
      failed = true;
      continue;
    }

    const payload = JSON.parse(body);
    const returnedPlans = Array.isArray(payload?.plans)
      ? payload.plans
          .filter((plan) => typeof plan?.id === "string" && personalPlans.has(plan.id))
          .map((plan) => ({
            id: plan.id,
            fxFee: new Decimal(plan?.fees?.fx?.amount ?? 0).dividedBy(100).toFixed(),
            totalFee: new Decimal(plan?.fees?.total?.amount ?? 0).dividedBy(100).toFixed(),
            totalCost: new Decimal(plan?.fees?.cost?.amount ?? 0).dividedBy(100).toFixed(),
            feeCurrency: plan?.fees?.total?.currency ?? null,
          }))
      : [];
    console.log(
      JSON.stringify({
        probe: label,
        requestApiAmount: apiAmount,
        status: response.status,
        sender: {
          amount: new Decimal(payload?.sender?.amount ?? 0).dividedBy(100).toFixed(),
          currency: payload?.sender?.currency ?? null,
        },
        recipient: {
          amount: new Decimal(payload?.recipient?.amount ?? 0).dividedBy(100).toFixed(),
          currency: payload?.recipient?.currency ?? null,
        },
        rate: payload?.rate?.rate ?? null,
        rateDirection: `${payload?.rate?.from ?? "?"}->${payload?.rate?.to ?? "?"}`,
        rateTimestamp: Number.isFinite(payload?.rate?.timestamp)
          ? new Date(payload.rate.timestamp).toISOString()
          : null,
        personalPlans: returnedPlans,
      }),
    );
  } catch (error) {
    console.error(
      `${probe.majorAmount} ${probe.fromCurrency}->${probe.toCurrency}: ${
        error instanceof Error ? error.name : "request failed"
      }`,
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
import Decimal from "decimal.js";
