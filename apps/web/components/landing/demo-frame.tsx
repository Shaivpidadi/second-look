import { Badge } from "../ui/badge";

/**
 * Static miniature of the /demo record screen, drawn in pure JSX so the
 * landing hero shows the product without screenshots or stock art.
 */
export function DemoFrame() {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-2xl shadow-black/60">
      <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <i className="h-2.5 w-2.5 rounded-full bg-white/15" />
        </span>
        <span className="mx-auto rounded border border-line bg-void px-2 py-0.5 font-mono text-[10px] text-ink-faint">
          second.look/demo
        </span>
        <span className="w-10" aria-hidden />
      </div>
      <div className="grid grid-cols-5 gap-px bg-line">
        <div className="relative col-span-3 bg-sunken p-3">
          <p className="mb-2 font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Glasses POV · 2fps
          </p>
          <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-raised">
            <div className="absolute inset-3 space-y-1.5" aria-hidden>
              <div className="h-1.5 w-2/3 rounded-sm bg-white/15" />
              <div className="h-1.5 w-full rounded-sm bg-white/10" />
              <div className="h-1.5 w-5/6 rounded-sm bg-white/10" />
              <div className="h-1.5 w-1/2 rounded-sm bg-white/15" />
              <div className="h-1.5 w-3/4 rounded-sm bg-white/10" />
            </div>
            <div className="absolute top-[18%] left-[8%] h-[30%] w-[55%] rounded-[3px] border-[1.5px] border-accent">
              <span className="absolute -top-4 left-0 rounded-sm bg-accent px-1 font-mono text-[9px] leading-3.5 text-white">
                AWB
              </span>
            </div>
            <div className="absolute right-[10%] bottom-[14%] h-[24%] w-[38%] rounded-[3px] border-[1.5px] border-accent/70">
              <span className="absolute -top-4 left-0 rounded-sm bg-accent/90 px-1 font-mono text-[9px] leading-3.5 text-white">
                label
              </span>
            </div>
          </div>
        </div>
        <div className="col-span-2 bg-panel p-3">
          <p className="mb-2 font-mono text-[10px] tracking-wide text-ink-faint uppercase">
            Typed
          </p>
          <div className="space-y-2 font-mono text-[10px]">
            <div>
              <p className="font-sans text-[10px] text-ink-faint">AWB number</p>
              <p className="mt-0.5 rounded border border-block/40 bg-block/10 px-1.5 py-1 text-block tabular">
                14779271345
              </p>
            </div>
            <div>
              <p className="font-sans text-[10px] text-ink-faint">Container</p>
              <p className="mt-0.5 rounded border border-line bg-sunken px-1.5 py-1 text-ink tabular">
                CSQU3054383
              </p>
            </div>
            <div>
              <p className="font-sans text-[10px] text-ink-faint">SSCC</p>
              <p className="mt-0.5 rounded border border-line bg-sunken px-1.5 py-1 text-ink tabular">
                10614···1238
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 border-t border-line bg-sunken px-3 py-2">
        <Badge tone="block">Blocked</Badge>
        <p className="truncate font-mono text-[10px] text-ink-dim tabular">
          awb.awbNumber check_digit · fix 17479271345 · 3.2s
        </p>
      </div>
    </div>
  );
}
