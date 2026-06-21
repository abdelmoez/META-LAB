# Marketing screenshots

Repeatable capture of the unified **Review Project** workflow for marketing/landing assets.

## One-time setup
```bash
npm install                         # ensures playwright is present
npx playwright install chromium     # browser engine (or system Chrome is used as fallback)
# server/.env must have DATABASE_URL + JWT_SECRET (see the app's env docs)
```

## Generate screenshots
```bash
npm run dev                 # terminal A — starts the app (client :3000, server :3001)
npm run marketing:seed      # terminal B — additive demo data (GLP-1 demo review project)
npm run marketing:screenshots   # captures into marketing/screenshots/<YYYY-MM-DD>/
npm run marketing:curate        # optional: AI picks the best shots (needs ANTHROPIC_API_KEY)
```

Output: `01-dashboard.png … 18-ops-console.png` at **1440×1000 @2x**, plus a few
`hero-*.png` at **1600×1000**.

**Navigation:** the capture opens the demo project **once** and then clicks the
workflow menu to switch tabs (in-app/SPA navigation, no reload). A cold deep-link
(`/app/project/:id?tab=…`) hits a load race and bounces to the project list, which
is why an earlier version captured the dashboard for every shot — fixed.

**Marketing curator (the AI selection agent).** `npm run marketing:curate` sends the
captured shots to Claude (vision) with a marketing rubric. It **chooses** the best
ones — scoring each, writing captions + alt text, and flagging empty/blurry/clipped
or PII-bearing shots for retake — and writes `manifest.json` + `SELECTION.md` next to
the screenshots. Needs `ANTHROPIC_API_KEY`; without it the step no-ops with a note.

## Demo login (fake, safe)
- **Email:** `demo.curator@pecanrev.example` · **Password:** `PecanRevDemo2026!`
- A second fake reviewer (`demo.reviewer@pecanrev.example`) exists so screening
  decisions/conflicts look realistic. All emails use the reserved `.example` domain.

## Remove the demo data later
```bash
npm run marketing:seed:remove
```
This deletes only the demo project + its linked screening workspace (demo-owned, by
exact title). It does **not** reset the database or touch real users/projects. The two
demo users and the `searchEngine` feature flag are left in place (delete the users
manually if desired).

## Privacy
- No real patient data, user emails, secrets, tokens, IPs, or password hashes are
  introduced by the seed — only fake `.example` demo content.
- **Ops Console:** the script captures the **Overview** (metrics/charts/map). Do **not**
  publish the Ops **Users** tab without redacting real emails — it lists real accounts.

PNG outputs are git-ignored (regenerate them on demand); the folder structure + this
README are tracked.
