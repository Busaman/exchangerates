"use client";

import { useEffect, useState } from "react";
import { ComparisonTool } from "@/components/comparison-tool";
import {
  applyLanguageSelection,
  defaultLanguage,
  synchronizeDocumentLanguage,
  type Language,
} from "@/components/language";

export type { Language } from "@/components/language";
type Theme = "light" | "dark";

export function FintechShell() {
  const [language, setLanguage] = useState<Language>(defaultLanguage);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    synchronizeDocumentLanguage(language, document.documentElement);
  }, [language]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("neorate-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      document.documentElement.dataset.theme = savedTheme;
      const timeoutId = window.setTimeout(() => setTheme(savedTheme), 0);
      return () => window.clearTimeout(timeoutId);
    } else {
      document.documentElement.dataset.theme = "light";
    }
  }, []);

  function toggleTheme() {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("neorate-theme", next);
  }

  return (
    <div className="fintech-page">
      <div className="top-band">
        <header className="site-nav">
          <a className="brand" href="#top" aria-label="NeoRate kezdőlap">
            <span>NR</span>
            <span>
              <strong>NeoRate</strong>
              <small>
                {language === "hu"
                  ? "Átlátható deviza-összehasonlítás"
                  : "Transparent FX comparison"}
              </small>
            </span>
          </a>
          <div className="nav-actions">
            <span className="experimental-badge">
              {language === "hu" ? "Kísérleti" : "Experimental"}
            </span>
            <div className="language-toggle" role="group" aria-label="Language">
              {(["hu", "en"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-pressed={language === item}
                  onClick={() =>
                    applyLanguageSelection(item, document.documentElement, setLanguage)
                  }
                >
                  {item.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggleTheme}
              aria-label={theme === "light" ? "Sötét téma" : "Világos téma"}
              aria-pressed={theme === "dark"}
            >
              {theme === "light" ? "◐" : "☀"}
            </button>
          </div>
        </header>
        <div id="top" className="top-content">
          <ComparisonTool language={language} />
        </div>
      </div>
      <footer className="site-footer">
        <div>
          <strong>NeoRate</strong>
          <span>© 2026 · Private staging</span>
        </div>
        <p>
          {language === "hu"
            ? "A piaci középárfolyam soha nem helyettesít csendben valódi szolgáltatói ajánlatot."
            : "A market mid-rate never silently replaces a real provider quote."}
        </p>
      </footer>
    </div>
  );
}
