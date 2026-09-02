# MCP servers in the chat

The chat offers the model the harness's own eight tools, this repository's verbs, and the tools of every MCP server you have configured. Nothing here is configured for `lm`: it reads the files the agents you already run read, so a server that works in one of them works here.

## Where a server is declared

Three files, in the order that decides which declaration wins when two name the same server:

| File | Scope |
|---|---|
| `.mcp.json` in the directory you ran `lm` from | the repository's own |
| `~/.claude.json` | yours, in every repository |
| `~/.gemini/settings.json` | the same, behind the one above |

The project's file comes first so a repository can name a server of its own and shadow one of yours under the same name. Between the two of yours, `~/.claude.json` wins.

All three key the object the same way, and an entry may be spelled either way:

```json
{
  "mcpServers": {
    "context7": { "type": "http", "url": "https://mcp.context7.com/mcp", "headers": { "CONTEXT7_API_KEY": "…" } },
    "atlassian": { "httpUrl": "https://mcp.atlassian.com/v1/mcp" }
  }
}
```

`headers` is sent on every request to that server, which is where an API key goes. The file is read at launch and nothing is copied out of it.

Only HTTP servers are reached. A server declared as a subprocess — `"type": "stdio"` with a `command` — is named on the startup line and not started; so is one whose URL is neither `http:` nor `https:`.

## What the launch says

One line, beside the skills line, on every launch:

```
mcp: 1 server, 2 tools
```

The counts are the servers that answered and the tools they offered, and both are printed at zero, because a machine with no servers configured and a server whose tools went missing read alike when the zero is left out. A server that could not be asked is named after them, with what it did:

```
mcp: 1 server, 2 tools; atlassian: answered 401
mcp: 0 servers, 0 tools; dead: ECONNREFUSED; slow: did not answer in time
```

The chat opens either way. Every server is asked at once and the launch waits 3 seconds for all of them, so one server that is down costs the launch that wait and nothing else. `initialize` and `tools/list` against `https://mcp.context7.com/mcp` measured 745 ms on a cold connection and 225 ms warm, over five runs on 2026-09-02; re-run it by timing those two requests against your own server.

Setting `PI_OFFLINE` asks no server anything, and each is reported `offline`.

## What the model sees

A server's tool is offered as `mcp__<server>__<tool>`, under the description the server published — `resolve-library-id` on a server named `context7` becomes `mcp__context7__resolve-library-id`. That is the same scheme Claude Code uses, and it is what keeps a server's tool out of the space the harness's eight built-in tools and this repository's verbs are named in: a server offering `bash` gets `mcp__<server>__bash` and the harness keeps `bash`.

Two servers may therefore offer a tool of the same name without either losing it. A name that is genuinely already taken — a verb whose tool file is named for a server's tool — is refused rather than replaced, because the harness keys its tools by name and would otherwise let the second registration silently replace the first. The refusal is named on the startup line:

```
mcp: 1 server, 1 tool; context7: mcp__context7__query-docs is taken
```

The arguments a tool takes are the server's own `inputSchema`, unaltered. What comes back is the text of the result's content blocks; a result the server marks as an error says so in front of the text, and a server that could not be reached during a call says that instead of failing the turn.

## What is not here

Only tools. A server's resources and prompts are not read, a subprocess server is not started, and there is no OAuth flow: a server that needs a token needs it in `headers`. Every tool a server offers is available to the model as soon as the session opens, with no per-call approval.

## The protocol

Streamable HTTP, as specified for protocol version `2025-06-18`. Each message is one HTTP POST carrying `Accept: application/json, text/event-stream`, because the server chooses which of the two shapes to reply in and both have to be read. The launch sends `initialize`, then the `notifications/initialized` notice, then `tools/list`. Whatever version the server answers `initialize` with is the version every later request carries in `MCP-Protocol-Version`, and a session id handed back on that first reply is carried in `Mcp-Session-Id` on everything after it. A server that hands back none is stateless and is not given one.
