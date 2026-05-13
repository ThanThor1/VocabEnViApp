const definitionCache = new Map<string, Promise<string>>()

function normalizeDefinition(definition: string): string {
  return String(definition || '')
    .trim()
    .replace(/\s+/g, ' ')
}

function stripHtml(input: string): string {
  return String(input || '').replace(/<[^>]+>/g, ' ')
}

function decodeHtmlEntities(input: string): string {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function cleanDefinitionText(input: string): string {
  return normalizeDefinition(decodeHtmlEntities(stripHtml(input)))
}

function clipDefinition(text: string, maxLength: number = 320): string {
  const clean = normalizeDefinition(text)
  if (!clean) return ''
  if (clean.length <= maxLength) return clean

  const sentence = clean.match(/^(.{1,260}?\.[\s"')\]]|.{1,260}?$)/)
  const clipped = sentence ? sentence[1].replace(/[\s"')\]]+$/g, '') : clean.slice(0, maxLength - 3)
  return clipped.length > maxLength ? `${clipped.slice(0, maxLength - 3)}...` : clipped
}

function normalizeLookupWord(word: string): string {
  return String(word || '')
    .trim()
    .replace(/^\s+|\s+$/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '')
}

function uniqueWords(words: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of words) {
    const clean = normalizeLookupWord(item)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function buildLookupCandidates(word: string): string[] {
  const cleanWord = normalizeLookupWord(word)
  if (!cleanWord) return []

  const lower = cleanWord.toLowerCase()
  const candidates = [
    cleanWord,
    lower,
    lower.replace(/[’']s$/i, ''),
  ]

  if (lower.endsWith('ies') && lower.length > 3) {
    candidates.push(lower.slice(0, -3) + 'y')
  }

  if (lower.endsWith('ves') && lower.length > 3) {
    candidates.push(lower.slice(0, -3) + 'f')
    candidates.push(lower.slice(0, -3) + 'fe')
  }

  if (lower.endsWith('ing') && lower.length > 4) {
    candidates.push(lower.slice(0, -3))
    candidates.push(lower.slice(0, -3).replace(/([a-z])\1$/i, '$1'))
  }

  if (lower.endsWith('ed') && lower.length > 3) {
    candidates.push(lower.slice(0, -2))
    candidates.push(lower.slice(0, -1))
  }

  if (lower.endsWith('es') && lower.length > 3) {
    candidates.push(lower.slice(0, -2))
  }

  if (lower.endsWith('s') && lower.length > 2) {
    candidates.push(lower.slice(0, -1))
  }

  return uniqueWords(candidates)
}

async function fetchDictionaryApiDefinition(word: string): Promise<string> {
  const resp = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`)
  if (!resp.ok) return ''
  const data = await resp.json()
  if (!Array.isArray(data) || data.length === 0) return ''

  for (const entry of data) {
    const definition = pickDefinitionFromEntry(entry)
    if (definition) return definition
  }

  return ''
}

function pickWiktionaryDefinition(item: any): string {
  const defs = Array.isArray(item?.definitions) ? item.definitions : []
  let formOfCandidate = ''

  for (const def of defs) {
    const text = cleanDefinitionText(def?.definition)
    if (!text) continue

    // Prefer semantic definitions over purely inflection/form-of entries.
    if (!/\b(form of|inflection of|plural of|past tense of|participle of)\b/i.test(text)) {
      return text
    }
    if (!formOfCandidate) formOfCandidate = text
  }

  return formOfCandidate
}

async function fetchWiktionaryDefinition(word: string): Promise<string> {
  const resp = await fetch(
    `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`
  )
  if (!resp.ok) return ''

  const data = await resp.json()

  const enEntries = Array.isArray(data?.en) ? data.en : []
  for (const entry of enEntries) {
    const definition = pickWiktionaryDefinition(entry)
    if (definition) return clipDefinition(definition)
  }

  return ''
}

async function fetchWikipediaSummaryDefinition(word: string): Promise<string> {
  const resp = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`)
  if (!resp.ok) return ''

  const data = await resp.json()
  const extract = cleanDefinitionText(data?.extract)
  if (!extract) return ''
  if (/\bmay refer to\b/i.test(extract)) return ''

  return clipDefinition(extract)
}

function pickDefinitionFromEntry(entry: any): string {
  const meanings = Array.isArray(entry?.meanings) ? entry.meanings : []
  for (const meaning of meanings) {
    const definitions = Array.isArray(meaning?.definitions) ? meaning.definitions : []
    for (const item of definitions) {
      const definition = normalizeDefinition(item?.definition)
      if (definition) return definition
    }
  }
  return ''
}

export async function fetchEnglishDefinition(word: string): Promise<string> {
  const cleanWord = String(word || '').trim()
  if (!cleanWord) return ''

  const cacheKey = cleanWord.toLowerCase()
  const cached = definitionCache.get(cacheKey)
  if (cached) return cached

  const pending = (async () => {
    try {
      const candidates = buildLookupCandidates(cleanWord)
      for (const candidate of candidates) {
        try {
          const definition = await fetchDictionaryApiDefinition(candidate)
          if (definition) return definition
        } catch {
          // try next candidate
        }
      }

      for (const candidate of candidates) {
        try {
          const wiktionary = await fetchWiktionaryDefinition(candidate)
          if (wiktionary) return wiktionary
        } catch {
          // try next candidate
        }
      }

      for (const candidate of candidates) {
        try {
          const wikipedia = await fetchWikipediaSummaryDefinition(candidate)
          if (wikipedia) return wikipedia
        } catch {
          // try next candidate
        }
      }
    } catch {
      // ignore network and parsing errors
    }
    return ''
  })()

  definitionCache.set(cacheKey, pending)
  const result = await pending
  if (result) {
    definitionCache.set(cacheKey, Promise.resolve(result))
  } else {
    definitionCache.delete(cacheKey)
  }
  return result
}
