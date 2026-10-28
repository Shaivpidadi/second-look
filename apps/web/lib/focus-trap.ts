/**
 * Focus-trap cycle for modal dialogs. The component queries its own
 * focusable elements and calls `trapTab` on Tab; this module owns the
 * wrap logic so it stays unit-testable without a DOM.
 */

export interface Focusable {
  focus(): void;
}

/**
 * Wrap Tab at the ends of a focus list. Returns true when it moved
 * focus (the caller must preventDefault); false lets the browser
 * move normally. An unknown active element wraps like an end.
 */
export function trapTab(
  focusables: Focusable[],
  active: unknown,
  backward: boolean,
): boolean {
  if (focusables.length === 0) return false;
  const index = focusables.indexOf(active as Focusable);
  const first = focusables[0] as Focusable;
  const last = focusables[focusables.length - 1] as Focusable;
  if (!backward && (index === -1 || index === focusables.length - 1)) {
    first.focus();
    return true;
  }
  if (backward && (index === -1 || index === 0)) {
    last.focus();
    return true;
  }
  return false;
}
