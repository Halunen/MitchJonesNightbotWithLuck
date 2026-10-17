# Nightbot Luck

A local Nightbot-style Twitch control panel with custom commands, timers, regulars, spam filters, bot logs, and keyword or active-user giveaways that modestly favor first-time winners. It is an independent implementation, not a full feature-for-feature copy of Nightbot: song requests, account managers, stream metadata commands, subscriber/regular luck multipliers, and number-guess giveaways are not implemented.

## Run on Windows

Install Node.js 22 or newer, then open PowerShell in this folder:

```powershell
npm.cmd install
npm.cmd start
```

Open http://127.0.0.1:38741 and keep the server running during your giveaway. `Start-Luckybot.cmd` also starts it. The app only listens on this computer. For a different port: `$env:PORT = '38742'` before starting and open that port instead.

## First giveaway

1. Click **Try a demo** to practice with a separate sandbox, or **Connect Twitch** and enter your channel name.
2. Before opening entries, use **Import past winners** to paste Twitch usernames from your previous giveaways. Twitch and Nightbot history are not automatically imported. Without this, everyone initially counts as a first-time winner.
3. Set the giveaway name and keyword (default `!luck`). Save rules, then **Open entries**. Viewers enter by sending exactly the keyword in chat, ignoring capitalization and surrounding spaces.
4. **Close entries**, review the pool and odds, then **Draw a winner**. Use **Copy winner announcement** to paste the result into Twitch chat, or **Announce in Twitch chat** when connected with `chat:edit`. Giveaway announcements are manual; configured commands and timers can reply automatically.
5. Click **New giveaway** for another round. Winner history is retained.

Anonymous read-only Twitch IRC is the default. It is not an officially guaranteed authentication mode. If Twitch restricts it, expand the authenticated connection section and supply a Twitch user OAuth token with `chat:read`. Obtain a token through your own registered Twitch application or the official Twitch CLI (`twitch token --user-token --scopes "chat:read"`). Tokens are validated with Twitch, held in memory only, and cleared on disconnect or restart. Never paste tokens into chat or commit them. See https://dev.twitch.tv/docs/cli/token-command/ and https://dev.twitch.tv/docs/chat/irc/.

The dashboard displays the connection status and reconnects with backoff. It cannot recover chat messages missed while disconnected or shut down. Restarting the app closes an open entry pool and retains the collected entrants; reconnect and reopen or draw. Anonymous connections are read-only; authenticated connections can reply when granted `chat:edit`.

## Commands, timers, regulars, and spam filters

Connect with a user OAuth token carrying `chat:read chat:edit` for chat replies. Tokens are not saved. Commands support Everyone, Subscriber, Regular, Moderator, and Owner permissions; cooldowns; enable/disable; editing; deletion; and these variables: `$(user)`, `$(channel)`, `$(query)`, `$(touser)`, `$(count)`. The built-in `!commands` lists enabled commands. Other Nightbot variables, aliases, and chat-based command management are not implemented.

Timers support an interval in minutes and a minimum number of chat lines in the preceding five minutes. The timer waits a full interval after connection or enabling. Messages share a conservative outgoing rate limit. Replies may be skipped during bursts; timers retry later.

Regulars are stored per channel. Spam filters cover explicit web links, excessive capitals, repeated characters, and blocked phrases. Filters are off by default, exempt the broadcaster and moderators, and optionally exempt regulars. To delete filtered messages, give the token `moderator:manage:chat_messages` and make the authenticated account a channel moderator. Without these, detections are logged and prevented from entering the giveaway, but remain in Twitch chat. Filters do not ban or time out viewers. Logs retain the latest 200 bot events; the live chat panel retains 40 messages in memory. These are basic filters, not a complete Nightbot or Twitch AutoMod implementation.

## Fairness rules

- Each unique Twitch account gets one entry. Chat spam adds no extra weight. Twitch user IDs are used to recognize renamed accounts when a previous draw recorded their ID; imported names have no ID and cannot recognize future renames.
- A viewer with **zero recorded wins** has **125 tickets** by default; a prior winner has **100 tickets**. The boost is adjustable from 0% to 50% and does not accumulate with losses.
- If one first-timer and one previous winner enter, their chances are **55.56% vs. 44.44%**. The boost adds weight, not percentage points. Repeat winners remain possible.
- After winning, the viewer gets normal weight in future rounds. History is scoped to the Twitch channel.
- Optional winner cooldown excludes anyone who won within the selected time frame: 15 or 30 minutes, 1 or 6 hours, 24 hours, or 3, 7, or 30 days. Default is disabled. Eligibility returns when that time passes, regardless of how many other draws occur. Imported names affect first-win luck but are excluded from time cooldowns because their actual winning times are unknown. An existing enabled draw-count cooldown migrates to 24 hours; an existing disabled cooldown stays disabled. Winner history is preserved.
- Rules are locked once entries open, including while the round is closed. Each draw uses Node’s cryptographically secure `crypto.randomInt`. A completed round cannot draw again.
- **Active User** mode enters viewers who chat while entries are open and excludes those inactive for the selected 1–60 minute window. Activity tracking begins when the bot connects; it cannot see earlier chat. Closing entries freezes the activity window for that draw. Keyword mode has no activity expiry. Eligibility can require a subscriber, regular, moderator, or broadcaster; moderators and the broadcaster bypass lower user-level requirements. Subscriber eligibility does not include regulars unless they are also subscribed.
- Viewer checkboxes toggle eligibility without letting repeated keyword messages bypass an exclusion. Reset Eligibility excludes the whole pool; checkboxes can include viewers again, subject to cooldown and activity rules.
- The winner counts as having won immediately on drawing. There is no prize-claim or automatic reroll workflow. No paid/subscriber odds advantages are included.

## Saved data and backups

Channel winner histories and current round live in `data/state.json`. Writes use a temporary file and rename. Back up the `data` directory; losing it loses the app’s knowledge of past winners. Never run two server processes against the same data directory. Use `DATA_DIR` for isolated instances. The app refuses to start if saved JSON is corrupt rather than silently forgetting winners.

**Export history** downloads a JSON report for backups and audit. To bulk import past winners, use usernames only (not the exported JSON). The dashboard shows the latest 100 history records and up to 500 matching entrants; every saved record and entrant still participates in the calculations.

## Verification

```powershell
npm.cmd test
```

Tests cover weighted boundaries, deduplication, eligibility, cooldowns, history-based identity, and chat parsing. An actual channel connection and live chat collection require Twitch access and should be tested with your channel before a real prize giveaway.

Development verification: 14 tests pass, including an HTTP API lifecycle and saved data checks; the demo draw and command editor were checked in the browser at mobile and desktop widths. The anonymous live Twitch handshake was closed by the remote endpoint before joining; authenticated live chat, sending, and moderation could not be verified without a user token. Entrant updates are batched for up to 250ms before saving; abrupt power loss can lose those most recent updates. Explicit giveaway actions save immediately.

Independent project; not affiliated with Nightbot or Twitch.
