import { tool } from "@opencode-ai/plugin"
import path from "path"
import os from "os"
import fs from "fs/promises"

const VENV_DIR = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "tls-impersonation",
  "venv",
)

const SCRIPT = path.join(path.dirname(new URL(import.meta.url).pathname), "tls_fetch.py")
const REQUIREMENTS = path.join(path.dirname(SCRIPT), "requirements.txt")

let venvReady: Promise<string> | null = null

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function ensureVenv(): Promise<string> {
  const python = path.join(VENV_DIR, "bin", "python")
  if (await exists(python)) return python

  const uv = await which("uv")
  await fs.mkdir(path.dirname(VENV_DIR), { recursive: true })

  if (uv) {
    await Bun.$`${uv} venv ${VENV_DIR}`.quiet()
    await Bun.$`${uv} pip install --python ${python} -r ${REQUIREMENTS}`.quiet()
  } else {
    const py3 = await which("python3")
    await Bun.$`${py3} -m venv ${VENV_DIR}`.quiet()
    const pip = path.join(VENV_DIR, "bin", "pip")
    await Bun.$`${pip} install -r ${REQUIREMENTS}`.quiet()
  }
  return python
}

async function which(name: string): Promise<string | null> {
  try {
    const p = await Bun.$`which ${name}`.quiet().text()
    return p.trim() || null
  } catch {
    return null
  }
}

export default tool({
  description: [
    "Fetch a URL using a browser TLS fingerprint (JA3/HTTP2) via curl_cffi.",
    "Use this instead of webfetch when a site blocks standard HTTP clients (bot detection, Cloudflare, etc.)",
    "or when you need a specific browser fingerprint. Returns status, headers, and (truncated) body.",
    "",
    "impersonate presets: chrome (default), firefox, safari, safari_ios, or a versioned string like chrome124.",
    "For custom fingerprints pass ja3 and/or ja4r.",
  ].join("\n"),
  args: {
    url: tool.schema.string().describe("URL to fetch"),
    impersonate: tool.schema
      .string()
      .optional()
      .describe('Browser preset: "chrome", "firefox", "safari", "safari_ios", or versioned like "chrome124". Default: "chrome"'),
    method: tool.schema
      .enum(["get", "post", "put", "delete", "patch"])
      .optional()
      .describe("HTTP method. Default: get"),
    headers: tool.schema
      .record(tool.schema.string(), tool.schema.string())
      .optional()
      .describe("Request headers"),
    body: tool.schema
      .string()
      .optional()
      .describe("Request body (for post/put/patch)"),
    proxy: tool.schema
      .string()
      .optional()
      .describe("Proxy URL: http://host:port or socks5://host:port"),
    http_version: tool.schema
      .enum(["v1", "v2", "v3"])
      .optional()
      .describe('HTTP version. Default: "v2". v3 needs UDP egress.'),
    max_length: tool.schema
      .number()
      .optional()
      .describe("Max chars of body to return (full body saved to disk if truncated). Default: 10000"),
    ja3: tool.schema
      .string()
      .optional()
      .describe("Custom JA3 fingerprint string (overrides impersonate)"),
    ja4r: tool.schema
      .string()
      .optional()
      .describe("Custom JA4 raw fingerprint string"),
    timeout: tool.schema
      .number()
      .optional()
      .describe("Request timeout in seconds. Default: 30"),
    output_file: tool.schema
      .string()
      .optional()
      .describe("Write full response body to this path instead of returning it"),
  },
  async execute(args, context) {
    await context.ask({
      permission: "tls_fetch",
      patterns: [args.url],
      always: [args.url],
      metadata: {},
    })

    if (!venvReady) venvReady = ensureVenv().catch((e) => { venvReady = null; throw e })
    const python = await venvReady

    const wantFile = !!args.output_file
    const payload = {
      url: args.url,
      impersonate: args.impersonate ?? "chrome",
      method: args.method ?? "get",
      headers: args.headers,
      body: args.body,
      proxy: args.proxy,
      http_version: args.http_version,
      // When writing to a file, request the full body (max_length=0 = unlimited)
      max_length: wantFile ? 0 : (args.max_length ?? 10000),
      ja3: args.ja3,
      ja4r: args.ja4r,
      timeout: args.timeout ?? 30,
    }

    const input = JSON.stringify(payload)

    const proc = Bun.spawn({
      cmd: [python, SCRIPT],
      stdin: new Blob([input]),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    if (exitCode !== 0) {
      throw new Error(`tls_fetch subprocess exited ${exitCode}:\n${stderr || stdout}`)
    }

    const result = stdout
    let parsed: any
    try {
      parsed = JSON.parse(result)
    } catch {
      throw new Error(`tls_fetch returned non-JSON output:\n${result}`)
    }

    if (!parsed.ok) {
      throw new Error(`tls_fetch error (${parsed.error_type}): ${parsed.error}`)
    }

    let bodyNote = ""
    if (wantFile && args.output_file) {
      await Bun.write(args.output_file, parsed.body)
      bodyNote = `[full body (${parsed.body_len} bytes) written to ${args.output_file}]`
    } else if (parsed.body_truncated) {
      bodyNote = `[truncated: showing ${parsed.body.length}/${parsed.body_len} chars]`
    }

    const summary = [
      `Status: ${parsed.status}  |  Fingerprint: ${parsed.fingerprint}  |  ${parsed.elapsed_ms}ms`,
      "",
      "Headers:",
      ...Object.entries(parsed.headers).map(([k, v]) => `  ${k}: ${v}`),
      "",
      bodyNote ? `Body ${bodyNote}:` : `Body (${parsed.body_len} chars):`,
      parsed.body,
    ].join("\n")

    return summary
  },
})
