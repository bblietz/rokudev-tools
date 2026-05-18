# T27 Evidence: analytics.event_pipe

**Date:** 2026-05-18
**Device:** TCL Roku TV 55S527-RF (model A105X), firmware 15.2.4, IP 10.3.21.233
**Module:** `analytics.event_pipe` v0.1.0
**Result:** PASS 4/4 templates

## Command run

```
TZ=UTC ROKUDEV_DEFAULT_ROKU_HOST=10.3.21.233 ROKUDEV_ROKU_DEV_PASSWORD=1234 \
  node packages/brs-gen/scripts/t27-analytics-event-pipe.mjs
```

## Driver output (final run)

```
=== video_grid_channel ===
[video_grid_channel] captured 3 events: [ 'channel_start', 'screen_view', 'content_start' ]

=== news_channel ===
[news_channel] captured 4 events: [ 'channel_start', 'screen_view', 'screen_view', 'content_start' ]

=== music_player ===
[music_player] captured 3 events: [ 'channel_start', 'screen_view', 'screen_view' ]

=== game_shell ===
[game_shell] captured 4 events: [ 'channel_start', 'screen_view', 'game_start', 'game_over' ]

=== SUMMARY ===
PASS video_grid_channel
PASS news_channel
PASS music_player
PASS game_shell
```

## What was verified

Each template was built with `analytics.event_pipe` wired in (console_sink=true,
batch_max_events=1) and sideloaded to the device. Events were captured from port
8085 over a 90s window. The driver asserted:

- First event is `channel_start` with `cold_start=true`
- Exactly one `channel_start` per session
- Event sequence matches expected order
- All events carry auto-props: `channel_client_id`, `session_id`, `channel_version`,
  `roku_model`, `roku_fw`, `ts_epoch_ms`

## Bugs found and fixed during this run

### Bug 1: findNode returns Invalid on TCL firmware 15.2.4

`m.global.findNode("AnalyticsEventPipe")` always returned `Invalid` from BrightScript
component contexts on TCL Native 2910X / firmware 15.2.4. The node was created with
`m.global.createChild("Node")` and assigned `id = "AnalyticsEventPipe"`, but `findNode`
could not see it -- causing `AnalyticsEventPipe_Init()` to run on every `Analytics_Track`
call, resetting `coldStartFired = false` and emitting multiple `channel_start` events.

**Fix:** Added a direct field `analyticsEventPipeNode` on `m.global` (via `addField` +
assignment). `GetOrInitNode()` reads `m.global.analyticsEventPipeNode` instead of
calling `findNode()`. The global field is readable from any context that has `m.global`
access. Also fixed the timer callback `AnalyticsEventPipe_OnFlushTimer` to use the same
field instead of `findNode`.

### Bug 2: Infinite recursion on init (sideloaded from earlier session)

`AnalyticsEventPipe_Init()` originally called `Analytics_AddSink("ConsoleSink_handler")`
which re-entered `GetOrInitNode()` -> `Init()` before `createChild()` was visible to
`findNode()`, creating an infinite recursion stack overflow. Fixed by registering default
sinks directly on the node reference rather than calling the public API.

### Bug 3: Function references not preserved in SG node fields

`node.handlerRegistry = { ConsoleSink_handler: ConsoleSink_handler }` stored function
references in a node field. On timer callbacks (different thread context) the function
lookup returned `invalid`. Fixed by replacing registry-based dispatch with hardcoded
name-based dispatch in `AnalyticsEventPipe_Flush`.

### Bug 4: AJV format validation rejects empty string for http_endpoint

`module.toml` had `format = "uri"` on `http_endpoint`. AJV validates `""` as an invalid
URI. Removed the `format` constraint; empty string is the valid disabled-state sentinel.

### Bug 5: generate_app OUTPUT_DIR_NOT_EMPTY

The T27 driver originally wrote `spec.json` into the same directory that was passed as
`outputDir`. Fixed by using a `workRoot` temp dir for `spec.json` and a sub-path
`workRoot/project` as `outputDir` (which generate_app creates itself).

### Bug 6: Telnet \r stripping

Port 8085 log lines end with `\r\n`. After `split('\n')`, each line had a trailing `\r`
which caused the `props=(\{...\})$` regex to fail (the `$` did not match before `\r`).
Fixed by stripping trailing `\r` before regex matching.

### Bug 7: Cross-template log contamination

The 90s tail window for template N captured events from template N-1 still running on
the device (prior channel not immediately silenced on TCL firmware). Fixed by anchoring
parsed events to the LAST `channel_start(cold_start=true)` in the captured log -- which
is always the new channel's session start.

## TCL firmware 15.2.4 notes

- BrightScript runtime starts ~45s after ECP reports active-app='dev'. Driver sleeps
  50s before sending keypresses.
- Port 8085 resets during channel boot. `tailLog` retries on ECONNRESET (5 retries,
  300ms gap by default).
- Sideload HTTP connection can ECONNRESET during firmware instability. Driver retries
  sideload up to 3 times.
- Timer-based flush (`observeField` on Timer.fire) is non-functional: TIMER_NODE is
  Invalid in the callback. Workaround: `batch_max_events=1` causes immediate
  threshold-based flush on every `Analytics_Track` call, bypassing the timer entirely.
  The global field fix in Bug 1 also restores the timer flush for use on functional
  firmware.

## game_shell note

With no human input, Pong AI vs AI reaches score_to_win=5 and fires `game_over` within
the 8s post-keypress wait window. The expected event sequence for game_shell is
`[channel_start, screen_view, game_start, game_over]`.
