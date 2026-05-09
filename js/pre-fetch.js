// Start fetching books.json immediately to avoid waiting for app.js to load
window.booksPromise = fetch("/data/books.json").then(res => {
  if (!res.ok) throw new Error("Failed to pre-fetch books.json");
  return res.json();
});

// ESM module marker (ADR-019). No runtime effect; signals TypeScript that
// this file is module-scoped, isolating function/typedef names.
export {};
