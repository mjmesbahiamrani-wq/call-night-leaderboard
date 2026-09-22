# Call night leaderboard

A live leaderboard for a calling team: a gala podium on the projector during
call night, the same board on everyone's phone, ranking callers on the numbers
they already log in the daily report. Conversions, calls, minutes and
conversion rate; a weekly goal bar; a weekly prize band; a "caller mode" that
goes full screen and rotates on its own; FR / EN toggle.

It reads **one Google Sheet** and nothing else. No database, no Google API,
no account to create besides Vercel. Every setting is a form field.

## Put it online (10 minutes)

**1. Share your sheet by link.** In Google Sheets: *Share → General access →
Anyone with the link → Viewer*. Copy the link from the address bar.
Anyone with that link can read that sheet, so keep client names and phone
numbers out of it. The board only needs caller names and daily counts.

**2. Pick a password** for the board's link. Long and boring is best: 20+
letters and numbers, no spaces. Whoever has it can open the board.

**3. Click the button.**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fmjmesbahiamrani-wq%2Fcall-night-leaderboard&project-name=call-night-leaderboard&repository-name=call-night-leaderboard&env=SHEET_URL,TEAM_KEY,TEAMS&envDescription=Your%20shared%20Google%20Sheet%20link%2C%20the%20password%20for%20the%20board%20link%2C%20and%20your%20team%20names%20left%20to%20right%20across%20the%20sheet.&envLink=https%3A%2F%2Fgithub.com%2Fmjmesbahiamrani-wq%2Fcall-night-leaderboard%23settings)

Vercel asks you to log in (a free account, "Continue with GitHub" is the
easiest), copies this code into your own account, and shows a form with three
fields:

| Field | What to paste |
|---|---|
| `SHEET_URL` | the sheet link from step 1 |
| `TEAM_KEY` | the password from step 2 |
| `TEAMS` | your team blocks, left to right across the sheet, separated by commas. Example: `Team A,Team B,Team C` |

Click **Deploy**. About a minute later Vercel shows your site address,
something like `call-night-leaderboard.vercel.app`.

**4. Your board is at:**

```
https://<your-site>.vercel.app/#k=<your TEAM_KEY>
```

Everything after the `#` is the password. Send that whole link to the team.
Bookmark it. That's it.

## Call night

- **📺 Caller mode** goes full screen and rotates conversions → calls → rate
  every 20 seconds, all night, on its own. Share that screen on Zoom.
- **FR / EN** switches the whole page.
- The title screen shows the countdown to the start (set `NIGHT_START`),
  the prize, and last night's winner. Click anywhere to enter.
- The board rereads the sheet every 5 minutes. When new conversions land, it
  shows a "scores are in" card, then the ranking slides into its new order.
- Below the board: the team duel, the records to beat, and a full calling
  report with a CSV export.

## Settings

Everything lives in Vercel: your project → **Settings → Environment
Variables**. After changing one: **Deployments → ⋯ on the latest → Redeploy**.

| Variable | What it does | Default |
|---|---|---|
| `SHEET_URL` | the shared sheet (link or ID; a `gid=` in the link picks a tab) | required |
| `TEAM_KEY` | the password in the board's link, 8+ characters (use 20+) | required |
| `TEAMS` | team block names, left to right, comma-separated | `Team 1,Team 2,Team 3` |
| `GOAL_WEEK` | weekly conversions goal; shows the progress bar | none |
| `PRIZE_AMOUNT` | weekly prize for #1 in conversions; the band appears only with an amount | none |
| `PRIZE_LABEL` | `giftcard` (translated) or any text, e.g. `Amazon gift card` | none |
| `CURRENCY` | for the prize | `CAD` |
| `TIMEZONE` | the team's time zone; "today" is computed there | `America/Toronto` |
| `CALL_NIGHTS` | which evenings you call; the race week starts on the first one | `sat,sun,mon,tue` |
| `NIGHT_START` | 24h time, e.g. `18:00`; shows a countdown on the title screen | none |
| `KICKER` | the small line above the title, e.g. `QC pipelines · 2027 recruiting` | `Call night` |
| `SUBTITLE` | the line under the title on the title screen | the team names |

