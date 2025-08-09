/*
 * 전역 검색 Web Worker
 * 메시지 프로토콜
 * - { type: 'init' }
 * - { type: 'config', indexUrl: '.../search-index.json' }
 * - { type: 'query', q: '키워드', limit: 50 }
 */

let INDEX_URL = null;
let entries = null; // [{ i, t, h, b, c, v, bo }]
let isLoading = false;
let pendingQuery = null;

function post(type, payload) {
  postMessage(Object.assign({ type }, payload || {}));
}

function normalize(str) {
  return (str || "").toString();
}

function includesIgnoreCase(text, query) {
  return text.toLowerCase().includes(query.toLowerCase());
}

async function ensureIndexLoaded() {
  if (entries) return;
  if (isLoading) return;
  if (!INDEX_URL) {
    throw new Error("INDEX_URL이 설정되지 않았습니다.");
  }
  isLoading = true;
  try {
    const res = await fetch(INDEX_URL, { credentials: "same-origin" });
    if (!res.ok) throw new Error("인덱스 로드 실패: " + res.status);
    entries = await res.json();
    if (!Array.isArray(entries)) entries = [];
  } finally {
    isLoading = false;
  }
}

function compareByBookChapterVerse(a, b) {
  // 책 순서(bo) → 장(c) → 절(v)
  if (a.bo !== b.bo) return a.bo - b.bo;
  if (a.c !== b.c) return a.c - b.c;
  return a.v - b.v;
}

async function handleQuery(q, limit = 50, page = 1) {
  await ensureIndexLoaded();
  const query = normalize(q).trim();
  if (!query) {
    post("results", {
      q: query,
      results: [],
      page: 1,
      total: 0,
      pageSize: limit,
    });
    return;
  }
  const matched = [];
  // 선형 스캔 → 매치 컬렉션 → 책/장/절 정렬 → 페이지 슬라이스
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const text = normalize(e.t);
    if (includesIgnoreCase(text, query)) matched.push(e);
  }
  matched.sort(compareByBookChapterVerse);
  const total = matched.length;
  const pageIndex = Math.max(0, (page || 1) - 1);
  const start = pageIndex * limit;
  const end = Math.min(total, start + limit);
  const results = matched.slice(start, end);
  post("results", {
    q: query,
    results,
    page: page || 1,
    total,
    pageSize: limit,
  });
}

onmessage = (ev) => {
  const data = ev.data || {};
  if (data.type === "init") {
    post("ready", {});
    return;
  }
  if (data.type === "config") {
    INDEX_URL = data.indexUrl || INDEX_URL;
    // config 후 즉시 로드하지 않고 지연 로드
    return;
  }
  if (data.type === "query") {
    pendingQuery = data.q;
    handleQuery(data.q, data.limit, data.page).catch((err) => {
      post("error", { message: String((err && err.message) || err) });
    });
    return;
  }
};
