import { ComparisonTool } from "@/components/comparison-tool";

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
      <header className="mb-8 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-3" aria-label="NeoRate kezdőlap">
          <span className="grid size-10 place-items-center rounded-xl bg-emerald-400 font-mono text-sm font-bold text-slate-950">
            NR
          </span>
          <span>
            <span className="block text-lg font-semibold tracking-tight">NeoRate</span>
            <span className="block text-xs text-slate-400">Átlátható deviza-összehasonlítás</span>
          </span>
        </a>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-200">
          Alapozási fázis · nem élő adatok
        </span>
      </header>

      <section id="top" className="mb-8 max-w-3xl">
        <p className="mb-3 font-mono text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
          Többet kapni ugyanazért az összegért
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          Hasonlítsd össze, mennyi pénzt kapnál a váltás végén.
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-base leading-7 text-slate-300 sm:text-lg">
          A NeoRate célja a szolgáltatói árfolyamok, árrések és díjak egyértelmű, visszakövethető
          összevetése. Ez a kezdeti felület kizárólag determinisztikus tesztadatot mutat.
        </p>
      </section>

      <ComparisonTool />

      <footer className="mt-10 border-t border-white/10 py-6 text-sm text-slate-500">
        NeoRate foundation · A piaci középárfolyam soha nem helyettesíti csendben a szolgáltató
        tényleges ügyfélárfolyamát.
      </footer>
    </main>
  );
}
