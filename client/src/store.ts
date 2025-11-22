import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export const videoFilenameAtom = atom<string | null>(null)
export const scanLineYAtom = atomWithStorage<number>('mania2midi_scanLineY', 200)
export const hitLineYAtom = atomWithStorage<number>('mania2midi_hitLineY', 200)
export const trackX1Atom = atomWithStorage<number>('mania2midi_trackX1', 100)
export const trackX2Atom = atomWithStorage<number>('mania2midi_trackX2', 500)
export const videoStartTimeAtom = atom<number>(0)
export const videoEndTimeAtom = atom<number>(0)
export const scrollSpeedAtom = atomWithStorage<number>('mania2midi_scrollSpeed', 20)
export const laneRatiosAtom = atomWithStorage<number[]>('mania2midi_laneRatios', [1, 1, 1, 1, 1, 1, 1, 1, 1])
export const visualOffsetAtom = atomWithStorage<number>('mania2midi_visualOffset', 0)
export const isProcessingAtom = atom<boolean>(false)
export const processingResultAtom = atom<{ outputDir: string, chunks: string[], timestamp?: number } | null>(null)
export const lanePresetsAtom = atomWithStorage<Record<string, number[]>>('mania2midi_lanePresets', {
    '9k-equal': [1, 1, 1, 1, 1, 1, 1, 1, 1],
    '7k-equal': [1, 1, 1, 1, 1, 1, 1],
    '4k-equal': [1, 1, 1, 1],
})
