import { describe, it, expect, beforeEach } from 'vitest'
import {
    MENU_CACHE_LIMITS,
    cacheLevel,
    getCachedLevel,
    invalidateSession,
    isRestartIntent,
    setActiveSession,
    __resetMenuCacheForTests,
} from '../menuCache.js'

const SID = 'sess-1'
const payloadFor = (levelKey, label) => ({
    subtype: 'menu',
    menuitems: [{ id: 'a', label: 'A' }],
    breadcrumb: [{ label, levelKey }],
})

describe('menuCache', () => {
    beforeEach(() => {
        __resetMenuCacheForTests()
    })

    it('round-trips a cached level', () => {
        cacheLevel(SID, 'root', payloadFor('root', 'Menu'))
        const got = getCachedLevel(SID, 'root')
        expect(got?.breadcrumb?.[0]?.levelKey).toBe('root')
    })

    it('returns null on cache miss', () => {
        expect(getCachedLevel(SID, 'missing')).toBeNull()
    })

    it('ignores null/empty inputs silently', () => {
        cacheLevel(null, 'root', payloadFor('root', 'Menu'))
        cacheLevel(SID, '', payloadFor('root', 'Menu'))
        cacheLevel(SID, 'root', null)
        expect(getCachedLevel(SID, 'root')).toBeNull()
    })

    it('invalidateSession drops the whole cache for that session', () => {
        cacheLevel(SID, 'root', payloadFor('root', 'Menu'))
        cacheLevel(SID, 'cat/1', payloadFor('cat/1', 'Drinks'))
        invalidateSession(SID)
        expect(getCachedLevel(SID, 'root')).toBeNull()
        expect(getCachedLevel(SID, 'cat/1')).toBeNull()
    })

    it('setActiveSession clears the previous session when switching', () => {
        cacheLevel(SID, 'root', payloadFor('root', 'Menu'))
        setActiveSession(SID)
        setActiveSession('sess-2')
        expect(getCachedLevel(SID, 'root')).toBeNull()
    })

    it('evicts the least-recently-used entry when MAX_ENTRIES is exceeded', () => {
        for (let i = 0; i < MENU_CACHE_LIMITS.MAX_ENTRIES; i++) {
            cacheLevel(SID, `k-${i}`, payloadFor(`k-${i}`, `L${i}`))
        }
        // k-0 is LRU. Touch k-1 to push k-0 to the front of the eviction queue.
        getCachedLevel(SID, 'k-1')
        cacheLevel(SID, 'overflow', payloadFor('overflow', 'New'))
        expect(getCachedLevel(SID, 'k-0')).toBeNull()
        expect(getCachedLevel(SID, 'k-1')).not.toBeNull()
        expect(getCachedLevel(SID, 'overflow')).not.toBeNull()
    })

    it('re-caching a key promotes it to most-recently-used', () => {
        cacheLevel(SID, 'a', payloadFor('a', 'A'))
        cacheLevel(SID, 'b', payloadFor('b', 'B'))
        cacheLevel(SID, 'a', payloadFor('a', 'A2')) // re-insert promotes a
        // Fill to the cap so b is the LRU entry.
        for (let i = 0; i < MENU_CACHE_LIMITS.MAX_ENTRIES - 1; i++) {
            cacheLevel(SID, `f-${i}`, payloadFor(`f-${i}`, `F${i}`))
        }
        expect(getCachedLevel(SID, 'b')).toBeNull()
        expect(getCachedLevel(SID, 'a')?.breadcrumb?.[0]?.label).toBe('A2')
    })

    describe('isRestartIntent', () => {
        it.each([
            ['start over please', true],
            ['can we restart?', true],
            ['reset this order', true],
            ['I want a new order', true],
            ['go back to the start', true],
            ['show me drinks', false],
            ['what is in category 3', false],
            ['', false],
        ])('detects "%s" → %s', (text, expected) => {
            expect(isRestartIntent(text)).toBe(expected)
        })

        it('returns false for non-strings', () => {
            expect(isRestartIntent(null)).toBe(false)
            expect(isRestartIntent(undefined)).toBe(false)
            expect(isRestartIntent(123)).toBe(false)
        })
    })
})
