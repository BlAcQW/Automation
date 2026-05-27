/**
 * Fixed grain layer — ui.md §6.3. A 200×200 monochrome noise PNG layered
 * `mix-blend-overlay` at 4% opacity across the entire viewport. This single
 * detail prevents the dark UI from looking flat/rendered.
 *
 * Pure CSS via the `.grain-layer` utility in globals.css. No JS, no state,
 * no client component — renders identically in SSR + CSR.
 */
export function GrainOverlay() {
    return <div aria-hidden className="grain-layer" />;
}
