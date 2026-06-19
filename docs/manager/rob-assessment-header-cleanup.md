# RoB Assessment Header Cleanup — prompt41 Task 3

## Before
The per-study assessment header was spread over two rows: a top bar with **Back to
Risk of Bias** + the **"RoB 2 · effect of assignment"** badge, and a separate
`ArticleHeaderBar` card below it showing the study title plus clutter — authors,
journal/year, a **DOI:** link, a **PMID:** link, source-DB / duplicate / decision
badges, and an abstract/keywords disclosure.

## After
One compact header bar (spanning the workspace) in `RobWorkspace.jsx`:
`[← Back to Risk of Bias]  [RoB 2 · effect of assignment]  | Study title  [⤴]  … [Show source]`
- **Back** and the **tool badge** now live in the same bar as the **study title**.
- The title truncates cleanly (`text-overflow: ellipsis`, `title=` tooltip) so long
  titles never break the layout.
- A single **external-link icon** ("Open study") opens the best study link — DOI
  (`https://doi.org/…`) if present, else PMID (`pubmed.ncbi.nlm.nih.gov/…`). When no
  link exists the icon is shown disabled with a "No study link available" tooltip.
- The cluttered `ArticleHeaderBar` card was removed from the workspace (authors / DOI
  text / PMID text / PubMed link / badges / abstract disclosure gone) so the user
  stays focused on the assessment. The `ArticleHeaderBar` component itself is kept
  (exported, unused by the workspace) to avoid breaking any other reference.
- An `externalLink` icon was added to the shared icon library.

## QA
Open a study assessment → Back + tool label + title in one bar → no authors/DOI/PMID/
PubMed clutter → one Open-study icon (opens the right link; hidden/disabled when none)
→ long titles truncate, no layout break.
