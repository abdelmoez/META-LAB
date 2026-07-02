/**
 * features/publicSynthesis/index.js — 68.md (P8) barrel. The PublicSynthesisPage
 * (public/embed route + preview) and the authoring PublishPanel are code-split via
 * lazy() at their call sites, so this barrel only re-exports the light pieces used
 * directly (flag + API contracts). Heavy components are imported by path.
 */
export { publicSynthesisFlagEnabled } from './flag.js';
export { default as synthesisApi, fetchPublicSynthesis, publicUrls, embedSnippet } from './publicSynthesisApi.js';
