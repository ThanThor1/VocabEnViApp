// Sound effects for the app
// Uses Web Audio API for lightweight, instant sound playback

type SoundType = 
  | 'correct'      // Trả lời đúng
  | 'incorrect'    // Trả lời sai
  | 'complete'     // Hoàn thành (dịch xong, học xong, etc.)
  | 'click'        // Click nhẹ
  | 'success'      // Thành công lớn (hoàn thành phiên học)
  | 'notification' // Thông báo
  | 'pop'          // Pop sound nhẹ

class SoundManager {
  private audioContext: AudioContext | null = null
  private enabled: boolean = true
  private volume: number = 0.5

  constructor() {
    // Load settings from localStorage
    const savedEnabled = localStorage.getItem('sound_enabled')
    const savedVolume = localStorage.getItem('sound_volume')
    
    if (savedEnabled !== null) {
      this.enabled = savedEnabled === 'true'
    }
    if (savedVolume !== null) {
      this.volume = parseFloat(savedVolume) || 0.5
    }
  }

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    return this.audioContext
  }

  private playTone(frequency: number, duration: number, type: OscillatorType = 'sine', volumeMultiplier: number = 1) {
    if (!this.enabled) return
    
    try {
      const ctx = this.getContext()
      const oscillator = ctx.createOscillator()
      const gainNode = ctx.createGain()
      
      oscillator.connect(gainNode)
      gainNode.connect(ctx.destination)
      
      oscillator.frequency.value = frequency
      oscillator.type = type
      
      const vol = this.volume * volumeMultiplier
      gainNode.gain.setValueAtTime(vol, ctx.currentTime)
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
      
      oscillator.start(ctx.currentTime)
      oscillator.stop(ctx.currentTime + duration)
    } catch (e) {
      // Ignore audio errors
    }
  }

  private playChord(frequencies: number[], duration: number, type: OscillatorType = 'sine') {
    frequencies.forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, duration, type, 0.5), i * 50)
    })
  }

  play(sound: SoundType) {
    if (!this.enabled) return

    switch (sound) {
      case 'correct':
        // Pleasant ascending two-note
        this.playTone(523.25, 0.1, 'sine') // C5
        setTimeout(() => this.playTone(659.25, 0.15, 'sine'), 80) // E5
        break
        
      case 'incorrect':
        // Low buzz
        this.playTone(200, 0.2, 'sawtooth', 0.3)
        break
        
      case 'complete':
        // Cheerful ding
        this.playTone(880, 0.15, 'sine') // A5
        break
        
      case 'click':
        // Soft click
        this.playTone(1000, 0.05, 'sine', 0.3)
        break
        
      case 'success':
        // Victory fanfare - ascending chord
        this.playTone(523.25, 0.15, 'sine') // C5
        setTimeout(() => this.playTone(659.25, 0.15, 'sine'), 100) // E5
        setTimeout(() => this.playTone(783.99, 0.2, 'sine'), 200) // G5
        setTimeout(() => this.playTone(1046.50, 0.3, 'sine'), 300) // C6
        break
        
      case 'notification':
        // Soft two-tone notification
        this.playTone(600, 0.1, 'sine', 0.4)
        setTimeout(() => this.playTone(800, 0.15, 'sine', 0.4), 100)
        break
        
      case 'pop':
        // Quick pop
        this.playTone(400, 0.08, 'sine', 0.4)
        break
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    localStorage.setItem('sound_enabled', String(enabled))
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume))
    localStorage.setItem('sound_volume', String(this.volume))
  }

  getVolume(): number {
    return this.volume
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled)
    return this.enabled
  }
}

// Singleton instance
export const soundManager = new SoundManager()

// Convenience function
export function playSound(sound: SoundType) {
  soundManager.play(sound)
}
