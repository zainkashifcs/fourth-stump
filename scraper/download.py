"""Download Cricsheet's Test archive once and keep it on disk (ADR-009)."""
import asyncio
from pathlib import Path

import httpx

ARCHIVE_URL = "https://cricsheet.org/downloads/tests_json.zip"
CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "cache"
ARCHIVE_PATH = CACHE_DIR / "tests_json.zip"
USER_AGENT = "fourth-stump-ev/0.1 (one cached download of the Test archive)"
RETRY_STATUS = frozenset({429, 500, 502, 503, 504})


class DownloadError(RuntimeError):
    """The archive could not be fetched. A refusal is reported, never worked around."""


async def _stream_to(client: httpx.AsyncClient, url: str, dest: Path) -> None:
    async with client.stream("GET", url) as response:
        response.raise_for_status()
        with dest.open("wb") as out:
            async for chunk in response.aiter_bytes():
                out.write(chunk)


def _is_retryable(error: httpx.HTTPError) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in RETRY_STATUS
    return isinstance(error, httpx.TransportError)


async def fetch_archive(url: str = ARCHIVE_URL, dest: Path = ARCHIVE_PATH, *, client: httpx.AsyncClient | None = None,
                        attempts: int = 4, delay: float = 1.0, backoff: float = 2.0) -> Path:
    """Return the cached archive, downloading it only if it is not already on disk.

    Requests are spaced by `delay` seconds plus an exponential `backoff`. Only transport
    errors and 429/5xx responses are retried; any other refusal raises DownloadError.
    """
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_suffix(dest.suffix + ".part")  # an interrupted download must not look like a cache hit
    owned = client is None
    client = client or httpx.AsyncClient(headers={"User-Agent": USER_AGENT}, follow_redirects=True, timeout=60.0)
    last_error: httpx.HTTPError | None = None
    try:
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(delay + backoff * 2 ** (attempt - 1))
            try:
                await _stream_to(client, url, partial)
            except httpx.HTTPError as error:
                if not _is_retryable(error):
                    raise DownloadError(f"{url} refused the request: {error}") from error
                last_error = error
            else:
                partial.replace(dest)
                return dest
        raise DownloadError(f"{url} failed after {attempts} attempts: {last_error}") from last_error
    finally:
        partial.unlink(missing_ok=True)
        if owned:
            await client.aclose()
