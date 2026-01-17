export type PosValue =
  | 'Noun'
  | 'Verb'
  | 'Adjective'
  | 'Adverb'
  | 'Pronoun'
  | 'Preposition'
  | 'Conjunction'
  | 'Determiner'
  | 'Interjection'
  | 'Phrase'
  | 'Other'

export const POS_OPTIONS: Array<{ value: PosValue; label: string }> = [
  { value: 'Noun', label: 'Noun' },
  { value: 'Verb', label: 'Verb' },
  { value: 'Adjective', label: 'Adjective' },
  { value: 'Adverb', label: 'Adverb' },
  { value: 'Pronoun', label: 'Pronoun' },
  { value: 'Preposition', label: 'Preposition' },
  { value: 'Conjunction', label: 'Conjunction' },
  { value: 'Determiner', label: 'Determiner' },
  { value: 'Interjection', label: 'Interjection' },
  { value: 'Phrase', label: 'Phrase' },
  { value: 'Other', label: 'Other' }
]

export function normalizePos(input: unknown): PosValue | '' {
  const raw = String(input || '').trim()
  if (!raw) return ''

  // Accept common tags from dictionaries/APIs.
  const upper = raw.toUpperCase()
  const map: Record<string, PosValue> = {
    NOUN: 'Noun',
    VERB: 'Verb',
    ADJ: 'Adjective',
    ADJECTIVE: 'Adjective',
    ADV: 'Adverb',
    ADVERB: 'Adverb',
    PRON: 'Pronoun',
    PRONOUN: 'Pronoun',
    PREP: 'Preposition',
    PREPOSITION: 'Preposition',
    CONJ: 'Conjunction',
    CONJUNCTION: 'Conjunction',
    DET: 'Determiner',
    DETERMINER: 'Determiner',
    INT: 'Interjection',
    INTERJECTION: 'Interjection',
    PHRASE: 'Phrase',
    OTHER: 'Other'
  }
  if (map[upper]) return map[upper]

  // Accept already-normalized UI values.
  const exact = POS_OPTIONS.find((o) => o.value === raw)
  return exact ? exact.value : ''
}
