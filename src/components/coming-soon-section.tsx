import type { Language } from "@/components/fintech-shell";

const comingSoonProviders = [
  "N26",
  "Lightyear",
  "PayPal",
  "OTP Bank",
  "Erste",
  "Raiffeisen",
] as const;

export function ComingSoonSection({ language }: { language: Language }) {
  return (
    <section className="coming-soon" aria-labelledby="coming-soon-title">
      <div className="coming-soon-heading">
        <div>
          <p className="section-kicker">Roadmap</p>
          <h2 id="coming-soon-title">{language === "hu" ? "Hamarosan" : "Coming soon"}</h2>
        </div>
        <p>
          {language === "hu"
            ? "Ezekhez még nincs ellenőrzött élő adatforrás. Nem kapnak számot vagy helyezést."
            : "These providers have no verified live source yet. They receive no numbers or rank."}
        </p>
      </div>
      <div className="coming-soon-grid">
        {comingSoonProviders.map((provider) => (
          <article key={provider}>
            <span>{provider.slice(0, 1)}</span>
            <div>
              <h3>{provider}</h3>
              <p>{language === "hu" ? "Még nincs élő adatforrás" : "No live data source yet"}</p>
            </div>
            <em>{language === "hu" ? "Hamarosan" : "Soon"}</em>
          </article>
        ))}
      </div>
    </section>
  );
}
