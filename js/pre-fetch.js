// Start fetching books.json immediately to avoid waiting for app.js to load
window.booksPromise = fetch("/data/books.json").then(res => {
  if (!res.ok) throw new Error("Failed to pre-fetch books.json");
  return res.json();
});
