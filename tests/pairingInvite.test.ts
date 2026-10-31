import { describe, expect, it } from 'vitest'
import { buildPairingInvite, inviteAuthPath, normalizeCoupleId } from '../app/utils/pairingInvite'

const id = 'abcdef12-3456-7890-abcd-ef1234567890'
describe('pairing invitation URLs', () => {
  it('builds complete links from the current origin and canonicalizes UUIDs', () => {
    expect(buildPairingInvite('https://our-home.example', ` ${id.toUpperCase()} `)).toBe(`https://our-home.example/pairing?invite=${id}`)
    expect(buildPairingInvite('http://localhost:3200', id)).toBe(`http://localhost:3200/pairing?invite=${id}`)
    expect(buildPairingInvite('https://our-home.example/old-path?ignored=1', id)).toBe(`https://our-home.example/pairing?invite=${id}`)
  })
  it.each([undefined, null, '', 'not-a-uuid', [id], `${id}&next=https://external.example`, 'javascript:alert(1)'])('rejects invalid or ambiguous invitation input %j', value => {
    expect(normalizeCoupleId(value)).toBe('')
    expect(buildPairingInvite('https://our-home.example', value)).toBe('')
  })
  it('keeps authentication redirects local and bounded even for hostile parameters', () => {
    expect(inviteAuthPath('/login', id)).toBe(`/login?invite=${id}`)
    expect(inviteAuthPath('/pairing', id)).toBe(`/pairing?invite=${id}`)
    expect(inviteAuthPath('/login')).toBe('/login')
    expect(inviteAuthPath('/login', '//external.example')).toBe('/login?invite=invalid')
    expect(inviteAuthPath('/pairing', [id, id])).toBe('/pairing?invite=invalid')
    expect(buildPairingInvite('javascript:alert(1)', id)).toBe('')
  })
})
