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
2. Choose Keyword (default yo, case-insensitive) or Active User, set eligibility, and save. Never-winners earn +5% weight per giveaway entered, capped at +25% by default.
3. Open entries, adjust luck whenever you want, and click **Roll It!** directly. Rolling stops entries and selects the winner in one action; closing first is optional. Each viewer gets one entry; repeating the keyword adds no extra luck.
4. MitchLucky saves the winner automatically. Click **New Giveaway** for another draw. There is no import step.

Viewers with no saved wins earn +5% draw weight for each distinct giveaway they enter: 105 tickets on their first entry, 110 on their second, up to the default cap of 125. Viewers with a saved win always get 100 tickets. The slider sets the maximum bonus (0–50%), not a win probability. Bonuses add rather than compound. Repeating the keyword, changing the cap, pausing/reopening entries, and giveaways they do not enter add nothing. Starting a new giveaway clears the pool; viewers must enter again to earn the next increase. Winning removes the bonus permanently in future giveaways. Actual probability is the viewer's weight divided by the sum of all eligible weights, so the odds remain small with thousands of entrants. Draws use Node's cryptographically secure random generator.

Participation tracking starts with this version; a saved existing entry pool counts once, and older participation is not guessed. Winner knowledge starts with the giveaways MitchLucky runs. It cannot identify winners from older Nightbot giveaways without an existing record. Any records already saved by an older version are retained. The demo has its own sample history and never changes your real channel history.

Active User mode collects users who chat while entries are open, with a 1–60 minute activity window. Closing entries freezes that window. Subscriber, moderator, and broadcaster eligibility are supported. Blue checkboxes toggle individual eligibility, and Reset Eligibility excludes the pool. The luck slider stays adjustable while entries are open or paused. Chances preview as you drag, and the setting saves automatically on release. Roll It! includes the displayed boost in its request so an immediate roll uses that exact value. Other entry rules stay locked after opening; start a new giveaway to change those. A completed draw cannot be rolled again.

The optional, collapsed winner cooldown excludes winners for a selected period from 15 minutes to 30 days. It is disabled by default. The winner is recorded at draw time, regardless of prize claims.

## Twitch connection

Anonymous IRC access is read-only and may be restricted by Twitch. Choose Read Chat Only, or Read + Write Chat in the connection dialog. For authenticated access, provide a Twitch user OAuth token with chat:read; Read + Write Chat also requires chat:edit. Tokens with writing permission stay read-only unless Read + Write Chat is selected. Tokens are validated with Twitch, held in memory, and never saved. Obtain tokens using your own Twitch developer application or the official Twitch CLI. No moderation permissions are needed. With Read + Write Chat enabled, the bot answers viewers who type !luck with their participation count, bonus, and current odds. Replies use the same send rate limit as other chat messages. It does not send scheduled messages or moderation actions.

The connection retries with backoff. Messages missed while disconnected cannot be recovered. Restarting the app closes an open entry pool and preserves collected entrants; reconnect and reopen, or draw from the saved pool. Authenticated live Twitch behavior still needs verification with your user token.

## Chat and winner timer

Read Chat shows incoming channel messages. Write Chat lets you send an editable message; after a draw it defaults to "Congratulations @winner! You won." The Winner Message button fills that template, and Send Congratulations posts it directly. Luck Rules prepares a viewer-facing explanation of the current cap; review it and press Send to post. Viewer rows show the number of giveaways entered and why they have a bonus. The !luck command checks a viewer's bonus without entering them or increasing luck. Reserve !luck for that command rather than using it as the entry keyword. Sending requires an authenticated Read + Write Chat connection. Demo messages stay local and never reach Twitch.

Selecting a winner starts a count-up timer based on the saved selection timestamp. It continues across reloads and restarts and does not reset when anyone speaks. A new giveaway clears it; the next winner starts a new timer. There is no automatic timeout or reroll.

## Automatic history and backups

Participation counts and winner history are saved separately per channel in data/state.json and survives restarts. Twitch user IDs recognize renamed accounts when available. Back up the data folder; losing it loses participation counts and winner knowledge. Export History downloads a report. The history screen shows the latest 100 records, and search displays up to 500 matching entrants; every record and entrant still participates in the draw.

Entries save in batches of up to 250ms; explicit giveaway actions save immediately using a temporary file and rename. Do not run multiple processes against the same data directory. DATA_DIR selects another data directory; PORT selects another port. A corrupt saved file stops startup instead of silently losing history.

## Verification

Run npm.cmd test. Tests cover weighted ticket boundaries, duplicate entries, time-based cooldowns, eligibility, and automatic winner tracking across a server restart without imports. The giveaway UI can be checked with the isolated demo.

Independent project; not affiliated with Nightbot or Twitch.
