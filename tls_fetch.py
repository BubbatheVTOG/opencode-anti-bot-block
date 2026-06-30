#!/usr/bin/env python3
"""tls_fetch.py — curl_cffi wrapper for opencode custom tool.

Reads a JSON request on stdin, makes an HTTP request with TLS fingerprint
impersonation via curl_cffi, and emits a JSON response on stdout.

Request schema (stdin):
    {
        "url": str,
        "impersonate": str | None,     # "chrome" | "firefox" | "safari" | "chrome124" | ...
        "method": str,                 # "get" | "post" | "put" | "delete" | "patch"
        "headers": dict | None,
        "body": str | None,
        "proxy": str | None,           # http:// or socks5:// URL
        "http_version": str | None,    # "v1" | "v2" | "v3"
        "ja3": str | None,             # custom JA3 (overrides impersonate)
        "ja4r": str | None,            # custom JA4 raw (passed as extra_fp["ja4_r"])
        "timeout": int,                # seconds
        "max_length": int               # truncate body in response
    }

Response schema (stdout):
    {
        "ok": bool,
        "status": int,
        "headers": dict,
        "body": str,                    # truncated to max_length
        "body_truncated": bool,
        "body_len": int,                # full body length
        "fingerprint": str,             # what was actually used
        "url": str,
        "elapsed_ms": int
    }
    or on error:
    { "ok": false, "error": str, "error_type": str }
"""

import sys
import os
import json
import time
import traceback


def main() -> int:
    try:
        req = json.loads(sys.stdin.read())
    except Exception as e:
        emit_error(f"failed to parse stdin JSON: {e}", "InputError")
        return 1

    url = req.get("url")
    if not url:
        emit_error("missing required field: url", "InputError")
        return 1

    method = (req.get("method") or "get").lower()
    impersonate = req.get("impersonate") or "chrome"
    headers = req.get("headers") or None
    body = req.get("body")
    proxy = req.get("proxy")
    http_version = req.get("http_version")
    ja3 = req.get("ja3")
    ja4r = req.get("ja4r")
    timeout = req.get("timeout", 30)
    max_length = req.get("max_length", 10000)

    try:
        from curl_cffi import requests as cffi_requests
    except ImportError:
        emit_error(
            "curl_cffi is not installed in this environment. "
            "The opencode tool should create a venv before invoking this script.",
            "ImportError",
        )
        return 2

    kwargs = {}
    if impersonate:
        kwargs["impersonate"] = impersonate
    if headers:
        kwargs["headers"] = headers
    if body is not None:
        kwargs["data"] = body
    if proxy:
        scheme = "https"
        if url.lower().startswith("http://"):
            scheme = "http"
        kwargs["proxies"] = {scheme: proxy}
    if http_version:
        kwargs["http_version"] = http_version
    if ja3:
        kwargs["ja3"] = ja3
    if ja4r:
        kwargs.setdefault("extra_fp", {})["ja4_r"] = ja4r
    if timeout:
        kwargs["timeout"] = timeout

    func_name = method
    func = getattr(cffi_requests, func_name, None)
    if func is None:
        emit_error(f"unsupported method: {method}", "InputError")
        return 1

    t0 = time.monotonic()
    try:
        r = func(url, **kwargs)
    except Exception as e:
        tb = traceback.format_exc()
        emit_error(f"request failed: {e}\n{tb}", "RequestError")
        return 3

    elapsed_ms = int((time.monotonic() - t0) * 1000)
    raw_body = r.content
    if isinstance(raw_body, bytes):
        try:
            raw_body = raw_body.decode("utf-8", errors="replace")
        except Exception:
            raw_body = repr(raw_body)

    body_len = len(raw_body)
    # max_length <= 0 means unlimited (used when output_file requested)
    body_truncated = max_length > 0 and body_len > max_length
    out_body = raw_body[:max_length] if body_truncated else raw_body

    resp_headers = {}
    try:
        for k, v in r.headers.items():
            resp_headers[k] = v
    except Exception:
        pass

    out = {
        "ok": True,
        "status": r.status_code,
        "headers": resp_headers,
        "body": out_body,
        "body_truncated": body_truncated,
        "body_len": body_len,
        "fingerprint": impersonate or "none",
        "url": url,
        "elapsed_ms": elapsed_ms,
    }
    sys.stdout.write(json.dumps(out))
    sys.stdout.write("\n")
    return 0


def emit_error(message: str, error_type: str) -> None:
    sys.stdout.write(json.dumps({"ok": False, "error": message, "error_type": error_type}))
    sys.stdout.write("\n")


if __name__ == "__main__":
    sys.exit(main())
