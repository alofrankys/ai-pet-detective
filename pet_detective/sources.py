from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"}


@dataclass(frozen=True)
class VideoSource:
    """A source that OpenCV can read, plus useful display metadata."""

    stream_url: str
    label: str
    is_live: bool = False


def is_youtube_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and parsed.hostname in YOUTUBE_HOSTS


def youtube_embed_url(value: str) -> str:
    """Return a safe embed URL for one YouTube video, or raise ValueError."""
    parsed = urlparse(value)
    if not is_youtube_url(value):
        raise ValueError("Inserisci un URL YouTube valido.")
    if parsed.hostname == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    elif parsed.path == "/watch":
        video_id = parse_qs(parsed.query).get("v", [""])[0]
    elif parsed.path.startswith(("/shorts/", "/live/", "/embed/")):
        video_id = parsed.path.strip("/").split("/")[1] if len(parsed.path.strip("/").split("/")) > 1 else ""
    else:
        video_id = ""
    if not video_id or not all(char.isalnum() or char in "-_" for char in video_id):
        raise ValueError("L'URL deve indicare un singolo video YouTube.")
    return f"https://www.youtube.com/embed/{video_id}"


def resolve_video_source(source: str) -> VideoSource:
    """Resolve a YouTube page to its current media stream without downloading it."""
    if not is_youtube_url(source):
        return VideoSource(source, source)
    youtube_embed_url(source)  # Reject channel, playlist, and malformed URLs early.
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("Installa il supporto YouTube: pip install -e '.[youtube]'") from exc
    options = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        # A broadly compatible direct stream, capped to keep local analysis practical.
        "format": "best[height<=720][ext=mp4]/best[height<=720]/best",
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(source, download=False)
    stream_url = info.get("url")
    if not stream_url:
        raise RuntimeError("YouTube non ha fornito un flusso video utilizzabile per questo link.")
    return VideoSource(stream_url, info.get("title") or source, bool(info.get("is_live")))
