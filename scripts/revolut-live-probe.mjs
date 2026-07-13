const enabled = process.env.REVOLUT_LIVE_TEST_ENABLED === "true";

if (!enabled) {
  console.log("Revolut live probe skipped (set REVOLUT_LIVE_TEST_ENABLED=true to run).");
  process.exit(0);
}

const endpoint = "https://www.revolut.com/api/exchange/quote";
const probes = [
  { amount: "100000", fromCurrency: "HUF", toCurrency: "EUR" },
  { amount: "400000", fromCurrency: "HUF", toCurrency: "EUR" },
  { amount: "1100000", fromCurrency: "HUF", toCurrency: "EUR" },
  { amount: "1000", fromCurrency: "EUR", toCurrency: "HUF" },
];
const personalPlans = new Set(["STANDARD", "PLUS", "PREMIUM", "METAL", "ULTRA"]);

let failed = false;

for (const probe of probes) {
  const url = new URL(endpoint);
  url.searchParams.set("amount", probe.amount);
  url.searchParams.set("country", "HU");
  url.searchParams.set("fromCurrency", probe.fromCurrency);
  url.searchParams.set("isRecipientAmount", "false");
  url.searchParams.set("toCurrency", probe.toCurrency);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "NeoRate/0.1 (+https://github.com/Busaman/exchangerates)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    const label = `${probe.amount} ${probe.fromCurrency}->${probe.toCurrency}`;

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
          .map((plan) => plan?.id)
          .filter((id) => typeof id === "string" && personalPlans.has(id))
      : [];
    console.log(
      JSON.stringify({
        probe: label,
        status: response.status,
        senderCurrency: payload?.sender?.currency ?? null,
        recipientCurrency: payload?.recipient?.currency ?? null,
        positiveRecipient: Number(payload?.recipient?.amount) > 0,
        rateDirection: `${payload?.rate?.from ?? "?"}->${payload?.rate?.to ?? "?"}`,
        rateTimestampPresent: Number.isFinite(payload?.rate?.timestamp),
        personalPlans: returnedPlans,
      }),
    );
  } catch (error) {
    console.error(
      `${probe.amount} ${probe.fromCurrency}->${probe.toCurrency}: ${
        error instanceof Error ? error.name : "request failed"
      }`,
    );
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
