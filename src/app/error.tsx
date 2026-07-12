"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("NeoRate route error", { message: error.message, digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-rose-300">VÁRATLAN HIBA</p>
        <h1 className="mt-3 text-3xl font-semibold">A kérést most nem tudtuk teljesíteni.</h1>
        <p className="mt-3 text-slate-400">
          Próbáld újra. Ha a hiba megmarad, ellenőrizd a szervernaplót.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-emerald-400 px-5 py-2.5 font-semibold text-slate-950 hover:bg-emerald-300"
        >
          Újrapróbálás
        </button>
      </div>
    </main>
  );
}
