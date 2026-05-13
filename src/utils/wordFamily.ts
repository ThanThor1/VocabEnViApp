import { normalizePos } from '../components/posOptions/posOptions'
import type { WordFamilyMember, WordFamilyResponse } from '../../electron'

export type EnrichedWordFamilyMember = WordFamilyMember & {
  meaning?: string
  meaningNoteVi?: string
  meaningNoteVie?: string
  pronunciation?: string
  example?: string
}

const ensureIpaSlashes = (val: string) => {
  const v = (val || '').trim().replace(/"/g, '')
  if (!v) return ''
  const core = v.replace(/^\/+|\/+$/g, '')
  return `/${core}/`
}

const getApi = () => (window as any)?.api as any

export async function getWordFamily(word: string): Promise<WordFamilyResponse | null> {
  const w = String(word || '').trim()
  if (!w) return null
  const api = getApi()
  if (!api?.getWordFamily) return null
  const resp = await api.getWordFamily({ word: w })
  if (!resp || typeof resp !== 'object') return null
  const family = Array.isArray(resp.family) ? resp.family : []
  return {
    word: String((resp as any).word || w),
    family: family
      .map((x: any) => ({
        word: String(x?.word || '').trim(),
        pos: String(x?.pos || '').trim() || undefined,
        relation: String(x?.relation || '').trim() || undefined
      }))
      .filter((x: any) => x.word)
  }
}

export async function enrichWordFamilyMembers(
  members: WordFamilyMember[],
  opts?: { concurrency?: number; contextSentenceEn?: string }
): Promise<EnrichedWordFamilyMember[]> {
  const api = getApi()
  const concurrency = Math.max(1, Math.min(8, opts?.concurrency ?? 2))
  const contextSentenceEn = String(opts?.contextSentenceEn || '').trim()
  const list = (Array.isArray(members) ? members : []).filter((m) => m && String(m.word || '').trim())

  const work = list.map((m) => async (): Promise<EnrichedWordFamilyMember> => {
    const w = String(m.word || '').trim()
    let meaning = ''
    let meaningNoteVi = ''
    let meaningNoteVie = ''
    let pos = normalizePos(m.pos) || String(m.pos || '').trim()
    let pronunciation = ''
    let example = ''

    // Prefer a single call that can return meaning + POS + IPA + example.
    if (api?.enrichWord) {
      try {
        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
        const resp = await api.enrichWord({ requestId, word: w, contextSentenceEn, from: 'en', to: 'vi', dialect: 'US' })
        const suggested = String(resp?.meaningSuggested || '').trim()
        if (suggested) meaning = suggested
        const note = String(resp?.meaningNoteVie || resp?.meaningNoteVi || '').trim()
        if (note) {
          meaningNoteVi = note
          meaningNoteVie = note
        }

        const posSuggested = normalizePos(String(resp?.posSuggested || '').trim())
        if (posSuggested) pos = posSuggested

        const ipa = String(resp?.ipa || '').trim()
        if (ipa) pronunciation = ensureIpaSlashes(ipa)

        const ex = String(resp?.example || '').trim()
        if (ex) example = ex
      } catch {
        // ignore
      }
    }

    if (!meaning && api?.autoMeaning) {
      try {
        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
        const resp = await api.autoMeaning({ requestId, word: w, contextSentenceEn: '', from: 'en', to: 'vi' })
        const suggested = String(resp?.meaningSuggested || '').trim()
        if (suggested) meaning = suggested
        const note = String(resp?.meaningNoteVie || resp?.meaningNoteVi || '').trim()
        if (note) {
          meaningNoteVi = note
          meaningNoteVie = note
        }
        if (!pos) {
          const firstWithPos = (Array.isArray(resp?.candidates) ? resp.candidates : []).find((c: any) => c && c.pos)
          const normalized = normalizePos(firstWithPos?.pos)
          if (normalized) pos = normalized
        }
      } catch {
        // ignore
      }
    }

    if (!meaningNoteVi && api?.autoMeaning) {
      try {
        const requestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`
        const resp = await api.autoMeaning({ requestId, word: w, contextSentenceEn: '', from: 'en', to: 'vi' })
        const note = String(resp?.meaningNoteVie || resp?.meaningNoteVi || '').trim()
        if (note) {
          meaningNoteVi = note
          meaningNoteVie = note
        }
      } catch {
        // ignore
      }
    }

    if (!pronunciation && api?.suggestIpa) {
      try {
        const out = await api.suggestIpa({ word: w, dialect: 'US' })
        if (String(out || '').trim()) pronunciation = ensureIpaSlashes(String(out || ''))
      } catch {
        // ignore
      }
    }

    return {
      word: w,
      pos: pos || undefined,
      relation: m.relation,
      meaning: meaning || undefined,
      meaningNoteVi: meaningNoteVi || undefined,
      meaningNoteVie: meaningNoteVie || undefined,
      pronunciation: pronunciation || undefined,
      example: example || undefined
    }
  })

  const results: EnrichedWordFamilyMember[] = []
  let idx = 0

  const runOne = async () => {
    while (idx < work.length) {
      const my = idx
      idx += 1
      results[my] = await work[my]()
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, work.length) }, () => runOne())
  await Promise.all(runners)
  return results
}

export function countSaveableFamilyMembers(members: EnrichedWordFamilyMember[]): number {
  return (Array.isArray(members) ? members : []).filter((m) => {
    const w = String(m?.word || '').trim()
    const meaning = String(m?.meaning || '').trim()
    const pos = String(m?.pos || '').trim()
    return !!w && !!meaning && !!pos
  }).length
}
