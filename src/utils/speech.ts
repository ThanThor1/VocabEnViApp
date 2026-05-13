// Speech utility using Free Dictionary API for high-quality pronunciation
// Falls back to Web Speech API if audio not available

// Cache for audio URLs to avoid repeated API calls
const audioCache = new Map<string, string | null>()

// Coalesce concurrent lookups for the same word
const pendingLookups = new Map<string, Promise<string | null>>()

// Currently playing audio element
let currentAudio: HTMLAudioElement | null = null

// Track the latest speak request to prevent out-of-order playback
let speakRequestToken = 0

// Abort in-flight dictionary request when a new speak starts
let currentAbortController: AbortController | null = null

let webSpeechToken = 0

function normalizeWord(word: string): string {
  return String(word || '').trim().toLowerCase()
}

function normalizeAudioUrl(url: string): string {
  const u = String(url || '').trim()
  if (!u) return ''
  // Some APIs return protocol-relative URLs
  if (u.startsWith('//')) return `https:${u}`
  return u
}

/**
 * Fetch audio URL from Free Dictionary API
 */
async function fetchAudioUrl(word: string, signal?: AbortSignal): Promise<string | null> {
  const normalizedWord = normalizeWord(word)
  
  // Check cache first
  if (audioCache.has(normalizedWord)) {
    return audioCache.get(normalizedWord) || null
  }

  // Coalesce in-flight lookups
  if (pendingLookups.has(normalizedWord)) {
    return pendingLookups.get(normalizedWord) || null
  }

  const lookupPromise = (async (): Promise<string | null> => {
    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalizedWord)}`,
        signal ? { signal } : undefined
      )
      
      if (!response.ok) {
        audioCache.set(normalizedWord, null)
        return null
      }
      
      const data = await response.json()
      
      if (!Array.isArray(data) || data.length === 0) {
        audioCache.set(normalizedWord, null)
        return null
      }
      
      // Find audio URL from phonetics
      // Prefer US pronunciation, then any available
      let audioUrl: string | null = null
      
      for (const entry of data) {
        const phonetics = entry.phonetics || []
        
        // First try to find US audio
        const usPhonetic = phonetics.find(
          (p: any) => p.audio && (p.audio.includes('-us') || p.audio.includes('_us'))
        )
        if (usPhonetic?.audio) {
          audioUrl = usPhonetic.audio
          break
        }
        
        // Then try UK audio
        const ukPhonetic = phonetics.find(
          (p: any) => p.audio && (p.audio.includes('-uk') || p.audio.includes('_uk') || p.audio.includes('-gb'))
        )
        if (ukPhonetic?.audio) {
          audioUrl = ukPhonetic.audio
          break
        }
        
        // Finally, any audio
        const anyPhonetic = phonetics.find((p: any) => p.audio)
        if (anyPhonetic?.audio) {
          audioUrl = anyPhonetic.audio
          break
        }
      }

      const normalizedUrl = audioUrl ? normalizeAudioUrl(audioUrl) : null
      audioCache.set(normalizedWord, normalizedUrl)
      return normalizedUrl
    } catch (err: any) {
      // Abort is expected when user clicks multiple times quickly
      if (err && (err.name === 'AbortError' || String(err.message || '').includes('AbortError'))) {
        return null
      }
      console.warn('Failed to fetch audio from dictionary API:', err)
      audioCache.set(normalizedWord, null)
      return null
    } finally {
      pendingLookups.delete(normalizedWord)
    }
  })()

  pendingLookups.set(normalizedWord, lookupPromise)
  return lookupPromise
}

/**
 * Fallback to Web Speech API
 */
function speakWithWebSpeech(text: string): void {
  try {
    const token = ++webSpeechToken
    window.speechSynthesis.cancel()
    // Prevent stale onvoiceschanged from previous calls
    window.speechSynthesis.onvoiceschanged = null
    const ut = new SpeechSynthesisUtterance(text)
    ut.rate = 0.85
    ut.pitch = 1.0
    ut.volume = 1.0
    ut.lang = 'en-US'
    
    // Cache preferred voice to avoid re-searching every time
    const setVoice = () => {
      const voices = window.speechSynthesis.getVoices()
      // Prefer Google US English voices (consistent quality)
      const googleUs = voices.find(v => v.name.includes('Google') && v.lang === 'en-US')
      if (googleUs) {
        ut.voice = googleUs
        return
      }
      // Then Microsoft US voices
      const msUs = voices.find(v => v.name.includes('Microsoft') && v.lang.startsWith('en-US'))
      if (msUs) {
        ut.voice = msUs
        return
      }
      // Then any en-US
      const enUs = voices.find(v => v.lang === 'en-US')
      if (enUs) {
        ut.voice = enUs
        return
      }
      // Finally any English
      const enAny = voices.find(v => v.lang.startsWith('en'))
      if (enAny) ut.voice = enAny
    }
    
    setVoice()
    if (!ut.voice) {
      window.speechSynthesis.onvoiceschanged = () => {
        if (token !== webSpeechToken) return
        setVoice()
        window.speechSynthesis.onvoiceschanged = null
        window.speechSynthesis.speak(ut)
      }
    } else {
      window.speechSynthesis.speak(ut)
    }
  } catch (err) {
    console.error('Web Speech API error:', err)
  }
}

async function playAudioUrl(url: string, token: number, word: string): Promise<void> {
  if (!url) return
  if (token !== speakRequestToken) return

  try {
    if (!currentAudio) {
      currentAudio = new Audio()
      currentAudio.volume = 1.0
      currentAudio.preload = 'auto'
    }

    // Stop any current playback
    currentAudio.pause()
    currentAudio.currentTime = 0

    const normalizedUrl = normalizeAudioUrl(url)
    currentAudio.src = normalizedUrl
    currentAudio.onerror = () => {
      // If user already clicked something else, do nothing
      if (token !== speakRequestToken) return
      console.warn('Audio playback failed, falling back to Web Speech')
      speakWithWebSpeech(word)
    }

    // If another speak() happens while awaiting play, ignore results.
    await currentAudio.play()
  } catch (err) {
    if (token !== speakRequestToken) return
    console.warn('Audio playback failed, falling back to Web Speech:', err)
    speakWithWebSpeech(word)
  }
}

/**
 * Speak a word using Web Speech API (consistent voice)
 */
export async function speakWord(word: string): Promise<void> {
  const clean = normalizeWord(word)
  if (!clean) return

  // Stop current playback immediately
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
  }
  window.speechSynthesis.cancel()
  window.speechSynthesis.onvoiceschanged = null

  // Use Web Speech API directly for consistent voice
  speakWithWebSpeech(clean)
}

/**
 * Stop any currently playing speech
 */
export function stopSpeaking(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
  }
  window.speechSynthesis.cancel()
  window.speechSynthesis.onvoiceschanged = null
  webSpeechToken += 1
}

/**
 * Preload audio for a word (no-op now since using Web Speech API)
 */
export function preloadAudio(word: string): void {
  // No-op - Web Speech API doesn't need preloading
}

/**
 * Clear the audio cache (no-op now since using Web Speech API)
 */
export function clearAudioCache(): void {
  audioCache.clear()
}
