/**
 * Oblique projection.
 *
 * The world is a flat plan in world coordinates — collision, proximity and
 * everything the server knows about are computed on that plan, unchanged. The
 * renderer alone tilts the camera back, by squashing the ground plane
 * vertically and drawing vertical surfaces rising against it.
 *
 * Two consequences worth knowing:
 *
 *  - Anything that should look like it is standing up (avatars, faces, signage)
 *    has to cancel the squash with `scale.y = UNTILT`, or it renders as an
 *    ellipse. Anything lying on the floor — shadows, rugs, the earshot ring —
 *    keeps it.
 *  - Screen↔world conversion is no longer symmetric. Y must be divided by
 *    `zoom * TILT`, X by `zoom` alone.
 */

/** Vertical compression of the ground plane. ~44° of camera tilt. */
export const TILT = 0.7;

/** Cancels the squash for surfaces that face the camera. */
export const UNTILT = 1 / TILT;
