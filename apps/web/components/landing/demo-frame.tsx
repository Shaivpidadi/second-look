import { Badge } from "../ui/badge";

/**
 * Static miniature of the /demo record screen. The POV pane shows a
 * synthetic glasses frame from clips/ with crop boxes overlaid.
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
            Glasses POV · 2fps · synthetic frame
          </p>
          <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-raised">
            <img
              src="/pov-awb.jpg"
              alt="Synthetic glasses frame of an air waybill"
              className="absolute inset-0 h-full w-full object-cover object-top"
            />
            <div className="absolute inset-0 bg-black/25" aria-hidden />
            <div className="absolute top-[28%] left-[4%] h-[11%] w-[38%] rounded-[3px] border-[1.5px] border-accent bg-accent/10">
              <span className="absolute -top-4 left-0 rounded-sm bg-accent px-1 font-mono text-[9px] leading-3.5 text-white">
                AWB
              </span>
            </div>
            <div className="absolute top-[50%] left-[4%] h-[11%] w-[20%] rounded-[3px] border-[1.5px] border-accent/70 bg-accent/[0.07]">
              <span className="absolute -bottom-4 left-0 rounded-sm bg-accent/90 px-1 font-mono text-[9px] leading-3.5 text-white">
                Origin
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
                87915411921
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
          AWB number check digit · fix 87915419121 · 3.2s
        </p>
      </div>
    </div>
  );
}
