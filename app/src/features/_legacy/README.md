# Pre-token screens, superseded

These are the Phase-0 Dashboard, Ledger and `ui.tsx` primitives, kept for
reference only. They predate `styles/tokens.css` and violate design rules
T1 (hex literals), T5 (`rounded-xl` / `shadow-sm` on data surfaces) and D3
(colour as decoration rather than flow).

**Phase 4 rebuilds both screens against the tokens and primitives**, at which
point this folder is deleted. Nothing here is imported by the app, the
directory is excluded from the T1 scan in `styles/contrast.test.ts` and from
the TypeScript build.

Their *logic* is worth keeping while rewriting the presentation: the search
and filter behaviour in `LedgerView.tsx`, and the memoised view-model
assembly in `Dashboard.tsx`.
