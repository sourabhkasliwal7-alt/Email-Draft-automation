# AI Outreach Engine

Finds leads, researches each company, writes a short personal email, and saves it as a **Gmail draft**.
It never sends anything. You read the drafts in Gmail and send the good ones yourself.

---

## How to use (one page, no technical knowledge needed)

The app has four pages: **Home**, **Leads**, **Drafts**, **Setup**.

### 1. Set up once (Setup page, top to bottom)

1. **Gmail mailboxes**: add the Gmail address the drafts should appear in, press **Connect Gmail**, and allow both permissions on the Google page. If a mailbox says **Reconnect needed**, press Reconnect once (it needs one more permission so the `AI-Outreach` label can be put on each draft).
2. **Offer and case study**: what you sell, in a few plain words (add a real case study only if you have one; the app never invents numbers).
3. **Email footer**: your postal address, the opt-out line and the white-label line. Real drafts are refused until the address and opt-out line are filled in.
4. **Campaign**: who to write to (job titles, industries, countries, company size), where the leads come from (tick any of **CSV file**, **Apollo search** and **Web discovery (Google)**), which offer, which mailbox, and how many drafts a day.
5. *(Optional)* **Apollo account**: only if you want Apollo to find people (also needed to find the person at each company that web discovery finds). The key goes into the `.env` file (see "For the person who installs it"); then press Test connection.
6. *(Optional)* **Google search (Serper)**: needed for web discovery. Add `SERPER_API_KEY`, set `ADAPTER_SEARCH=live`, add a price for `serper / search` in Setup > Advanced, then press Test connection.

Home shows a **Getting started** checklist until all of this is done.

### 2. Add leads (Leads page)

- **Upload CSV**: choose the campaign, choose the file, check the columns, press **Import**. (Tick *Preview only* if you just want to see what would happen; nothing is saved then.)
  Needs a first name, a company website and an email for each person.
- **Find leads with Apollo**: choose a campaign that uses Apollo and press **Find leads now**. It only finds people; it does not write to anyone or use email credits.
- **Find companies on Google** (web discovery): choose a campaign that uses Web discovery and press **Preview companies**. It searches Google (Serper) with the campaign's search queries (typed in the campaign, or built from its target, for example "fintech agency India", "fintech agency hiring react"), keeps only company websites (no directories, job boards, social, news or big platforms; LinkedIn and Crunchbase are never used), skips any website that is already in your leads or on the do-not-contact list, runs the quick check on each new company, and looks up the person to write to with a free Apollo search by company website. A company that fits but has nobody to write to appears in **Drafts > Needs attention** as *No contact found* (no email is ever guessed). Start run does the same automatically for campaigns that use Web discovery; each lead shows its source and the search that found it.

### 3. Start a run (Home page)

- First press **Start test run (no drafts)** (tick *Test run*): it checks and scores your leads without writing drafts or using Apollo credits. Every run is marked **TEST** or **REAL**.
- Then press **Start run**. For each lead it: removes people you must not contact, does a quick check, reads the company's website, keeps only facts it can quote word for word, scores the lead, gets and checks the email address, writes the email and saves the Gmail draft.
- Home shows the progress (Found, Checked, Researched, Approved, Drafted), how many emails were right the first time, and your Apollo credits used today and this month.

### 4. Read the drafts (Drafts page)

- **Drafts**: every draft created, with **Open in Gmail**. Each draft starts with a bracketed `[AI note ...]` line: delete it before sending. Nothing is ever sent for you.
- **Needs attention**: leads the app could not finish, with the reason in plain words. **Retry** puts the lead back at the step that failed (nothing already paid for is repeated). **Skip** removes it.

### Good to know

- Daily limits (drafts per day, Apollo email credits per day and month) are in Setup, and the app stops at them.
- A person on your do-not-contact list is never written to, and Apollo is never asked for the same person's email twice.
- Setup > **Advanced** (closed by default) holds prices, spending limits, writing rules, the list of websites web discovery never uses, the connection tests and the *Skip email verification* switch (testing only: it shows a yellow warning on Home while it is on).
- If something looks stuck, open the run from Home: it lists what happened at every step.

---

## For the person who installs it

### Run locally

```bash
pnpm install
cp .env.example .env        # fill in the keys you have; leave the rest empty (demo mode)
pnpm dev                    # web on http://localhost:3000 and the background worker
```

Restart `pnpm dev` after changing `.env`. Create the first user (sign-up is closed):

```bash
pnpm user:create --email you@company.com --role admin   # prints a one-time password; or set ADMIN_* in .env and run it without flags
```

Keys live only in `.env` (never in the app): `ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY` (choose with `LLM_PROVIDER`), `SERPER_API_KEY`, `ZEROBOUNCE_API_KEY`, `APOLLO_API_KEY`, the Google keys, and `TOKEN_ENCRYPTION_KEY`.
Each outside service has a switch `ADAPTER_<NAME>=mock|live` (default `mock`, which uses made-up data and calls nothing). Set `live` for `LLM`, `SEARCH`, `FETCHER`, `VERIFIER`, `GMAIL` (and `APOLLO`) only after the connection tests in Setup pass. Real research needs all three of `LLM`, `SEARCH`, `FETCHER` live.
Details of the Google and Apollo setup steps are in `BLOCKERS.md`.

### Layout

| Path | Purpose |
| --- | --- |
| `apps/web` | The four pages (Next.js). `/api/health` reports database and worker liveness. |
| `apps/worker` | Background worker: runs, imports, connection tests. |
| `packages/core` | Rules and pure logic (scoring, checks, limits, retry). |
| `packages/db` | Database clients, generated types. |
| `packages/adapters` | Claude / OpenRouter, Serper, page fetcher, ZeroBounce, Apollo, Gmail (live) and the demo versions. |
| `supabase/` | `migrations/` (the record of the schema), `tests/` (SQL suites). |

### Scripts

`pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm e2e` (Playwright; run `pnpm --filter @outreach/web exec playwright install chromium` once) · `pnpm build` · `pnpm format`

### Rules the code keeps (see `CLAUDE.md`, `docs/SRS.docx`)

Drafts only (the one place that could send is switched off and has no screen); do-not-contact and suppression are checked at import, before research, before writing and before any send; every fact in an email is a stored quote from a page with its address and date; every paid call goes through the price table and spend caps; an Apollo email is revealed only for an approved lead, once per person, email only.

### Database tests

`supabase/tests/*.sql` are self-rolling-back suites (each ends with `raise exception 'SUITE_OK'`). With a real `DATABASE_URL`, `pnpm --filter @outreach/db test` runs them.

See `PROGRESS.md` for what is built and what is left ("Later"), and `BLOCKERS.md` for what only you can do (keys, Google Cloud, Apollo plan).
