---
name: roku-dev-loop
description: |
  Tight inner-loop dev cycle for a Roku channel: build → package → sideload → tail log → ECP smoke. TRIGGER when the user wants to iterate on a channel, run a quick edit-build-deploy cycle, or asks to "redeploy", "rebuild and run", or "ship to my Roku". DO NOT TRIGGER for production packaging (use `pack_signed` from rokudev-device), for one-off sideload (just call `sideload`), or for triage of a broken channel (use roku-triage).
---

# Roku Dev Loop

Single command to rebuild a channel, push to a device, and surface the first signs of life. Keeps the iteration cycle under 30 seconds for typical changes.

## Tools used

- `mcp__rokudev-device__dev_loop` (preferred — does build → package → sideload → tail in one call)
- Fallback chain when the orchestration tool is not available:
  - `mcp__brs-gen__generate_app` or `mcp__brs-gen__package_app`
  - `mcp__rokudev-device__sideload`
  - `mcp__rokudev-device__log_tail`
- ECP smoke: `mcp__rokudev-device__ecp_keypress` (Home), `mcp__rokudev-device__ecp_launch` (`app_id="dev"`), `mcp__rokudev-device__screenshot`.

## Procedure

1. Resolve project root and detect mode:
   - If `manifest` is at root and no AppSpec is present: project mode. Use `package_app` + `sideload`.
   - If an AppSpec JSON is provided or referenced: spec mode. Use `generate_app` with `zip: true` and `sideload`.
2. Prefer `dev_loop` if available; pass `tail_seconds=10`.
3. After the tail returns, run ECP smoke:
   - `Home` keypress to make state deterministic.
   - Launch dev (`ecp_launch` with `app_id="dev"`).
   - `screenshot`.
4. Scan tail and post-launch logs for crash markers (see `roku-deep-link-test` for the list).
5. Emit a one-screen summary. Bail loudly on any failure stage.

## Summary format

```
Dev loop @ <ip>     duration <s>

Build:    OK (zip=<path>, <bytes> bytes)
Sideload: OK (status=installed, <ms>ms)
Tail:     <N> log lines captured
Smoke:    Home → launch dev → screenshot
          active app: dev (1.0)
          screenshot: <path>
          crash markers: none
```

## Worked example

User edits a button handler and says "ship it".

```
dev_loop(
  kind="project",
  project_dir=".",
  device_ip="10.3.21.233",
  dev_password="1234",
  tail_seconds=10,
)
ecp_keypress(key="Home")
ecp_launch(app_id="dev")
screenshot(device_ip="10.3.21.233", dev_password="1234")
```

## Notes

- Run `roku-bsc-lint` first if the user is making BrightScript changes. A bsc error caught locally saves a sideload round-trip.
- For a regression check across deep links, chain to `roku-deep-link-test` after the loop succeeds.
- Falls back gracefully if the orchestration tool is not registered.
