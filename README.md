# PingRoom room action runner

Let a trusted teammate start a local report by pressing a room quick action.
Account A connects this listener; a different room member, B, presses the button.
The current notification wait API excludes pings sent by the connecting account,
so this is a teammate workflow. It does not listen to your own button presses.

## Try it offline

Requires Node.js 22 or newer. Click **Use this template** on GitHub, or:

```sh
git clone https://github.com/pingroom/starter-room-action-runner.git
cd starter-room-action-runner
npm ci
npm run demo
npm test
```

The demo uses the real SDK with a local mock transport. It reads no credentials,
makes no network requests, and removes its temporary files. It demonstrates a
button press, duplicate delivery, and a restart producing just one report.
Installation needs npm access; the sample report totals four orders at 9,125 cents.

## Connect a shared room

1. [Install PingRoom](https://pingroom.io/i). Account A and trusted teammate B
   must belong to the same standard private room. B needs permission to press its actions.
2. In the app, choose an existing quick-action slot for the report, or configure
   an unused slot with a label such as **Build report** and no required input.
   Note its slot number. This project never changes your room actions.
3. As A, run `npm run connect`, approve the printed link, and grant the robot
   access to that room. Reuse the link while pairing is pending.
4. Have B press the selected action once as a harmless setup ping. Run
   `npm run inspect`: it reads action slots and at most 25 recent notifications,
   then prints metadata for the configured room. If the room is busy, have B
   repeat the setup ping and inspect again.
5. Copy `.env.example` to `.env`. Set `PINGROOM_TRUSTED_SENDER_ID` to that test
   ping's exact `sender_id` and `PINGROOM_ACTION_NUMBER` to its slot. Verify the
   person who sent the test ping; a matching display name alone is insufficient.
   Use the returned sender UUID, not a public User ID from another screen.
6. Run `npm start`. Wait for **Ready**, then have B tap the action again.
   The report appears under `output/report-<notification-hash>.json`.

The first start captures the feed's current head and skips all prior
pings, including the setup ping. Later starts resume the saved cursor. The listener
long-polls while running; keep its process and machine available. It sends no
notifications or approval requests of its own.

Pairing stores the token in ignored `.pingroom/credentials.json` with `0600` file
and `0700` directory permissions on POSIX systems. Keep the directory private on
Windows too. Alternatively, supply both `PINGROOM_TOKEN` and `PINGROOM_ROOM` from
your secret store; a complete pair overrides the local connection and a partial
pair is rejected. Keep the sender and action settings explicit in either mode.

## Execution and recovery

The event must match the configured room, exact human sender UUID, and numeric
action slot. `trigger_source` must be `manual`, `origin_agent` and `question` must
be explicitly `null`, and `is_handoff` must be explicitly `false`. Missing
provenance, agent-originated pings, questions, handoffs, webhooks, location triggers,
and other people or slots do not run work. Older servers omitting those fields
are rejected; do not loosen the check to make an ambiguous event run.

`src/report.js` is the single allowlisted handler. It reads the bundled fixture
and writes a fixed report path derived from the notification ID. Ping text, data,
attachments, and labels never become commands, arguments, paths, or executable code.
Change the handler in source to adapt it; do not add shell evaluation of messages.

Successful event IDs are saved individually before the batch cursor advances.
If a later event fails, the process stops and the previous cursor remains. Restart
after fixing the local error: earlier successful events are skipped. A report
published immediately before a crash is reused on replay, covering the gap before
its receipt was saved. Output creation is atomic and does not overwrite an existing
report. Retain both `.pingroom/` and `output/` across restarts.

Only one process may use a state directory. If a crash leaves
`.pingroom/runner.lock`, inspect its `owner.json` and confirm that process has
stopped before removing the lock directory. A PID can be reused; never remove a
lock merely because it looks old. Graceful SIGINT/SIGTERM cancels polling, keeps
the last committed state, and releases the lock. A five-second shutdown watchdog
may leave a lock when an operation cannot stop.

State is bound to the credential fingerprint, room, sender, and action slot.
To deliberately change those settings or rotate the token, stop the process and
archive `state.json` with its matching output first. A new state file starts at
the current head and skips older events. Do not reset state to work around a
transient error. JSON state and output use atomic local writes; this is not a
database durability or distributed exactly-once guarantee. Receipt storage grows
with accepted actions, and each state update rewrites the entire file. This
starter suits modest local workloads. External side effects need their own
durable idempotency mechanism.

## Troubleshooting and verification

- Nothing happens: use a different trusted teammate from the connecting account,
  wait for **Ready**, then check the room, sender UUID, action slot, and provenance
  shown by `npm run inspect`. That helper prints no token, ping body, or structured data.
- Authentication or room access fails: check the connection and its room grant.
  The listener needs notification read access. It retries transient network,
  timeout, 429, and server errors three times with backoff; persistent errors stop
  it without advancing the cursor. Handler errors are never retried automatically.
- Restart does not recreate a deleted report: its event is already recorded as
  completed. Restore the output from your backup; deleting output is not a replay command.
- Offline tests cover request paths, cursor recovery, duplicate delivery, partial
  failure, cancellation, provenance filters, locking, and private credentials.
  They do not prove live device delivery or your room's permissions.

[SDK documentation](https://github.com/pingroom/sdk) ·
[CLI](https://github.com/pingroom/cli) ·
[Job progress starter](https://github.com/pingroom/starter-job-progress) ·
[Human review starter](https://github.com/pingroom/starter-human-review)

MIT licensed. SDK 0.7.0 is pinned. CI runs credential-free tests and the demo on Node 22 and 24.
