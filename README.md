# MitchLucky

A focused, Nightbot-style Twitch giveaway tool with a modest first-win luck boost.

## Run

Use Node.js 22 or newer. In this folder:

```powershell
npm.cmd install
npm.cmd start
```

Open http://127.0.0.1:38741 or use Start-MitchLucky.cmd. Keep it running while collecting entries. The server listens only on this computer.

## Use

1. Connect your Twitch channel, or try the separate demo sandbox.
2. Choose Keyword or Active User, set eligibility, and save. First-win luck defaults to +25% weight.
3. Open entries, then close entries and click **Roll It!**. Each viewer gets one entry; repeating the keyword adds no extra luck.
4. MitchLucky saves the winner automatically. Click **New Giveaway** for another draw. There is no import step.

Viewers with no saved wins get 125 tickets by default; viewers with a saved win get 100 tickets. With one of each, the odds are 55.56% and 44.44%. Winning removes the bonus in later giveaways. The boost is adjustable from 0% to 50% and never compounds. Draws use Node's cryptographically secure random generator.

Winner knowledge starts with the giveaways MitchLucky runs. It cannot identify winners from older Nightbot giveaways without an existing record. Any records already saved by an older version are retained. The demo has its own sample history and never changes your real channel history.

Active User mode collects users who chat while entries are open, with a 1–60 minute activity window. Closing entries freezes that window. Subscriber, moderator, and broadcaster eligibility are supported. Blue checkboxes toggle individual eligibility, and Reset Eligibility excludes the pool. Rules stay locked after opening entries; start a new giveaway to change them.

The optional, collapsed winner cooldown excludes winners for a selected period from 15 minutes to 30 days. It is disabled by default. The winner is recorded at draw time, regardless of prize claims.

## Twitch connection

Anonymous IRC access is read-only and may be restricted by Twitch. For authenticated access, provide a Twitch user OAuth token with chat:read; add chat:edit only to send winner announcements. Tokens are validated with Twitch, held in memory, and never saved. Obtain tokens using your own Twitch developer application or the official Twitch CLI. No moderation permissions are needed. The app does not send commands, scheduled messages, or moderation actions.

The connection retries with backoff. Messages missed while disconnected cannot be recovered. Restarting the app closes an open entry pool and preserves collected entrants; reconnect and reopen, or draw from the saved pool. Authenticated live Twitch behavior still needs verification with your user token.

## Automatic history and backups

Winner history is saved separately per channel in data/state.json and survives restarts. Twitch user IDs recognize renamed accounts when available. Back up the data folder; losing it loses winner knowledge. Export History downloads a report. The history screen shows the latest 100 records, and search displays up to 500 matching entrants; every record and entrant still participates in the draw.

Entries save in batches of up to 250ms; explicit giveaway actions save immediately using a temporary file and rename. Do not run multiple processes against the same data directory. DATA_DIR selects another data directory; PORT selects another port. A corrupt saved file stops startup instead of silently losing history.

## Verification

Run npm.cmd test. Tests cover weighted ticket boundaries, duplicate entries, time-based cooldowns, eligibility, and automatic winner tracking across a server restart without imports. The giveaway UI can be checked with the isolated demo.

Independent project; not affiliated with Nightbot or Twitch.
