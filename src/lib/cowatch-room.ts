/**
 * cowatch-room.ts
 *
 * The single authorisation decision behind co-watch: given a room row and the
 * caller, who — if anyone — is the caller allowed to be scored against?
 *
 * Pulled out of the route deliberately. This is the check that replaced a
 * client-supplied `user_id_b` (which let any authenticated user read any other
 * user's taste profile — see migration 0015), so it's worth having in one place
 * that can be read and tested on its own rather than inline in a handler.
 *
 * "denied" deliberately covers three different situations — no such room, an
 * expired room, and a room the caller isn't in. A non-member must not be able to
 * tell them apart, or the endpoint becomes a probe for which codes are live.
 */

export interface CowatchRoomRow {
  host_id: string
  guest_id: string | null
  expires_at: string // ISO-8601
}

export type PartnerResolution =
  | { status: 'denied' }
  | { status: 'waiting' }
  | { status: 'ok'; partnerId: string }

export function resolvePartner(
  room: CowatchRoomRow | null | undefined,
  callerId: string,
  now: Date,
): PartnerResolution {
  if (!room) return { status: 'denied' }

  const isMember = room.host_id === callerId || room.guest_id === callerId
  if (!isMember) return { status: 'denied' }

  // Parses to NaN on a malformed timestamp; the comparison is then false, so
  // treat anything not provably in the future as expired.
  const expiresAt = new Date(room.expires_at).getTime()
  if (!(expiresAt > now.getTime())) return { status: 'denied' }

  const partnerId = room.host_id === callerId ? room.guest_id : room.host_id
  // No partner, or a malformed room where both slots are the caller (the DB
  // constraint forbids it, but a resolver that can hand someone back to
  // themselves is one refactor away from being wrong somewhere else).
  if (!partnerId || partnerId === callerId) return { status: 'waiting' }

  return { status: 'ok', partnerId }
}
