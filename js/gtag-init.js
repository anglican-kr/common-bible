window.dataLayer = window.dataLayer || [];
function gtag() { (window.dataLayer ??= []).push(arguments); }
gtag("js", new Date());
gtag("config", "G-CWVVPW11TE");

// Expose on window so other ESM modules (views-routing.js's trackPageView
// in particular) can call it as a bare global. After ADR-019's ESM
// transition, `function gtag()` is module-scoped to this file by default;
// the assignment below restores the cross-module reach.
window.gtag = gtag;

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
