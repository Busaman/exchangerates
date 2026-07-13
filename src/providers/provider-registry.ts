import { providerIdentifierSchema, type ProviderIdentifier } from "@/domain/quote";
import { MockProviderAdapter } from "@/providers/mock-provider";
import type { ProviderAdapter } from "@/providers/provider-adapter";
import { UnavailableProviderAdapter } from "@/providers/unavailable-provider";

export type ProviderRegistrationStatus = "SUPPORTED" | "UNAVAILABLE";

export type ProviderRegistration = Readonly<{
  adapter: ProviderAdapter;
  status: ProviderRegistrationStatus;
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

  listAdapters(): readonly ProviderAdapter[] {
    return Array.from(this.#registrations.values(), (registration) => registration.adapter);
  }

  get(providerId: ProviderIdentifier): ProviderRegistration {
    const registration = this.#registrations.get(providerId);
    if (registration === undefined) {
      throw new Error(`Provider is not registered: ${providerId}`);
    }
    return registration;
  }
}

export const providerRegistry = new ProviderAdapterRegistry([
  { adapter: new MockProviderAdapter(), status: "SUPPORTED" },
  { adapter: new UnavailableProviderAdapter(), status: "UNAVAILABLE" },
]);
