import { describe, it, expect } from 'vitest'
import { exclusiveDateMin } from '../../components/chat/ChatInput.jsx'
import { deriveComposerModeFromMessages } from '../../components/chat/ChatWindow.jsx'
import { parseAgentMessage, turnsToMessages } from '../agentMessage.js'

describe('exclusiveDateMin', () => {
    it('returns the calendar day after afterDate', () => {
        expect(exclusiveDateMin('2026-09-01')).toBe('2026-09-02')
        expect(exclusiveDateMin('2026-01-31')).toBe('2026-02-01')
    })

    it('returns undefined for invalid input', () => {
        expect(exclusiveDateMin(null)).toBeUndefined()
        expect(exclusiveDateMin('not-a-date')).toBeUndefined()
    })
})

describe('deriveComposerModeFromMessages', () => {
    it('restores attachment_request from last AI turn', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'user', text: 'hi' },
            { role: 'ai', payload: { subtype: 'attachment_request' }, handledBy: 'STUDENT_ABSENCE' },
        ])).toEqual({
            mode: 'attachment_request',
            dateConstraint: null,
            attachmentHandledBy: 'STUDENT_ABSENCE',
        })
    })

    it('restores date_request with dateConstraint', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'date_request', dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' } } },
        ])).toEqual({
            mode: 'date_request',
            dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' },
            attachmentHandledBy: null,
        })
    })

    it('clears mode after a subsequent non-request subtype', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'attachment_request' } },
            { role: 'ai', payload: { subtype: 'menu', menuitems: [] } },
        ]).mode).toBe('default')
    })

    it('switches from date_request to attachment_request when that is the latest AI turn', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'date_request', dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' } } },
            { role: 'user', text: '2026-09-05' },
            { role: 'ai', payload: { subtype: 'attachment_request' }, handledBy: 'Error Banner Agent' },
        ])).toEqual({
            mode: 'attachment_request',
            dateConstraint: null,
            attachmentHandledBy: 'Error Banner Agent',
        })
    })

    it('keeps default composer on a Banner-stop text reply (no attach/date subtype)', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'none' } },
        ]).mode).toBe('default')
    })

    it('clears date_request when the next AI has payload null (parsed subtype none)', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'date_request', dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' } } },
            { role: 'user', text: '2026-09-05' },
            { role: 'ai', text: 'Please describe the details.', payload: null },
        ])).toEqual({ mode: 'default', dateConstraint: null, attachmentHandledBy: null })
    })

    it('does not clear date_request when a system AI turn arrives without payload', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', payload: { subtype: 'date_request', dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' } } },
            { role: 'ai', system: true, text: 'Status update', payload: null },
        ])).toEqual({
            mode: 'date_request',
            dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' },
            attachmentHandledBy: null,
        })
    })

    it('infers banner attach owner from a prior AI handledBy when the request turn omits it', () => {
        expect(deriveComposerModeFromMessages([
            { role: 'ai', handledBy: 'Error Banner Agent', payload: { subtype: 'menu', menuitems: [] } },
            { role: 'user', text: 'Registration' },
            { role: 'ai', payload: { subtype: 'attachment_request' } },
        ])).toEqual({
            mode: 'attachment_request',
            dateConstraint: null,
            attachmentHandledBy: 'Error Banner Agent',
        })
    })
})

describe('agentMessage absence subtypes', () => {
    it('normalizes attachment_request and date_request payloads', () => {
        const attach = parseAgentMessage(JSON.stringify({
            replyType: 'json',
            textString: 'Please attach a document.',
            payload: { subtype: 'attachment_request', menuitems: [] },
        }))
        expect(attach.payload.subtype).toBe('attachment_request')

        const date = parseAgentMessage(JSON.stringify({
            replyType: 'json',
            textString: 'Pick an end date.',
            payload: {
                subtype: 'date_request',
                dateConstraint: { field: 'dateTo', afterDate: '2026-09-01' },
            },
        }))
        expect(date.payload.subtype).toBe('date_request')
        expect(date.payload.dateConstraint).toEqual({ field: 'dateTo', afterDate: '2026-09-01' })
    })

    it('trusts displayText for attachment marker user turns', () => {
        const msgs = turnsToMessages([
            {
                id: 't1',
                userInput: '[attachment] path=a/b.pdf filename=b.pdf type=application/pdf',
                displayText: 'Attached: b.pdf (42 KB)',
                turnKind: 'EXCHANGE',
                agentResponse: null,
                createdAt: '2026-09-01T00:00:00Z',
            },
        ])
        expect(msgs[0].displayText).toBe('Attached: b.pdf (42 KB)')
    })
})
