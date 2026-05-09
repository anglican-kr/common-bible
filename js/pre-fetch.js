// Start fetching books.json immediately to avoid waiting for app.js to load.
//
// This file stays as a classic script (no `export {};` marker, no
// `<script type="module">`) — see ADR-019 §"예외". `<head>` non-defer
// loading lets the books.json fetch start before DOM parsing finishes; ESM
// would force automatic deferred execution and lose that head-start.
window.booksPromise = fetch("/data/books.json").then(res => {
  if (!res.ok) throw new Error("Failed to pre-fetch books.json");
  return res.json();
});
