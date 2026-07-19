import { describe, expect, it } from "vitest";
import {
  AnonymousZenCookieJar,
  classifyZenCookieName,
  parseSetCookieName,
  summarizeCookieRecords,
} from "./zen-session-policy.mjs";

describe("ZEN anonymous-session investigation policy", () => {
  it("allows ordinary anonymous application, affinity and locale cookies", () => {
    expect(classifyZenCookieName("PHPSESSID")).toEqual({
      classification: "ALLOWED_APPLICATION_SESSION",
      allowed: true,
    });
    expect(classifyZenCookieName("AWSALBCORS").allowed).toBe(true);
    expect(classifyZenCookieName("wp-wpml_current_language").allowed).toBe(true);
  });

  it("rejects Cloudflare clearance, bot-management and authenticated cookies", () => {
    expect(classifyZenCookieName("cf_clearance")).toEqual({
      classification: "FORBIDDEN_CLOUDFLARE_CLEARANCE",
      allowed: false,
    });
    expect(classifyZenCookieName("__cf_bm").allowed).toBe(false);
    expect(classifyZenCookieName("wordpress_logged_in_example").allowed).toBe(false);
  });

  it("fails closed for unclassified cookies", () => {
    expect(classifyZenCookieName("mystery_session")).toEqual({
      classification: "UNCLASSIFIED_REJECTED",
      allowed: false,
    });
  });

  it("extracts cookie names without returning values", () => {
    expect(parseSetCookieName("PHPSESSID=synthetic-secret; Path=/; HttpOnly")).toBe("PHPSESSID");
    expect(
      summarizeCookieRecords([
        {
          name: "PHPSESSID",
          value: "synthetic-secret",
          classification: "ALLOWED_APPLICATION_SESSION",
          allowed: true,
        },
      ]),
    ).toEqual([
      { name: "PHPSESSID", classification: "ALLOWED_APPLICATION_SESSION", allowed: true },
    ]);
  });

  it("propagates only an allowed anonymous cookie in memory and destroys it after the flow", () => {
    const jar = new AnonymousZenCookieJar();

    jar.absorbSetCookies([
      "PHPSESSID=synthetic-session; Path=/; HttpOnly",
      "__cf_bm=synthetic-bot-cookie; Path=/; Secure",
      "cf_clearance=synthetic-clearance; Path=/; Secure",
    ]);

    expect(jar.header()).toBe("PHPSESSID=synthetic-session");
    expect(jar.summary()).toEqual([
      { name: "PHPSESSID", classification: "ALLOWED_APPLICATION_SESSION", allowed: true },
      {
        name: "__cf_bm",
        classification: "REJECTED_CLOUDFLARE_OR_UNCERTAIN_BOT_COOKIE",
        allowed: false,
      },
      { name: "cf_clearance", classification: "FORBIDDEN_CLOUDFLARE_CLEARANCE", allowed: false },
    ]);
    expect(JSON.stringify(jar.summary())).not.toContain("synthetic-");

    jar.clear();
    expect(jar.header()).toBe("");
    expect(jar.summary()).toEqual([]);
  });
});
