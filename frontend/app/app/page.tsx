import Link from "next/link";

export default function AppPlaceholder() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 text-center">
      <span className="inline-flex items-center gap-3 text-sm font-mono text-muted-foreground">
        <span className="w-8 h-px bg-foreground/30" />
        Job submission
      </span>
      <h1 className="text-4xl md:text-6xl font-display tracking-tight">
        Dashboard is next.
      </h1>
      <p className="text-muted-foreground max-w-md">
        The job submission form, per-claim evaluator results, and reputation dashboard
        will live here.
      </p>
      <Link href="/" className="text-sm font-mono text-foreground/70 hover:text-foreground underline underline-offset-4">
        Back to the landing page
      </Link>
    </main>
  );
}
