import { providerIdentifierSchema, type ProviderIdentifier } from "@/domain/quote";
import { resolveRevolutAdapterEnabled, resolveZenAdapterEnabled } from "@/lib/env";
import { MockProviderAdapter } from "@/providers/mock-provider";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { RevolutProviderAdapter } from "@/providers/revolut/revolut-provider";
import { UnavailableProviderAdapter } from "@/providers/unavailable-provider";
import { ZenProviderAdapter } from "@/providers/zen/zen-provider";

export type ProviderRegistrationStatus = "SUPPORTED" | "UNAVAILABLE";

export type ProviderRegistration =
  | Readonly<{
      adapter: ProviderAdapter;
      status: "SUPPORTED";
      timeoutMs?: number;
    }>
  | Readonly<{
      adapter: ProviderAdapter;
      status: "UNAVAILABLE";
      reason: string;
      sourceId: string;
    }>;

export class ProviderAdapterRegistry {
  readonly #registrations: ReadonlyMap<ProviderIdentifier, ProviderRegistration>;

  constructor(registrations: readonly ProviderRegistration[]) {
    const entries = registrations.map((registration) => {
      const providerId = providerIdentifierSchema.parse(registration.adapter.provider.id);
      return [providerId, registration] as const;
    });
    const uniqueEntries = new Map(entries);

    if (uniqueEntries.size !== entries.length) {
      throw new Error("Provider registry contains duplicate provider identifiers");
    }

    this.#registrations = uniqueEntries;
  }

  list(): ReadonlyArray<
    Readonly<{ id: ProviderIdentifier; name: string; status: ProviderRegistrationStatus }>
  > {
    return Array.from(this.#registrations, ([id, registration]) => ({
      id,
      name: registration.adapter.provider.name,
      status: registration.status,
    }));
  }

  get(providerId: ProviderIdentifier): ProviderRegistration {
    const registration = this.#registrations.get(providerId);
    if (registration === undefined) {
      throw new Error(`Provider is not registered: ${providerId}`);
    }
    return registration;
  }
}

export function createProviderRegistry({
  revolutEnabled,
  zenEnabled = false,
}: {
  revolutEnabled: boolean;
  zenEnabled?: boolean;
}): ProviderAdapterRegistry {
  const revolutAdapter = new RevolutProviderAdapter();
  const zenAdapter = new ZenProviderAdapter();

  return new ProviderAdapterRegistry([
    { adapter: new MockProviderAdapter(), status: "SUPPORTED" },
    {
      adapter: new UnavailableProviderAdapter(),
      status: "UNAVAILABLE",
      reason: "No verified provider integration is configured in the foundation phase.",
      sourceId: "foundation-unavailable-example",
    },
    revolutEnabled
      ? { adapter: revolutAdapter, status: "SUPPORTED", timeoutMs: 10_000 }
      : {
          adapter: revolutAdapter,
          status: "UNAVAILABLE",
          reason:
            "The experimental Revolut JSON integration is disabled pending staging request-contract and legal verification.",
          sourceId: "revolut-personal-experimental-disabled",
        },
    zenEnabled
      ? { adapter: zenAdapter, status: "SUPPORTED", timeoutMs: 3_000 }
      : {
          adapter: zenAdapter,
          status: "UNAVAILABLE",
          reason:
            "The experimental ZEN Pro public-page integration is disabled pending legal, product and longer staging verification.",
          sourceId: "zen-public-landing-currency-converter-disabled",
        },
  ]);
}

export const providerRegistry = createProviderRegistry({
  revolutEnabled: resolveRevolutAdapterEnabled(process.env.REVOLUT_ADAPTER_ENABLED),
  zenEnabled: resolveZenAdapterEnabled(process.env.ZEN_ADAPTER_ENABLED),
});
