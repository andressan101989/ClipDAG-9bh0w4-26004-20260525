# Nelyon AI Handoff MCP adapter

`ai-handoff-mcp` is a deliberately thin Streamable HTTP MCP adapter. It exposes only `publish_nelyon_handoff`, fixes `project` to `nelyon`, consumes temporary file references declared through `_meta["openai/fileParams"]`, hashes the downloaded bytes, and calls the existing B1 HTTP contract for init, signed PUT, commit, and capability-link creation. It never imports the R2 helper and does not implement storage, manifests, or capabilities.

The remote MCP endpoint is:

```text
https://aewwdlvbwpczqyvkwvvj.supabase.co/functions/v1/ai-handoff-mcp/mcp
```

The function uses the official `@modelcontextprotocol/sdk` 1.30.0 Web Standard Streamable HTTP transport. It requires `Authorization: Bearer ...` on every request and compares the configured `AI_HANDOFF_MCP_TOKEN` in constant time. `AI_HANDOFF_WRITE_TOKEN` and the built-in `SUPABASE_URL` stay server-side. `verify_jwt` is disabled only because this machine-to-machine authentication runs before MCP dispatch.

## File and network policy

- 10 files maximum.
- 10,000,000 bytes maximum per file and 25,000,000 bytes per handoff.
- HTTPS on port 443 only; userinfo and fragments are rejected.
- Literal and DNS-resolved loopback, link-local, private, reserved, and metadata destinations are rejected.
- Redirects are handled manually, revalidated, and limited to three.
- PNG, JPEG, WebP, SVG, PDF, ZIP, JSON, and plain text only; bytes are sniffed and must agree with supplied and response MIME metadata.
- Active SVG, HTML, executable text, arbitrary URLs passed as strings, `sandbox://`, local paths, and base64 transport are rejected.

## Platform gate

The server supports bearer-authenticated MCP clients such as MCP Inspector. It must not be connected to ChatGPT as an unauthenticated app. Current OpenAI Custom Apps accept `noauth` or OAuth 2.1 security schemes and do not accept a custom API key/bearer secret. OAuth is explicitly outside B2, so the ChatGPT connection remains `AUTH_PLATFORM_GATE` / `PLATFORM_BLOCKED` until a separately authorized OAuth phase or a platform capability change.
