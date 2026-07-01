# opencode-anti-bot-block

A [custom tool](https://opencode.ai/docs/custom-tools) for [opencode](https://opencode.ai) that fetches URLs using **browser TLS fingerprint impersonation** via [curl_cffi](https://github.com/lexiforest/curl_cffi).

When a website blocks standard HTTP clients (bot detection, Cloudflare, DataDome, Akamai, etc.), the TLS/JA3 fingerprint of the client is one signal used to identify and block automation. `curl_cffi` impersonates real browser TLS and HTTP/2 fingerprints, so requests look like they come from Chrome, Firefox, or Safari.

This gives opencode's AI a tool called **`WebFetch (anti-bot-block)`** for reaching sites that its built-in `webfetch` tool can't.

---

## Get started

### Prerequisites

- **opencode** installed and working
- **Python 3.10+** on `PATH` (the tool creates an isolated venv; your system Python is untouched)
- **`uv`** (optional, but recommended — faster venv creation). Falls back to `python3 -m venv` + `pip` if absent.
- Network egress to the URLs you want to fetch. HTTP/3 (opt-in) additionally needs UDP egress.

### Install

```sh
git clone https://github.com/BubbatheVTOG/opencode-anti-bot-block.git
cd opencode-anti-bot-block
./install.sh
```

This copies `WebFetch (anti-bot-block).ts`, `tls_fetch.py`, and `requirements.txt` into `~/.config/opencode/tools/` using the `install` command. The tool is auto-loaded by opencode on next startup — no config edits needed.

To update after a `git pull`, just re-run `./install.sh`.

**Project-scoped install** (only available in one repo):

```sh
PREFIX=./.opencode/tools ./install.sh
```

### Verify it loaded

```sh
opencode run --dangerously-skip-permissions "List the tools available to you. Tell me if you see a tool with 'anti-bot' in the name."
```

You should see `WebFetch (anti-bot-block)` listed. The first real call auto-creates the curl_cffi venv (one-time, ~10–60s depending on network).

---

## How it works

1. The AI calls the `WebFetch (anti-bot-block)` tool with a URL and options.
2. The tool definition lazily creates an isolated venv at `~/.local/share/opencode/tls-impersonation/venv` and installs `curl_cffi` (only on first use).
3. It spawns `tls_fetch.py` (bundled Python script) as a subprocess, passing the request as JSON on stdin.
4. The Python script uses `curl_cffi.requests` with the chosen browser fingerprint, and emits a JSON response on stdout.
5. The tool returns the status, headers, and body to the AI. Large bodies are truncated (default 10k chars) to avoid context bloat.

One subprocess per request keeps the design simple. A persistent Python server is a future optimization.

---

## Tool parameters

| Parameter        | Type                                         | Default   | Description                                                        |
| ---------------- | -------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `url`            | string                                       | required  | URL to fetch                                                        |
| `impersonate`    | string                                       | `"chrome"` | Browser preset: `chrome`, `firefox`, `safari`, `safari_ios`, or versioned like `chrome124` |
| `method`         | `get` \| `post` \| `put` \| `delete` \| `patch` | `get`     | HTTP method                                                         |
| `headers`        | Record<string, string>                       | —         | Request headers                                                     |
| `body`           | string                                       | —         | Request body (for post/put/patch)                                   |
| `proxy`          | string                                       | —         | Proxy URL: `http://host:port` or `socks5://host:port`               |
| `http_version`   | `v1` \| `v2` \| `v3`                         | `v2`      | HTTP version. `v3` needs UDP egress.                                |
| `max_length`     | number                                       | `10000`   | Max chars of body returned (avoids context bloat)                   |
| `ja3`            | string                                       | —         | Custom JA3 fingerprint (overrides `impersonate`)                    |
| `ja4r`           | string                                       | —         | Custom JA4 raw fingerprint                                          |
| `timeout`        | number                                       | `30`      | Request timeout in seconds                                          |
| `output_file`    | string                                       | —         | Write full body to this path instead of returning it                |

The tool prompts for permission once per session (per URL), like opencode's `bash` tool.

---

## Fingerprint presets

`curl_cffi` ships 37+ preset fingerprints. To use the latest available version of a browser, pass the bare alias:

- `chrome` — latest Chrome
- `firefox` — latest Firefox
- `safari` — latest Safari (desktop)
- `safari_ios` — latest Safari iOS

To pin a specific version, append the version number, e.g. `chrome124`, `firefox133`.

To see all presets available on your machine (after the venv is created):

```sh
~/.local/share/opencode/tls-impersonation/venv/bin/curl-cffi list
```

To refresh the fingerprint database (new browser versions without upgrading curl_cffi):

```sh
~/.local/share/opencode/tls-impersonation/venv/bin/curl-cffi update
```

For non-browser targets, pass a custom `ja3` and/or `ja4r` string instead of `impersonate`.

---

## Examples

### Basic GET with Chrome fingerprint

```
WebFetch (anti-bot-block)({ url: "https://tls.browserleaks.com/json", impersonate: "chrome" })
```

The `ja3n_hash` in the response should match a real Chrome client — that's the impersonation working.

### POST with body and headers

```
WebFetch (anti-bot-block)({
  url: "https://httpbin.org/post",
  method: "post",
  headers: { "Content-Type": "application/json" },
  body: '{"hello": "world"}',
  impersonate: "firefox"
})
```

### Through a SOCKS5 proxy

```
WebFetch (anti-bot-block)({ url: "https://example.com", proxy: "socks5://localhost:1080" })
```

### HTTP/3 (opt-in, needs UDP egress)

```
WebFetch (anti-bot-block)({ url: "https://fp.impersonate.pro/api/http3", http_version: "v3", impersonate: "chrome" })
```

### Save large response to disk

```
WebFetch (anti-bot-block)({ url: "https://example.com/big.html", output_file: "/tmp/big.html" })
```

The tool returns a note that the body was written to disk, keeping the AI's context lean.

---

## Permissions

The tool uses opencode's permission system. By default it prompts once per session (per URL) via `context.ask()`. To always allow it without prompting, add to your `opencode.json`:

```json
{ "permission": { "WebFetch (anti-bot-block)": "allow" } }
```

To require approval every call:

```json
{ "permission": { "WebFetch (anti-bot-block)": "ask" } }
```

To disable it entirely:

```json
{ "permission": { "WebFetch (anti-bot-block)": "deny" } }
```

See the [permissions docs](https://opencode.ai/docs/permissions) for details.

---

## Testing

To exercise the tool from the CLI (non-interactive), use `opencode run` with `--dangerously-skip-permissions` to auto-approve the permission prompt:

```sh
opencode run --dangerously-skip-permissions "Use the WebFetch (anti-bot-block) tool to fetch https://tls.browserleaks.com/json with the chrome fingerprint and tell me the ja3n_hash value"
```

To test the Python script directly (bypassing opencode):

```sh
echo '{"url":"https://tls.browserleaks.com/json","impersonate":"chrome","method":"get","timeout":30,"max_length":10000}' | \
  ~/.local/share/opencode/tls-impersonation/venv/bin/python ~/.config/opencode/tools/tls_fetch.py
```

---

## Troubleshooting

### Tool subprocess exited non-zero / curl_cffi not installed

The venv auto-creation may have failed (no network, wrong Python version). Create it manually:

```sh
uv venv ~/.local/share/opencode/tls-impersonation/venv
uv pip install --python ~/.local/share/opencode/tls-impersonation/venv/bin/python \
  -r ~/.config/opencode/tools/requirements.txt
```

Or without `uv`:

```sh
python3 -m venv ~/.local/share/opencode/tls-impersonation/venv
~/.local/share/opencode/tls-impersonation/venv/bin/pip install \
  -r ~/.config/opencode/tools/requirements.txt
```

### HTTP/3 requests fail / hang

HTTP/3 uses QUIC over UDP. Many corporate networks and containers block UDP egress. Stick with `http_version: "v2"` (the default) or `"v1"` in those environments.

### Permission denied / tool not found

Make sure `~/.config/opencode/tools/WebFetch (anti-bot-block).ts` exists after running `./install.sh`. opencode loads custom tools from that directory at startup — restart opencode if you installed it while a session was running.

### Fingerprints seem stale

Browser presets ship with curl_cffi. Run `curl-cffi update` (in the venv) to fetch newer fingerprints without upgrading the package. Consider upgrading curl_cffi itself for major new browser versions:

```sh
~/.local/share/opencode/tls-impersonation/venv/bin/pip install --upgrade "curl_cffi>=0.15,<0.16"
```

---

## Files

| File                          | Purpose                                                          |
| ----------------------------- | ---------------------------------------------------------------- |
| `WebFetch (anti-bot-block).ts`| Tool definition (opencode custom tool). Spawns Python, shapes response. |
| `tls_fetch.py`                | Python script. Uses `curl_cffi.requests`, stdin JSON → stdout JSON. |
| `requirements.txt`            | Pins `curl_cffi` version for the venv.                            |
| `install.sh`                  | Copies the above into `~/.config/opencode/tools/` via `install`.  |

---

## License

MIT. See [LICENSE](LICENSE).
