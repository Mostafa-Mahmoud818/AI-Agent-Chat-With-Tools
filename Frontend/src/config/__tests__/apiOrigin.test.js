import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    API_BACKENDS,
    resolveActiveBackendPreset,
    resolveApiOrigin,
    resolveDevProxyTarget,
    resolveModulithRequestBase,
    isRelativeApiMode,
} from '../apiOrigin.js'
import { setRuntimeBackendEnv } from '../runtimeSettings.js'

describe('apiOrigin', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        localStorage.clear()
    })

    it('resolveActiveBackendPreset uses runtime picker over VITE_API_BACKEND', () => {
        setRuntimeBackendEnv('TEST')
        const env = { VITE_API_BACKEND: 'remote-dev' }
        expect(resolveActiveBackendPreset(env)).toBe('remote-test')
    })

    it('resolveDevProxyTarget follows runtime picker', () => {
        setRuntimeBackendEnv('LOCAL')
        const env = { VITE_API_BACKEND: 'remote-dev' }
        expect(resolveDevProxyTarget(env)).toBe(API_BACKENDS.local)
    })

    it('resolveApiOrigin uses runtime picker absolute URL even in relative mode', () => {
        setRuntimeBackendEnv('DEV')
        const env = { VITE_API_RELATIVE: '1', VITE_API_BACKEND: 'local' }
        expect(resolveApiOrigin(env)).toBe(API_BACKENDS['remote-dev'])
    })

    it('resolveApiOrigin returns empty string in relative mode when no runtime picker', () => {
        const env = { VITE_API_RELATIVE: '1', VITE_API_BACKEND: 'local' }
        expect(resolveApiOrigin(env)).toBe('')
    })

    it('resolveApiOrigin uses runtime picker when not relative', () => {
        setRuntimeBackendEnv('TEST')
        const env = { VITE_API_BACKEND: 'remote-dev' }
        expect(resolveApiOrigin(env)).toBe(API_BACKENDS['remote-test'])
    })

    it('resolveModulithRequestBase follows runtime picker in relative mode', () => {
        setRuntimeBackendEnv('TEST')
        const env = { VITE_API_RELATIVE: '1', VITE_API_BACKEND: 'remote-dev' }
        expect(isRelativeApiMode(env)).toBe(true)
        expect(resolveModulithRequestBase(env)).toBe(API_BACKENDS['remote-test'])
    })

    it('resolveModulithRequestBase returns empty string in relative mode without runtime picker', () => {
        const env = { VITE_API_RELATIVE: '1', VITE_API_BACKEND: 'remote-dev' }
        expect(resolveModulithRequestBase(env)).toBe('')
    })

    it('resolveModulithRequestBase returns absolute origin when not relative', () => {
        setRuntimeBackendEnv('LOCAL')
        const env = { VITE_API_BACKEND: 'remote-dev' }
        expect(resolveModulithRequestBase(env)).toBe(API_BACKENDS.local)
    })

    it('resolveActiveBackendPreset detects stg-modulith from VITE_API_ORIGIN', () => {
        const env = { VITE_API_ORIGIN: 'https://stg-modulith.naitive.ai' }
        expect(resolveActiveBackendPreset(env)).toBe('remote-stage')
    })

    it('resolveApiOrigin uses STAGE runtime picker', () => {
        setRuntimeBackendEnv('STAGE')
        const env = { VITE_API_BACKEND: 'remote-dev' }
        expect(resolveApiOrigin(env)).toBe(API_BACKENDS['remote-stage'])
    })
})
