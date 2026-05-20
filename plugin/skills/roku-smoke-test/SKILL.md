---
name: roku-smoke-test
description: |
  Run a fast post-deploy smoke test on a Roku channel: launch it, navigate one row, take a screenshot, and assert no error overlay. TRIGGER when the user wants to verify a sideload didn't break the basics, run a CI gate, or sanity-check the channel after a change. DO NOT TRIGGER for unit tests (use roku-rooibos-test), for diagnosing failures (use roku-triage), or for deep-link payload tests (use roku-deep-link-test).
---

# Roku Smoke Test

Bare-minimum check that a freshly deployed channel can launch, render, and accept input.

## Tools used

- `mcp__rokudev-device__ecp_keypress` — Home, then directional input
- `mcp__rokudev-device__ecp_launch` (`app_id="dev"`)
- `mcp__rokudev-device__ecp_active_app`
- `mcp__rokudev-device__screenshot`
- `mcp__rokudev-device__log_tail` — short window for error scan

## Procedure

1. Pre: `ecp_keypress(key="Home")` to reach a known state.
2. `ecp_launch(app_id="dev")`.
3. Wait 2 seconds (channel splash).
4. Start `log_tail(seconds=6)` in background.
5. Press `Down`, `Down`, `Right` with 400 ms between to verify focus moves.
6. `ecp_active_app`. Must still be `dev`.
7. `screenshot`.
8. Wait for tail to finish.
9. Scan log for crash markers (`Type Mismatch`, `Backtrace:`, `Watchdog`, `out of memory`, `Crash`).
10. Verdict:
    - `dev` is foregrounded AND no crash markers: **PASS**.
    - Otherwise **FAIL** and hand off context to `roku-triage`.

## Output

```
Smoke @ <ip>     duration <s>

Launch: OK
Active app after launch: dev (1.0)
Navigation: 3 keypresses sent
Screenshot: <path>
Crash markers: none
Verdict: PASS
```

## Worked example

After `roku-dev-loop` completes a sideload, run smoke automatically:

```
ecp_keypress(key="Home")
ecp_launch(app_id="dev")
sleep 2
log = log_tail(seconds=6)              # background
ecp_keysequence(keys=["Down","Down","Right"], delay_ms=400)
active = ecp_active_app()
shot = screenshot()
# evaluate
```

## Notes

- This skill never modifies channel data. Safe to run in CI.
- If the device is already showing an error overlay before launch, the verdict is FAIL with cause `pre-existing error state`. Hand off to `roku-triage`.
- For deeper functional verification, chain to `roku-deep-link-test` with one or two known content IDs.
