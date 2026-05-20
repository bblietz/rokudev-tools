---
name: roku-ecp-recipes
description: |
  Send remote-control input and deep-links to a Roku via External Control Protocol. TRIGGER when the user wants to press buttons, type text, navigate menus, launch apps with parameters, or simulate the remote during development. DO NOT TRIGGER for slide decks, generic web work, or non-Roku projects.
---

# Roku ECP Recipes

Send keypresses, key sequences, app launches, and deep-link payloads to a Roku on port 8060. Backed by the `rokudev-device` MCP server.

## Available MCP tools

| Tool | Purpose |
|---|---|
| `mcp__rokudev-device__ecp_keypress` | One key (`press`/`down`/`up`), optionally repeated |
| `mcp__rokudev-device__ecp_keysequence` | Ordered list of keys with delay |
| `mcp__rokudev-device__ecp_launch` | Launch app, optionally with deep-link params |
| `mcp__rokudev-device__ecp_input` | Send `/input?...` to a running channel |
| `mcp__rokudev-device__ecp_active_app` | Verify what is running |
| `mcp__rokudev-device__ecp_media_player` | Inspect player state |

Host falls back to `BRS_DEFAULT_ROKU_HOST` if not provided.

## Standard remote keys

`Home`, `Up`, `Down`, `Left`, `Right`, `Select`, `Back`, `Play`, `Rev`, `Fwd`, `InstantReplay`, `Info`, `Search`, `Enter`, `VolumeUp`, `VolumeDown`, `VolumeMute`, `PowerOff`, `ChannelUp`, `ChannelDown`.

## Typing characters

Use `Lit_<char>` for one literal character. To type the word `roku`:

```
keys = ["Lit_r", "Lit_o", "Lit_k", "Lit_u"]
ecp_keysequence(keys=keys, delay_ms=80)
```

## Recipes

### Open Search and type a query

```
ecp_keypress(key="Search")
ecp_keysequence(keys=["Lit_r","Lit_o","Lit_k","Lit_u"], delay_ms=80)
ecp_keypress(key="Select")
```

### Launch the dev channel with a deep-link payload

```
ecp_launch(app_id="dev", params={
  "contentId": "abc-123",
  "mediaType": "movie",
})
```

### Send a runtime deep-link to the already-running channel

```
ecp_input(params={"action": "play", "id": "abc-123"})
```

### Verify result

```
ecp_active_app()
ecp_media_player()
```

## Worked example: open Netflix, navigate two rows down, select first tile

```
ecp_launch(app_id="12")           # Netflix store ID
ecp_keysequence(keys=["Down","Down","Select"], delay_ms=400)
```

## Notes

- ECP is unauthenticated on port 8060. No password needed.
- `ecp_keysequence` is just a thin loop over `ecp_keypress`. Keep `delay_ms` >= 80 for reliable input.
- For physical-button parity use `mode="press"`; use `down`/`up` only when emulating long-press.
