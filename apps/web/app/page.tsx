import Link from "next/link";
import { ArrowRight, ScanEye, Keyboard, OctagonX } from "lucide-react";
import { Wordmark } from "../components/brand";
import { DemoFrame } from "../components/landing/demo-frame";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";

const FEATURES = [
  {
    n: "01",
    title: "Reads the paper through Ray-Ban Meta glasses",
    body: "POV frames stream at 2 to 7 fps. Document crops localize every page on the dock. Nothing to scan, nothing to retype from photos.",
    icon: ScanEye,
  },
  {
    n: "02",
    title: "Checks it against what you typed",
    body: "A screen reader watches the receiving form keystroke by keystroke. Check digits run first and free; the local pass redacts PII before anything reaches the cloud.",
    icon: Keyboard,
  },
  {
    n: "03",
    title: "Blocks the mistake before submit",
    body: "Failed checks block the submit gate with the paper value proposed as the fix. Damage notes become claim drafts. Every decision lands in an append-only audit log.",
    icon: OctagonX,
  },
];

const NUMBERS = [
  { label: "Tiered recall · 100 forms", value: "98.8%", note: "precision 100.0%" },
  { label: "Vision recall · 40 hard", value: "100%", note: "$0.015 / form" },
  { label: "Validators alone · hard", value: "39.4%", note: "why tiers exist" },
  { label: "E2E total · qty-gap", value: "4.9s", note: "live, under 5s" },
  { label: "Text cost / form", value: "$0.003", note: "tiered, priced" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Second Look home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-ink-dim md:flex" aria-label="Primary">
            <Link className="transition-colors hover:text-ink" href="/demo">
              Demo
            </Link>
            <Link className="transition-colors hover:text-ink" href="/form">
              Receiving form
            </Link>
            <Link className="transition-colors hover:text-ink" href="/dashboard">
              Dashboard
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <Badge tone="neutral" className="hidden font-mono sm:inline-flex">
              env: hackathon
            </Badge>
            <Button size="sm" asChild>
              <Link href="/demo">
                Watch it block <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pt-16 pb-20 lg:grid-cols-2 lg:pt-24">
          <div>
            <h1 className="max-w-xl text-5xl leading-[1.05] font-semibold tracking-[-0.02em]">
              The co-signer that actually reads the paperwork.
            </h1>
            <p className="mt-6 max-w-lg text-[17px] leading-relaxed text-ink-dim">
              In 2020 Citibank wired $900M to Revlon&apos;s lenders by
              mistake. The screen looked right. Nobody read it twice.
              Second Look reads the paperwork before you sign.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button size="lg" asChild>
                <Link href="/demo">
                  Open the demo <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <Button size="lg" variant="secondary" asChild>
                <Link href="/dashboard">Open the dashboard</Link>
              </Button>
            </div>
            <p className="mt-6 font-mono text-xs text-ink-faint tabular">
              live loop · validators-first · every verdict audited
            </p>
          </div>
          <div className="lg:pl-4">
            <DemoFrame />
            <p className="mt-3 text-center text-xs text-ink-faint">
              The recordable demo screen: POV crops, typed values, streaming verdicts.
            </p>
          </div>
        </section>

        <section className="border-y border-line bg-panel/40" aria-label="How it works">
          <div className="mx-auto max-w-6xl px-6 py-4">
            {FEATURES.map((feature, index) => (
              <div key={feature.n}>
                {index > 0 && <Separator />}
                <div className="grid items-start gap-4 py-8 md:grid-cols-12 md:gap-8">
                  <p className="font-mono text-sm text-ink-faint tabular md:col-span-1">
                    {feature.n}
                  </p>
                  <div className="md:col-span-6">
                    <h2 className="text-xl font-semibold tracking-tight">{feature.title}</h2>
                    <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-dim">
                      {feature.body}
                    </p>
                  </div>
                  <div className="md:col-span-5 md:justify-self-end">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-raised">
                      <feature.icon className="h-5 w-5 text-accent" aria-hidden />
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 py-20" aria-label="Measured results">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold tracking-[-0.02em]">Measured, not promised.</h2>
              <p className="mt-2 text-[15px] text-ink-dim">
                Eval corpus: 100 standard + 40 hard forms. Clip path: end-to-end totals under 5s, live Muse Spark.
              </p>
            </div>
            <Badge tone="pass">Oct 27-28 runs</Badge>
          </div>
          <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
            {NUMBERS.map((stat) => (
              <div key={stat.label} className="bg-panel px-5 py-6">
                <dt className="text-[13px] text-ink-dim">{stat.label}</dt>
                <dd className="mt-2 font-mono text-3xl font-semibold tracking-tight tabular">
                  {stat.value}
                </dd>
                <dd className="mt-1 font-mono text-xs text-ink-faint">{stat.note}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[13px] text-ink-faint">
            Full per-arm table lives in the repo README; hard-split costs are exact
            per-response prices at official Standard rates.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <Wordmark />
          <p className="text-[13px] text-ink-faint">Built on Muse Spark.</p>
          <nav className="flex items-center gap-6 text-sm text-ink-dim" aria-label="Footer">
            <Link className="transition-colors hover:text-ink" href="/demo">
              Demo
            </Link>
            <Link className="transition-colors hover:text-ink" href="/form">
              Receiving form
            </Link>
            <Link className="transition-colors hover:text-ink" href="/dashboard">
              Dashboard
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
