// @ts-check

window.dataLayer = window.dataLayer || [];
// The body pushes the `arguments` object exactly as Google's snippet does, so
// what gtag.js receives is unchanged. The unused rest parameter only declares
// the arity: TypeScript 7 no longer infers parameters from `arguments`.
/** @param {...unknown} _args */
function gtag(..._args) { (window.dataLayer ??= []).push(arguments); }
gtag("js", new Date());
// The app sends each screen's page_view itself once the screen is drawn (routing.js trackPageView), with the title and
// address of what is on screen. Left to its default, the tag would also send the first screen on its own, often before
// the screen is drawn (the page's first title, the address it was opened with), and the first screen would count twice.
// 주소가 바뀌면 저절로 나가는 기록(Page changes based on browser history events)은 이 측정 ID의 스트림에서 애널리틱스 관리 화면으로
// 껐다(사용자 결정 2026-11-23, known-issues §46). 캘린더 목록의 주소 교체가 이에 기댄다. 측정 ID를 바꾸면 새 스트림에서도 꺼 둔다(pitfalls §43).
gtag("config", "G-2Q4SRGVNQN", { send_page_view: false });

// Expose on window so other ESM modules (routing.js's trackPageView
// in particular) can call it as a bare global. After ADR-019's ESM
// transition, `function gtag()` is module-scoped to this file by default;
// the assignment below restores the cross-module reach.
window.gtag = gtag;

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