**Changing the password:** edit `TEAM_KEY`, redeploy, send the new link. The
old one stops working the moment the redeploy finishes.

### If your sheet is shaped differently

The defaults match the standard daily caller report: team blocks 100 columns
wide (starting at columns A, CW, GS), inside a block one column of dates then
12 people × 8 columns each (calls, minutes, avg, conversions, rate, no-shows,
no-show rate, time), the caller's name on the row *above* the header row,
dates stored as dates. If yours differs, these settings describe it:
`BLOCK_WIDTH`, `COLS_PER_PERSON`, `PEOPLE_PER_BLOCK`, `HEADER_DATE`,
`HEADER_CALLS`, `COL_CALLS`, `COL_MINUTES`, `COL_CONVERSIONS`, `COL_NOSHOWS`,
`COL_TIME`. See `env.example.txt` for what each one means, or paste the prompt
below into Claude and let it measure your sheet.

### Faster refresh (optional)

If the sheet is fed by `IMPORTRANGE`, Google refreshes it every ~30 minutes.
`scripts/fast-copy.gs` is a small Google Apps Script that copies the sources
into a hidden tab every minute; the board then reads that tab and falls back
to the original automatically if the script ever stops. Instructions are at
the top of the file.

## When something looks wrong

- **"Lien invalide ou expiré" / "Link refused"** — the part after `#k=` does
  not match `TEAM_KEY`. Check the link, or the variable.
- **"The sheet is no longer shared by link"** — someone changed the sharing.
  Set it back to *Anyone with the link → Viewer*. (Google answers a de-shared
  sheet with a login page and a success code; the board checks for it on
  purpose, otherwise it would just look empty.)
- **Page fine, board empty, sheet full of numbers** — the layout settings
  don't match the sheet. See "If your sheet is shaped differently".
- **Everyone shows zeros** — the columns are off. Same fix.
- **People show as "Caller 3"** — nobody typed the names in the sheet. Fill
  them in; they appear at the next refresh. Unnamed callers are kept on
  purpose: dropping them made a whole team disappear once.
- **Nothing moves during the night** — the board rereads every 5 minutes, but
  an `IMPORTRANGE` sheet refreshes every ~30. See "Faster refresh".
- **The rate ranking looks half empty** — under 15 calls nobody is ranked on
  rate. One conversion on one call is 100 %, and it would win every night.

## The rules baked in (please don't "fix" these)

- Fifteen calls minimum before anyone is ranked on conversion rate.
- The board stops at ten. A list that runs to the last person turns a race
  into a performance review.
- If tonight is quiet (under ~25 calls so far), the page opens on the last
  full day instead of an empty board.
- "Today" is the team's date, never the viewer's.
- Celebrations fire only when something changed between two reads.
- The race week starts on the first call night and resets by itself.
- A wrong key gets a 404, not a "wrong password". Every response is
  `no-store`, so no shared cache ever hands the board to someone without a key.

## Run it on your own computer (optional)

Needs Node 20+. Copy `env.example.txt` to a file named `.env`, fill it in, then:

```
npm run local
```

and open `http://localhost:3789/#k=<your TEAM_KEY>`.

## If you'd rather have Claude do it

Paste this into Claude (Claude Code, or the app with the sheet link):

> I want to put a call-night leaderboard online from
> https://github.com/mjmesbahiamrani-wq/call-night-leaderboard . I'm not
> technical. Read its README, then walk me through it one step at a time:
> sharing my sheet, choosing a password, the "Deploy with Vercel" button and
> its three fields, and the final link to send my team. My sheet link is:
> <PASTE>. My teams, left to right, are: <NAMES>. Before I deploy, fetch my
> sheet's CSV export and tell me whether it matches the default layout in the
> README; if not, tell me which layout settings to add. Don't redesign
> anything and don't remove the rules listed at the bottom of the README.

## What's in here

- `api/callers.js` — reads the sheet, parses it, checks the key. All settings come from environment variables.
- `public/callers.html` — the page and its styling. Team colours are `--t1`, `--t2`, `--t3`.
- `public/callers.js` — the board: periods, ranking, animation, caller mode, celebrations.
- `scripts/local.mjs` — local preview. `scripts/fast-copy.gs` — the optional faster refresh.
- `env.example.txt` — every setting, explained.
