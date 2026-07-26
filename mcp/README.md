# chainprint-mcp

Apply [Chainprint](https://chainprint.app) mix chains directly inside Ableton Live via the Model Context Protocol (MCP).

Works with Claude Desktop, Cursor, and any MCP client.

## Quick start

### 1. Install the Ableton Remote Script

```bash
uvx chainprint-mcp install
```

Restart Ableton Live, then:

1. **Settings → Link, Tempo & MIDI**
2. Set a **Control Surface** row to **ChainprintMCP**
3. Leave Input / Output as **None**

### 2. Add the MCP server to your AI client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "chainprint": {
      "command": "uvx",
      "args": ["chainprint-mcp"]
    }
  }
}
```

**Cursor** (MCP settings):

```json
{
  "mcpServers": {
    "chainprint": {
      "command": "uvx",
      "args": ["chainprint-mcp"]
    }
  }
}
```

### 3. Mix

1. Analyze a reference on [chainprint.app/analyze](https://chainprint.app/analyze/)
2. Share the chain → copy the link
3. Tell your assistant: *“Load this Chainprint link and apply it to my vocal track”*

## Tools

| Tool | Purpose |
|------|---------|
| `connect_status` | Check Live + Remote Script connection |
| `load_chain` | Fetch a shared chain by URL or UUID |
| `get_session_tracks` | List tracks in the open Live set |
| `get_session_overview` | Tracks, devices, levels, returns |
| `apply_chain` | Load stock devices and dial settings |
| `list_device_parameters` | Inspect a device’s parameters |
| `set_device_parameter` | Set one parameter by name or index |
| `measure_track_levels` | Read output meters |
| `gain_stage` | Trim Utility / track volume to a target |
| `create_return_with_effect` | Build Delay / Reverb returns |

## Requirements

- Ableton Live 11 or 12 (Standard or Suite)
- Python 3.10+ via [`uv`](https://github.com/astral-sh/uv) / `uvx`
- A Chainprint share link (`https://chainprint.app/c/<uuid>`)

## Docs

Full setup + troubleshooting: [chainprint.app/help/ableton-mcp](https://chainprint.app/help/ableton-mcp/)

## License

MIT. Remote Script based on [ahujasid/ableton-mcp](https://github.com/ahujasid/ableton-mcp) (MIT).
