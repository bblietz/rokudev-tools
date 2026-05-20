---
name: roku-triage
description: |
  Diagnose a broken Roku channel. Pulls a screenshot, recent log, profiler snapshot, and last backtrace; classifies the likely root cause and writes a triage report. TRIGGER when the user reports a Roku channel that crashed, hung, is stuck on splash, shows an error overlay, or "isn't working". DO NOT TRIGGER for build/lint errors (use roku-bsc-lint), for unit-test failures (use roku-rooibos-test), or for happy-path verification (use roku-smoke-test).
---

# Roku Triage

Structured incident-response for a misbehaving channel.

## Tools used

- `mcp__rokudev-device__screenshot` — what the screen looks like right now
- `mcp__rokudev-device__log_tail` — recent stdout
- `mcp__rokudev-device__profiler_snapshot` — heap, threads, fps
- `mcp__rokudev-device__crashlog_pull` — last crash log
- `mcp__rokudev-device__ecp_active_app` — what is running
- `mcp__rokudev-device__debug_attach` + `mcp__rokudev-device__debug_stack_trace` — backtrace if at debugger prompt

## Procedure

1. Probe device state.
   - `ecp_active_app` — is dev or another app foregrounded?
   - `screenshot` — visual ground truth.
2. Pull recent context.
   - `log_tail` for 8 seconds (catches active output without blocking long).
   - `profiler_snapshot` (auth required).
   - `crashlog_pull` (auth required).
3. If the channel is sitting at a `Brightscript Debugger>` prompt, attach:
   - `debug_attach(host, port=8085)`.
   - `debug_stack_trace()` — equivalent to the legacy `bt` BDP command.
   - Capture and `debug_detach`.
4. Classify the cause using the rules below, in order. Pick the first that matches.

## Classification rules

| Signal | Verdict |
|---|---|
| Log contains `Type Mismatch` | Type error in BrightScript. Locate offending file/line from log. |
| Log contains `Backtrace:` followed by frames | Unhandled runtime exception. Top frame is the most likely culprit. |
| Log contains `Watchdog timer expired` | Main thread block. Check for synchronous network or large loops. |
| Log contains `out of memory` or heap snapshot near limit | Memory pressure. Look at largest object types. |
| Screenshot is solid color, log is empty | Channel never started. Check manifest, splash, or sideload state. |
| `active_app` is `dev` but screenshot shows error overlay | SceneGraph render error. Check XML componentry. |
| `active_app` is not `dev` | Channel exited or was overridden. Re-launch. |
| All signals clean | Probably user error. Suggest re-running with deeper log capture (`log_tail` `seconds=30`). |

## Output

Write `./triage-<unix_timestamp>.md` with:

- Verdict (one line)
- Evidence (each signal that contributed)
- Top frame from backtrace (if any)
- Screenshot path
- Last 50 log lines
- Suggested next action

## Worked example

User: "My channel froze on the home grid."

1. `ecp_active_app` → `dev`.
2. `screenshot` → image saved.
3. `log_tail(seconds=8)` → contains `Watchdog timer expired in Render thread`.
4. Classify: main thread block.
5. Suggest: profile recent changes that touch `m.top.observeField`, replace blocking `roUrlTransfer.GetToString()` with `AsyncGetToString` + observer.
6. Save report.

## Notes

- Do not change device state (no relaunches, no installs) until the report is written.
- If the dev portal endpoints for profiler/crashlog return 404, note it and proceed without them.
- For an interactive debug session use `debug_attach` + `log_tail` with the full port array (`ports=[8080,8085,8087]`) to capture console + debug + profiler streams concurrently.
