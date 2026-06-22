/**
 * StitchStyle.jsx — injects the scoped Stitch stylesheet.
 *
 * Mounted once inside the Stitch shell (so legacy users never receive it and the
 * cost is paid only when the Stitch UI is actually rendered). All rules are rooted
 * at html[data-ui-design="stitch"], so the stylesheet is inert if it ever lingers.
 */
import { buildStitchCss } from './stitchTokens.js';

export default function StitchStyle() {
  return <style data-stitch-tokens="1">{buildStitchCss()}</style>;
}
