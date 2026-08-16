/**
 * features/logbook/index.js — 119.md §8. Public barrel for the project Logbook UI.
 * The page is Owner/Leader-only; `canViewLogbook` is the ONE predicate every nav
 * surface must ask before rendering an entry point to it.
 */
export { default as LogbookPage } from './LogbookPage.jsx';
export {
  canViewLogbook, canExportLogbook, logbookViewDecision, logbookExportDecision, logbookAccessContext,
} from './logbookAccess.js';
