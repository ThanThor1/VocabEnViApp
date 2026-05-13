import type { SynonymsResponse, WordFamilyMember } from '../../electron'
import { enrichWordFamilyMembers, type EnrichedWordFamilyMember } from './wordFamily'

const getApi = () => (window as any)?.api as any

export async function getSynonyms(word: string): Promise<SynonymsResponse | null> {
  const w = String(word || '').trim()
  if (!w) return null
  const api = getApi()
  if (!api?.getSynonyms) return null
  const resp = await api.getSynonyms({ word: w })
  if (!resp || typeof resp !== 'object') return null
  const synonyms = Array.isArray((resp as any).synonyms) ? (resp as any).synonyms : []
  return {
    word: String((resp as any).word || w),
    synonyms: synonyms
      .map((x: any) => ({
        word: String(x?.word || '').trim(),
        pos: String(x?.pos || '').trim() || undefined,
        relation: String(x?.relation || '').trim() || undefined
      }))
      .filter((x: any) => x.word)
  }
}

export async function enrichSynonyms(
  members: WordFamilyMember[],
  opts?: { concurrency?: number; contextSentenceEn?: string }
): Promise<EnrichedWordFamilyMember[]> {
  return enrichWordFamilyMembers(members, opts)
}

export async function getSynonymFamilies(
  synonyms: Array<{ word: string }>,
  opts?: { maxSynonyms?: number; concurrency?: number; contextSentenceEn?: string }
): Promise<WordFamilyMember[]> {
  void synonyms
  void opts
  return []
}
