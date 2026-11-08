// @ts-check

window.dataLayer = window.dataLayer || [];
// The body pushes the `arguments` object exactly as Google's snippet does, so
// what gtag.js receives is unchanged. The unused rest parameter only declares
// the arity: TypeScript 7 no longer infers parameters from `arguments`.
/** @param {...unknown} _args */
function gtag(..._args) { (window.dataLayer ??= []).push(arguments); }
gtag("js", new Date());
gtag("config", "G-CWVVPW11TE");

// Expose on window so other ESM modules (views.js's trackPageView
// in particular) can call it as a bare global. After ADR-019's ESM
// transition, `function gtag()` is module-scoped to this file by default;
// the assignment below restores the cross-module reach.
window.gtag = gtag;

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
