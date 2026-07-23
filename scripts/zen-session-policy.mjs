const allowedCookieRules = [
  [/^PHPSESSID$/i, "ALLOWED_APPLICATION_SESSION"],
  [/^(AWSALB|AWSALBCORS|ARRAffinity|SERVERID|ROUTEID)$/i, "ALLOWED_AFFINITY"],
  [/^(wp-wpml_current_language|wordpress_test_cookie)$/i, "ALLOWED_PUBLIC_LOCALE"],
];

const forbiddenCookieRules = [
  [/^cf_clearance$/i, "FORBIDDEN_CLOUDFLARE_CLEARANCE"],
  [/^(__cf_bm|cf_chl_|_cfuvid)/i, "REJECTED_CLOUDFLARE_OR_UNCERTAIN_BOT_COOKIE"],
  [/^wordpress_logged_in_/i, "FORBIDDEN_AUTHENTICATED_SESSION"],
];

const irrelevantCookieRules = [
  [/^(_ga|_gid|_gat|CookieConsent|Cookiebot)/i, "IRRELEVANT_NOT_FORWARDED"],
];

export function classifyZenCookieName(name) {
  for (const [pattern, classification] of forbiddenCookieRules) {
    if (pattern.test(name)) return { classification, allowed: false };
  }
  for (const [pattern, classification] of allowedCookieRules) {
    if (pattern.test(name)) return { classification, allowed: true };
  }
  for (const [pattern, classification] of irrelevantCookieRules) {
    if (pattern.test(name)) return { classification, allowed: false };
  }
  return { classification: "UNCLASSIFIED_REJECTED", allowed: false };
}

export function parseSetCookieName(setCookie) {
  const pair = setCookie.split(";", 1)[0] ?? "";
  const separator = pair.indexOf("=");
  return separator > 0 ? pair.slice(0, separator).trim() : null;
}

export function summarizeCookieRecords(records) {
  return records.map(({ name, classification, allowed }) => ({ name, classification, allowed }));
}

export class AnonymousZenCookieJar {
  #allowed = new Map();
  #records = new Map();

  absorbSetCookies(setCookies) {
    for (const setCookie of setCookies) {
      const name = parseSetCookieName(setCookie);
      if (name === null) continue;
      const firstPair = setCookie.split(";", 1)[0] ?? "";
      const separator = firstPair.indexOf("=");
      const value = separator >= 0 ? firstPair.slice(separator + 1) : "";
      const policy = classifyZenCookieName(name);
      this.#records.set(name, { name, value, ...policy });
      if (policy.allowed && value !== "") this.#allowed.set(name, value);
      else this.#allowed.delete(name);
    }
  }

  header() {
    return [...this.#allowed].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  summary() {
    return summarizeCookieRecords([...this.#records.values()]);
  }

  clear() {
    this.#allowed.clear();
    this.#records.clear();
  }
}
