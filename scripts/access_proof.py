#!/usr/bin/env python3
"""Bounded, no-account public-feed checks for the approved access experiment.

This script makes ordinary HTTPS GETs. It does not call paid providers, download
audio, generate transcripts, or infer full-content access from descriptions.
Raw responses stay in ignored .local/; the report contains hashes and metadata.
"""

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
USER_AGENT = "therecap-access-proof/0.1 (bounded public feed validation)"


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def local_name(tag):
    return tag.rsplit("}", 1)[-1]


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.ignored = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.ignored += 1
        elif tag in ("p", "br", "div", "li", "h1", "h2", "h3"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.ignored = max(0, self.ignored - 1)
        elif tag in ("p", "div", "li"):
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.ignored:
            self.parts.append(data)


def strip_html(value):
    parser = PlainText()
    parser.feed(value)
    return re.sub(r"\s+", " ", "".join(parser.parts)).strip()


def field(element, names):
    for name in names:
        for child in element:
            if local_name(child.tag) == name:
                if list(child):
                    return "".join(ET.tostring(c, encoding="unicode") for c in child)
                return child.text or ""
    return ""


def parse_date(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        try:
            result = parsedate_to_datetime(value)
        except (ValueError, TypeError, OverflowError):
            return None
    if result.tzinfo is None:
        # RFC 2822 -0000 is a UTC instant with unknown originating local zone.
        if re.search(r"\s-0000\s*$", value):
            result = result.replace(tzinfo=timezone.utc)
        else:
            return None
    return result.astimezone(timezone.utc).isoformat(timespec="seconds")


def public_https(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use an HTTPS URL without embedded credentials")
    if parsed.hostname in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Local endpoints are outside this public-source proof")
    return url


def fetch(url):
    request = urllib.request.Request(public_https(url), headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=35) as response:
        body = response.read(MAX_BYTES + 1)
        if len(body) > MAX_BYTES:
            raise ValueError("Response exceeds the 8 MiB proof limit")
        return body, response.status, response.url, response.headers.get("Content-Type", "")


def parse_feed(body, source_url, limit=5, family="blogs"):
    declarations = re.sub(rb"<!\[CDATA\[.*?\]\]>|<!--.*?-->", b"", body, flags=re.S)
    if re.search(rb"<!\s*(?:DOCTYPE|ENTITY)\b", declarations, re.I):
        raise ValueError("Feed contains a document type/entity declaration")
    root = ET.fromstring(body)
    entries = [e for e in root.iter() if local_name(e.tag) in ("item", "entry")]
    results, seen, duplicate_count = [], set(), 0
    for element in entries:
        url = ""
        for child in element:
            if local_name(child.tag) == "link":
                if child.attrib.get("rel", "alternate") == "alternate":
                    url = child.attrib.get("href") or child.text or ""
                    if url.strip():
                        break
        url = urllib.parse.urljoin(source_url, url.strip())
        publisher_id = field(element, ("guid", "id")).strip()
        if not url or url == source_url:
            url = publisher_id if publisher_id.startswith("https://") else ""
        # Several podcast publishers reuse the homepage link on every episode.
        # Their distinct GUIDs must take precedence over a shared link.
        key = publisher_id or url
        if not key:
            key = hashlib.sha256(ET.tostring(element)).hexdigest()
        if key in seen:
            duplicate_count += 1
            continue
        seen.add(key)
        body_field = ""
        for candidate in ("encoded", "content", "description", "summary"):
            body_field = field(element, (candidate,))
            if body_field.strip():
                content_kind = candidate
                break
        else:
            content_kind = "missing"
        text = strip_html(body_field)
        transcripts, audio_urls, media_enclosures = [], [], []
        for child in element:
            if child.tag == "{https://podcastindex.org/namespace/1.0}transcript":
                if child.attrib.get("url"):
                    transcripts.append({"url": child.attrib["url"], "type": child.attrib.get("type")})
            if local_name(child.tag) == "enclosure" and child.attrib.get("url"):
                mime_type = child.attrib.get("type", "")
                media_enclosures.append({"url": child.attrib["url"], "type": mime_type or None})
                if mime_type.lower().startswith("audio/"):
                    audio_urls.append(child.attrib["url"])
        date_value = field(element, ("pubDate", "published", "updated", "date")).strip()
        coverage = "show_notes_only" if family == "podcasts" else "feed_body_unverified"
        if not text:
            coverage = "metadata_only"
        elif family != "podcasts" and content_kind in ("summary", "description"):
            coverage = "feed_summary_unverified"
        results.append({
            "sourceItemId": publisher_id or key,
            "url": url or None,
            "urlSpecificity": ("missing" if not url else
                               "homepage_link" if (urllib.parse.urlsplit(url).path in ("", "/")
                                                   and not urllib.parse.urlsplit(url).query) else
                               "item_link_unverified"),
            "title": strip_html(field(element, ("title",))),
            "publishedAt": parse_date(date_value),
            "publisherDateRaw": date_value,
            "contentField": content_kind,
            "contentChars": len(text),
            "contentSha256": hashlib.sha256(text.encode()).hexdigest() if text else None,
            "coverage": coverage,
            "publisherTranscriptLinks": transcripts,
            "audioUrls": audio_urls,
            "mediaEnclosures": media_enclosures,
        })
    results.sort(key=lambda item: item["publishedAt"] or "", reverse=True)
    return results[:limit], len(entries), duplicate_count


def collect(args):
    manifest_bytes = Path(args.manifest).read_bytes()
    manifest = json.loads(manifest_bytes)
    sources = manifest["sources"]
    counts = {}
    ids = set()
    for source in sources:
        source_id = source["id"]
        if not re.fullmatch(r"[a-z0-9_-]+", source_id) or source_id in ids:
            raise ValueError("Source IDs must be unique lowercase identifiers, not file paths")
        ids.add(source_id)
        counts[source["family"]] = counts.get(source["family"], 0) + 1
    if counts != {name: 5 for name in ("youtube", "x", "instagram", "linkedin", "podcasts", "newsletters", "blogs")}:
        raise ValueError("The frozen proof manifest must contain five sources in each approved family")
    families = set(args.families.split(","))
    selected = [s for s in sources if s["family"] in families]
    if not selected:
        raise ValueError("No sources match the requested families")
    if args.max_items < 1 or args.max_items > 5:
        raise ValueError("Approved initial item cap is 1–5 per source/check")
    label = args.label
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", label):
        raise ValueError("Run labels must contain only letters, digits, hyphens or underscores")
    raw_dir = ROOT / ".local" / "access-proof" / label
    report_path = ROOT / "docs" / "access-proof" / "results" / f"{label}.json"
    if report_path.exists():
        raise ValueError("This run label already has evidence; choose a new label instead of overwriting it")
    raw_dir.mkdir(parents=True, exist_ok=True)
    report = {
        "runLabel": label, "startedAt": now(), "type": "public_feed_preflight",
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "formalSevenDayBaseline": False, "cashPaidEUR": 0,
        "paidProviderCalls": 0, "generatedTranscriptionMinutes": 0, "sources": [],
    }
    for source in selected:
        check = {"sourceId": source["id"], "family": source["family"],
                 "name": source["name"], "checkedAt": now(), "feedUrl": source["feedUrl"]}
        try:
            body, status, final_url, content_type = fetch(source["feedUrl"])
            raw_path = raw_dir / f"{source['id']}.xml"
            raw_path.write_bytes(body)
            check.update({"httpStatus": status, "finalUrl": final_url,
                          "contentType": content_type, "responseBytes": len(body),
                          "responseSha256": hashlib.sha256(body).hexdigest(),
                          "rawLocalPath": str(raw_path.relative_to(ROOT))})
            items, total, duplicates = parse_feed(body, final_url, args.max_items, source["family"])
            check.update({"status": "fetched",
                          "feedItemsAvailable": total, "duplicatesInFeed": duplicates,
                          "items": items, "completenessAgainstOriginal": "not_measured",
                          "sevenDayReliability": "not_measured"})
        except (urllib.error.URLError, ValueError, ET.ParseError, TimeoutError, OSError) as error:
            check.update({"status": "failed", "error": str(error)[:500], "items": []})
        report["sources"].append(check)
        print(f"{check['status']}: {source['id']} ({len(check['items'])} sampled items)")
    report["finishedAt"] = now()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(f"Evidence: {report_path.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", default=str(ROOT / "docs/access-proof/sources.json"))
    parser.add_argument("--families", default="blogs,newsletters,podcasts")
    parser.add_argument("--max-items", type=int, default=5)
    parser.add_argument("--label", required=True, help="Unique label; existing evidence is never overwritten")
    args = parser.parse_args()
    try:
        collect(args)
    except (ValueError, OSError, KeyError) as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
