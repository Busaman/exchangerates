import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-emerald-300">404</p>
        <h1 className="mt-3 text-3xl font-semibold">Ez az oldal nem található.</h1>
        <Link className="mt-6 inline-block text-emerald-300 underline" href="/">
          Vissza a NeoRate kezdőlapjára
        </Link>
      </div>
    </main>
  );
}
