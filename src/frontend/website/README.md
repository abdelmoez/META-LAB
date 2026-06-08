# Website Manager

This folder is owned by the **Website Manager** agent scope.

## Scope

All files in `src/frontend/website/` relate to the **public-facing marketing website** of META·LAB — the landing page and any future public pages. This is separate from:

- `src/frontend/pages/` — app workspace pages (authenticated)
- `src/frontend/pages/admin/` — admin control panel (admin-only)

## Current structure

```
src/frontend/website/
└── README.md         ← this file (Website Manager ownership marker)
```

The main landing page is at `src/frontend/pages/Landing.jsx`.
All editable content is stored in the database (`SiteSetting` table, key `landingContent`) and managed through the admin control panel at `/ops` → Content.

## Editing website content

Admins can edit all landing page text, feature cards, CTA buttons, SEO tags, banners, and footer copy from the **Ops Console → Content** section. Changes take effect immediately on next page load — no deploy needed.

## Adding new public pages

1. Create the component in `src/frontend/website/`
2. Register the route in `src/App.jsx` (no `ProtectedRoute` wrapper)
3. Add a nav link entry in the `navLinks` content setting

## Rules

- Website Manager changes must NEVER touch `/src/frontend/pages/app/` or the admin console
- All text content that appears on the public site must be editable from the admin content editor
- No private user or project data may appear on public pages
- SEO metadata (title, description) is controlled via the admin SEO tab
