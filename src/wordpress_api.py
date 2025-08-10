"""
WordPress Publisher CLI Skeleton

- Provides CLI commands described in docs/design-specification.md §4.1
- Safe no-op/dry-run defaults; real HTTP calls to be implemented later

Commands:
  - ensure-assets
  - publish-chapter
  - publish-batch
  - bulk-status
  - list-posts
"""

from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import logging
from pathlib import Path
import time
import mimetypes
from urllib.parse import urljoin
import requests
from requests.auth import HTTPBasicAuth
from typing import Any, Dict, List, Optional

from .config import Config


# -----------------------------
# Data models
# -----------------------------


@dataclasses.dataclass
class AssetRecord:
    slug: str
    sha256: str
    wp_media_id: Optional[int]
    source_url: Optional[str]
    mime_type: Optional[str]
    uploaded_at: Optional[str]


@dataclasses.dataclass
class ChapterPostMeta:
    book_name: str
    book_abbr: str
    english_name: str
    division: str
    chapter_number: int


# -----------------------------
# Asset Registry
# -----------------------------


class AssetRegistry:
    """Local registry mapping local files to WP media info."""

    def __init__(self, index_path: Path) -> None:
        self.index_path: Path = index_path
        self._records: Dict[str, AssetRecord] = {}

    def load(self) -> None:
        if self.index_path.exists():
            try:
                raw = json.loads(self.index_path.read_text(encoding="utf-8"))
                for local_path, record in raw.items():
                    self._records[local_path] = AssetRecord(**record)
            except Exception as exc:
                logging.warning(
                    "Failed to load asset index %s: %s", self.index_path, exc)

    def save(self) -> None:
        self.index_path.parent.mkdir(parents=True, exist_ok=True)
        serializable = {k: dataclasses.asdict(
            v) for k, v in self._records.items()}
        self.index_path.write_text(json.dumps(
            serializable, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, local_path: Path) -> Optional[AssetRecord]:
        return self._records.get(str(local_path))

    def upsert(self, local_path: Path, record: AssetRecord) -> None:
        self._records[str(local_path)] = record


# -----------------------------
# WordPress Client (stub)
# -----------------------------


class WordPressClient:
    """WordPress REST API 클라이언트

    - Application Password 기반 기본 인증 사용
    - 재시도/백오프/타임아웃/로깅 적용
    """

    def __init__(self, config: Config) -> None:
        self.config = config
        self.base_api = config.get_wordpress_api_url()
        self.timeout_sec = int(getattr(config, "wp_timeout", 5))
        self.max_retries = int(getattr(config, "wp_retry_count", 3))
        self.verify_ssl = getattr(config, "verify_ssl", True)
        self.session = requests.Session()
        username = config.wp_username
        password = config.wp_password
        if username is None or password is None:
            raise ValueError(
                "Missing WordPress credentials: set WP_USERNAME and WP_PASSWORD"
            )
        self.session.auth = HTTPBasicAuth(username, password)

    def _request(
        self,
        method: str,
        endpoint: str,
        *,
        params: Optional[dict] = None,
        data: Optional[dict] = None,
        json: Optional[dict] = None,
        files: Optional[dict] = None,
    ) -> requests.Response:
        url = urljoin(self.base_api + "/", endpoint.lstrip("/"))
        attempt = 0
        backoff = 0.5
        while True:
            attempt += 1
            start_time = time.time()
            try:
                resp = self.session.request(
                    method,
                    url,
                    params=params,
                    data=data,
                    json=json,
                    files=files,
                    timeout=self.timeout_sec,
                    verify=self.verify_ssl,
                )
            except requests.RequestException as exc:
                logging.warning("HTTP %s %s failed: %s", method, url, exc)
                if attempt >= self.max_retries:
                    raise
                time.sleep(backoff)
                backoff *= 2
                continue

            elapsed = int((time.time() - start_time) * 1000)
            logging.info("HTTP %s %s -> %s (%d ms)", method,
                         url, resp.status_code, elapsed)

            if resp.status_code in (429,) or 500 <= resp.status_code < 600:
                if attempt >= self.max_retries:
                    resp.raise_for_status()
                retry_after = resp.headers.get("Retry-After")
                sleep_s = float(retry_after) if retry_after else backoff
                time.sleep(sleep_s)
                backoff = min(backoff * 2, 8.0)
                continue

            # 4xx 즉시 실패
            if 400 <= resp.status_code < 500 and resp.status_code not in (409,):
                resp.raise_for_status()
            return resp

    # Media
    def upload_media_from_path(self, file_path: str, desired_slug: str, mime_hint: str) -> AssetRecord:
        """미디어 업로드. 동일 슬러그가 있고 해시가 일치하면 기존 반환.

        - description 필드에 `cb:sha256=<hex>`를 저장하여 추후 비교에 사용
        - 파일명은 desired_slug를 그대로 사용
        """
        path = Path(file_path)
        if not path.exists():
            raise FileNotFoundError(f"Media not found: {file_path}")

        sha256 = _hash_file(path)
        existing = self.find_media_by_slug(desired_slug)
        if existing and existing.sha256:
            if existing.sha256 == sha256:
                return existing

        # files payload
        filename = desired_slug
        # 추정 MIME
        guessed = mimetypes.guess_type(
            filename)[0] or mime_hint or "application/octet-stream"
        files = {
            "file": (filename, path.open("rb"), guessed),
        }
        data = {
            "title": desired_slug,
            "slug": desired_slug,
            "description": f"cb:sha256={sha256}",
        }
        resp = self._request("POST", "/media", data=data, files=files)
        info = resp.json()
        return AssetRecord(
            slug=info.get("slug", desired_slug),
            sha256=sha256,
            wp_media_id=info.get("id"),
            source_url=info.get("source_url"),
            mime_type=info.get("mime_type") or guessed,
            uploaded_at=info.get("date_gmt") or info.get("date"),
        )

    def find_media_by_slug(self, slug: str) -> Optional[AssetRecord]:
        params = {"search": slug, "per_page": 100}
        resp = self._request("GET", "/media", params=params)
        for item in resp.json():
            if item.get("slug") == slug:
                # description 내에 cb:sha256= 파싱 시도
                desc = (item.get("description") or {}).get("raw") or (
                    item.get("description") or {}).get("rendered") or ""
                sha = None
                if isinstance(desc, str) and "cb:sha256=" in desc:
                    try:
                        sha = desc.split("cb:sha256=")[1].split()[0].strip()
                    except Exception:
                        sha = None
                return AssetRecord(
                    slug=item.get("slug"),
                    sha256=sha or "",
                    wp_media_id=item.get("id"),
                    source_url=item.get("source_url"),
                    mime_type=item.get("mime_type"),
                    uploaded_at=item.get("date_gmt") or item.get("date"),
                )
        return None

    # Terms
    def ensure_category(self, name: str) -> int:
        params = {"search": name, "per_page": 100}
        resp = self._request("GET", "/categories", params=params)
        for item in resp.json():
            if item.get("name") == name:
                return int(item.get("id"))
        data = {"name": name}
        created = self._request("POST", "/categories", json=data).json()
        return int(created.get("id"))

    def ensure_tag(self, name: str) -> int:
        params = {"search": name, "per_page": 100}
        resp = self._request("GET", "/tags", params=params)
        for item in resp.json():
            if item.get("name") == name:
                return int(item.get("id"))
        data = {"name": name}
        created = self._request("POST", "/tags", json=data).json()
        return int(created.get("id"))

    # Posts
    def create_or_update_post(
        self,
        slug: str,
        title: str,
        content_html: str,
        status: str,
        category_ids: List[int],
        tag_ids: List[int],
    ) -> int:
        # 먼저 슬러그로 검색
        exists = self._request(
            "GET", "/posts", params={"slug": slug, "per_page": 1}).json()
        payload = {
            "title": title,
            "slug": slug,
            "status": status,
            "content": content_html,
            "categories": category_ids,
            "tags": tag_ids,
        }
        if exists:
            post_id = int(exists[0]["id"])
            updated = self._request(
                "PUT", f"/posts/{post_id}", json=payload).json()
            return int(updated.get("id", post_id))
        created = self._request("POST", "/posts", json=payload).json()
        return int(created.get("id"))

    def update_post_status(self, post_id: int, status: str, scheduled_iso: Optional[str] = None) -> int:
        payload: Dict[str, Any] = {"status": status}
        if scheduled_iso:
            # 예약 공개는 future 상태와 함께 date_gmt 설정 사용
            payload["status"] = "future"
            payload["date_gmt"] = scheduled_iso
        updated = self._request(
            "PUT", f"/posts/{post_id}", json=payload).json()
        return int(updated.get("id", post_id))

    def list_posts(
        self,
        status: str,
        category_id: Optional[int] = None,
        tag_ids: Optional[List[int]] = None,
        slug_prefix: Optional[str] = None,
        per_page: int = 100,
        page: int = 1,
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {"status": status,
                                  "per_page": per_page, "page": page}
        if category_id:
            params["categories"] = category_id
        if tag_ids:
            # WordPress expects comma-separated IDs
            params["tags"] = ",".join(str(t) for t in tag_ids)
        resp = self._request("GET", "/posts", params=params)
        items = resp.json()
        if slug_prefix:
            items = [it for it in items if str(
                it.get("slug", "")).startswith(slug_prefix)]
        return items


# -----------------------------
# Publisher Orchestrator
# -----------------------------


class Publisher:
    def __init__(self, config: Config, registry: AssetRegistry, client: WordPressClient) -> None:
        self.config = config
        self.registry = registry
        self.client = client

    def ensure_policy_assets(self, css_path: Path, audio_dir: Optional[Path] = None) -> Dict[str, Any]:
        results: Dict[str, Any] = {"css": None, "audio": []}

        # CSS: 내용 기반 버전 파일명으로 업로드
        if css_path.exists():
            css_hash = _hash_file(css_path)
            css_slug = f"verse-style-{css_hash[:8]}.css"
            uploaded = self.client.upload_media_from_path(
                str(css_path), css_slug, "text/css")
            self.registry.upsert(css_path, uploaded)
            results["css"] = dataclasses.asdict(uploaded)
        else:
            logging.warning("CSS file not found: %s", css_path)

        # Audio (optional): 폴더 내 mp3 업로드
        if audio_dir and audio_dir.exists():
            for mp3 in sorted(audio_dir.glob("*.mp3")):
                uploaded = self.client.upload_media_from_path(
                    str(mp3), mp3.name, "audio/mpeg")
                self.registry.upsert(mp3, uploaded)
                results["audio"].append(dataclasses.asdict(uploaded))
        elif audio_dir:
            logging.warning("Audio dir not found: %s", audio_dir)

        return results

    def ensure_audio_asset(self, english_book_slug: str, chapter: int, local_audio_path: Path) -> Optional[AssetRecord]:
        """장 오디오 자산 보장: slug 충돌 시 해시 접미어 부여"""
        base_slug = f"{english_book_slug}-{chapter}.mp3"
        sha = _hash_file(local_audio_path)
        existing = self.client.find_media_by_slug(base_slug)
        if existing and existing.sha256 == sha:
            return existing

        desired = base_slug
        if existing and existing.sha256 and existing.sha256 != sha:
            desired = f"{english_book_slug}-{chapter}-{sha[:8]}.mp3"

        uploaded = self.client.upload_media_from_path(
            str(local_audio_path), desired, "audio/mpeg")
        self.registry.upsert(local_audio_path, uploaded)
        return uploaded

    def render_and_publish_chapter(self, html_path: Path, meta: ChapterPostMeta, status: Optional[str] = None, dry_run: bool = True) -> int:
        if not html_path.exists():
            raise FileNotFoundError(f"HTML not found: {html_path}")

        content_html = html_path.read_text(encoding="utf-8")
        # 링크 재작성: 오디오
        english_slug = _to_slug(meta.english_name)
        expected_name = f"{english_slug}-{meta.chapter_number}.mp3"
        local_audio = Path("data") / "audio" / expected_name
        audio_record: Optional[AssetRecord] = None
        if local_audio.exists():
            audio_record = self.ensure_audio_asset(
                english_slug, meta.chapter_number, local_audio)
            if audio_record and audio_record.source_url:
                # src="...expected_name" 형태를 모두 교체
                content_html = content_html.replace(
                    expected_name, Path(audio_record.source_url).name)
                # 절대 URL로 바꾸기
                content_html = content_html.replace(
                    f"src=\"{Path(audio_record.source_url).name}\"", f"src=\"{audio_record.source_url}\"")

        title = f"{meta.book_name} {meta.chapter_number}장"
        slug = f"{_to_slug(meta.english_name)}-{meta.chapter_number}"
        status_to_use = status or self.config.wp_default_status

        category_id = self.client.ensure_category(self.config.wp_base_category)
        tag_ids = [
            self.client.ensure_tag(self.config.wp_base_tag),
            self.client.ensure_tag(meta.division),
            self.client.ensure_tag(meta.book_name),
        ]

        if dry_run:
            logging.info(
                "[DRY] would publish: slug=%s title=%s status=%s categories=%s tags=%s",
                slug,
                title,
                status_to_use,
                [category_id],
                tag_ids,
            )
            return 0

        return self.client.create_or_update_post(
            slug=slug,
            title=title,
            content_html=content_html,
            status=status_to_use,
            category_ids=[category_id],
            tag_ids=tag_ids,
        )

    def bulk_update_status(
        self,
        target_status: str,
        *,
        category: str = "공동번역성서",
        division_tag: Optional[str] = None,
        slug_prefix: Optional[str] = None,
        scheduled_iso: Optional[str] = None,
        dry_run: bool = False,
        per_page: int = 100,
    ) -> Dict[str, Any]:
        category_id = self.client.ensure_category(category)
        tag_ids: List[int] = []
        if division_tag:
            tag_ids.append(self.client.ensure_tag(division_tag))

        page = 1
        total = succeeded = failed = skipped = 0
        details: List[Dict[str, Any]] = []

        while True:
            posts = self.client.list_posts(
                status="private", category_id=category_id, tag_ids=tag_ids or None, slug_prefix=slug_prefix, per_page=per_page, page=page
            )
            if not posts:
                break

            for post in posts:
                total += 1
                post_id = int(post.get("id", 0))
                if dry_run:
                    skipped += 1
                    details.append({"id": post_id, "action": "skip(dry-run)"})
                    continue
                try:
                    self.client.update_post_status(
                        post_id, target_status, scheduled_iso)
                    succeeded += 1
                    details.append(
                        {"id": post_id, "action": f"updated->{target_status}"})
                except Exception as exc:  # pragma: no cover (stub)
                    failed += 1
                    details.append(
                        {"id": post_id, "action": "failed", "error": str(exc)})

            page += 1

        return {"total": total, "succeeded": succeeded, "failed": failed, "skipped": skipped, "details": details}


# -----------------------------
# Helpers
# -----------------------------


def _hash_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _to_slug(text: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "-" for ch in text).strip("-").replace("--", "-")


def _configure_logging(config: Config) -> None:
    level = getattr(logging, config.log_level, logging.INFO)
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


# -----------------------------
# CLI
# -----------------------------


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WordPress Publisher CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    # ensure-assets
    p_assets = sub.add_parser(
        "ensure-assets", help="Upload/ensure CSS & mp3 assets")
    p_assets.add_argument("--css", type=Path, required=True)
    p_assets.add_argument("--audio-dir", type=Path, required=False)
    p_assets.add_argument("--index", type=Path,
                          default=Path("output/wp_asset_index.json"))

    # publish-chapter
    p_publish = sub.add_parser(
        "publish-chapter", help="Publish or update a single chapter HTML")
    p_publish.add_argument("--html", type=Path, required=True)
    p_publish.add_argument("--book-name", required=False)
    p_publish.add_argument("--book-abbr", required=False)
    p_publish.add_argument("--english-name", required=False)
    p_publish.add_argument("--division", required=False)
    p_publish.add_argument("--chapter", type=int, required=False)
    p_publish.add_argument("--meta-json", type=Path, required=False)
    p_publish.add_argument("--status", default=None)
    p_publish.add_argument("--index", type=Path,
                           default=Path("output/wp_asset_index.json"))
    p_publish.add_argument("--dry-run", action="store_true", default=False)

    # publish-batch
    p_batch = sub.add_parser(
        "publish-batch", help="Batch publish chapters from a directory")
    p_batch.add_argument("--html-dir", type=Path, required=True)
    p_batch.add_argument("--book-abbr", required=False)
    p_batch.add_argument("--from-chapter", type=int, required=False)
    p_batch.add_argument("--to-chapter", type=int, required=False)
    p_batch.add_argument("--status", default=None)
    p_batch.add_argument("--concurrency", type=int, default=3)
    p_batch.add_argument("--index", type=Path,
                         default=Path("output/wp_asset_index.json"))
    p_batch.add_argument("--dry-run", action="store_true", default=False)

    # bulk-status
    p_bulk = sub.add_parser(
        "bulk-status", help="Bulk update post status (publish/private/draft/pending)")
    p_bulk.add_argument("--to", required=True,
                        choices=["publish", "private", "draft", "pending"])
    p_bulk.add_argument("--category", default="공동번역성서")
    p_bulk.add_argument("--division-tag", required=False)
    p_bulk.add_argument("--slug-prefix", required=False)
    p_bulk.add_argument("--schedule", required=False)
    p_bulk.add_argument("--dry-run", action="store_true", default=False)

    # list-posts
    p_list = sub.add_parser("list-posts", help="List posts that match filters")
    p_list.add_argument("--status", default="private")
    p_list.add_argument("--category", default="공동번역성서")
    p_list.add_argument("--division-tag", required=False)
    p_list.add_argument("--slug-prefix", required=False)

    return parser


def _load_meta_from_args(args: argparse.Namespace) -> ChapterPostMeta:
    if args.meta_json:
        data = json.loads(Path(args.meta_json).read_text(encoding="utf-8"))
        return ChapterPostMeta(
            book_name=data["book_name"],
            book_abbr=data["book_abbr"],
            english_name=data["english_name"],
            division=data["division"],
            chapter_number=int(data["chapter_number"]),
        )

    required = ["book_name", "book_abbr",
                "english_name", "division", "chapter"]
    missing = [k for k in required if getattr(
        args, k.replace("chapter", "chapter"), None) in (None, "")]
    if missing:
        raise ValueError(
            f"Missing meta args: {', '.join(missing)} or provide --meta-json")

    return ChapterPostMeta(
        book_name=args.book_name,
        book_abbr=args.book_abbr,
        english_name=args.english_name,
        division=args.division,
        chapter_number=int(args.chapter),
    )


def main(argv: Optional[List[str]] = None) -> int:
    config = Config()
    _configure_logging(config)

    parser = _build_parser()
    args = parser.parse_args(argv)

    registry = AssetRegistry(index_path=Path(args.index) if hasattr(
        args, "index") else Path("output/wp_asset_index.json"))
    registry.load()
    client = WordPressClient(config)
    publisher = Publisher(config, registry, client)

    if args.command == "ensure-assets":
        results = publisher.ensure_policy_assets(
            css_path=args.css, audio_dir=args.audio_dir)
        registry.save()
        print(json.dumps(results, ensure_ascii=False, indent=2))
        return 0

    if args.command == "publish-chapter":
        meta = _load_meta_from_args(args)
        post_id = publisher.render_and_publish_chapter(
            html_path=args.html,
            meta=meta,
            status=args.status,
            dry_run=args.dry_run,
        )
        registry.save()
        print(json.dumps({"post_id": post_id}, ensure_ascii=False))
        return 0

    if args.command == "publish-batch":
        html_files = sorted(Path(args.html_dir).glob("*.html"))
        summary: List[Dict[str, Any]] = []
        for html in html_files:
            # Skeleton: cannot infer meta from filename reliably; skip if insufficient
            if args.book_abbr is None or args.from_chapter is None or args.to_chapter is None:
                logging.warning(
                    "Missing filters to derive meta for %s; skipping in skeleton", html)
                summary.append({"html": str(html), "skipped": True})
                continue
            # Minimal meta (english_name needs mapping in real impl)
            meta = ChapterPostMeta(
                book_name=args.book_abbr,  # placeholder
                book_abbr=args.book_abbr,
                english_name=args.book_abbr,
                division="구약",
                chapter_number=args.from_chapter,
            )
            post_id = publisher.render_and_publish_chapter(
                html_path=html, meta=meta, status=args.status, dry_run=args.dry_run)
            summary.append({"html": str(html), "post_id": post_id})
        registry.save()
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0

    if args.command == "bulk-status":
        result = publisher.bulk_update_status(
            target_status=args.to,
            category=args.category,
            division_tag=args.division_tag,
            slug_prefix=args.slug_prefix,
            scheduled_iso=args.schedule,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    if args.command == "list-posts":
        category_id = client.ensure_category(args.category)
        tag_ids: List[int] = []
        if args.division_tag:
            tag_ids.append(client.ensure_tag(args.division_tag))
        posts = client.list_posts(status=args.status, category_id=category_id,
                                  tag_ids=tag_ids or None, slug_prefix=args.slug_prefix)
        print(json.dumps(posts, ensure_ascii=False, indent=2))
        return 0

    parser.error("Unknown command")
    return 2


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
