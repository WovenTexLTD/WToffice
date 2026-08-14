/**
 * Stable key for a person.
 *
 * Names are the identity until Phase 7 brings Google SSO, at which point this
 * becomes the subject id and everything above it keeps working. Profile
 * pictures are stored against it, which is what makes them survive a reconnect.
 */
export function toIdentity(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 64);
}
