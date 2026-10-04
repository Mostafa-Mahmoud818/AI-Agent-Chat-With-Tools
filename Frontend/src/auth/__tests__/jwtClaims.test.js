import { describe, it, expect } from 'vitest'
import { decodeJwtPayload, readJwtPersonaCode } from '../jwtClaims.js'

function fakeJwt(claims) {
    const encode = (obj) =>
        btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(claims)}.sig`
}

describe('jwtClaims', () => {
    it('readJwtPersonaCode returns the persona_code claim', () => {
        expect(readJwtPersonaCode(fakeJwt({ persona_code: 'STUDENT' }))).toBe('STUDENT')
    })

    it('readJwtPersonaCode returns null when claim is missing or blank', () => {
        expect(readJwtPersonaCode(fakeJwt({ sub: 'user@example.com' }))).toBeNull()
        expect(readJwtPersonaCode(fakeJwt({ persona_code: '  ' }))).toBeNull()
        expect(readJwtPersonaCode('not-a-jwt')).toBeNull()
        expect(readJwtPersonaCode('')).toBeNull()
    })

    it('decodeJwtPayload reads a standard base64 payload', () => {
        const token = fakeJwt({ email: 'a@b.c', persona_code: 'VISITOR' })
        expect(decodeJwtPayload(token)).toMatchObject({ email: 'a@b.c', persona_code: 'VISITOR' })
    })
})
