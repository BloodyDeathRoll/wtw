import { describe, it, expect } from 'vitest'
import { resolvePartner, type CowatchRoomRow } from '@/lib/cowatch-room'

// This is the check that closed the co-watch IDOR: the partner is derived from
// room membership instead of being taken from the request body, where any
// authenticated user could point it at any other user's fingerprint.

const HOST = 'user-host'
const GUEST = 'user-guest'
const STRANGER = 'user-stranger'
const NOW = new Date('2026-07-30T12:00:00.000Z')

function room(overrides: Partial<CowatchRoomRow> = {}): CowatchRoomRow {
  return {
    host_id: HOST,
    guest_id: GUEST,
    expires_at: '2026-07-30T13:00:00.000Z', // an hour after NOW
    ...overrides,
  }
}

describe('members get their partner', () => {
  it('gives the host the guest', () => {
    expect(resolvePartner(room(), HOST, NOW)).toEqual({ status: 'ok', partnerId: GUEST })
  })

  it('gives the guest the host', () => {
    expect(resolvePartner(room(), GUEST, NOW)).toEqual({ status: 'ok', partnerId: HOST })
  })

  it('reports waiting while the guest slot is empty', () => {
    expect(resolvePartner(room({ guest_id: null }), HOST, NOW)).toEqual({ status: 'waiting' })
  })
})

describe('everyone else is denied', () => {
  it('denies a non-member who knows the code', () => {
    expect(resolvePartner(room(), STRANGER, NOW)).toEqual({ status: 'denied' })
  })

  it('denies a non-member even while the room is waiting', () => {
    // The dangerous case: an empty slot must not read as "join yourself in".
    expect(resolvePartner(room({ guest_id: null }), STRANGER, NOW)).toEqual({ status: 'denied' })
  })

  it('denies when there is no such room', () => {
    expect(resolvePartner(null, HOST, NOW)).toEqual({ status: 'denied' })
    expect(resolvePartner(undefined, HOST, NOW)).toEqual({ status: 'denied' })
  })
})

describe('expiry', () => {
  it('denies an expired room even to its host', () => {
    const expired = room({ expires_at: '2026-07-30T11:59:59.000Z' })
    expect(resolvePartner(expired, HOST, NOW)).toEqual({ status: 'denied' })
  })

  it('denies a room expiring exactly now', () => {
    const boundary = room({ expires_at: NOW.toISOString() })
    expect(resolvePartner(boundary, HOST, NOW)).toEqual({ status: 'denied' })
  })

  it('fails closed on an unparseable expiry', () => {
    const broken = room({ expires_at: 'not a date' })
    expect(resolvePartner(broken, HOST, NOW)).toEqual({ status: 'denied' })
  })
})

describe('a room is between two different people', () => {
  it('never returns the caller as their own partner', () => {
    // Defence in depth: the DB constraint forbids this row, but if one ever
    // existed the resolver must not hand the caller back to themselves.
    const selfRoom = room({ host_id: HOST, guest_id: HOST })
    expect(resolvePartner(selfRoom, HOST, NOW)).toEqual({ status: 'waiting' })
  })
})
