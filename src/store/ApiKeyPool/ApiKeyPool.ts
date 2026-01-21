// ApiKeyPool.ts - Multi API Key Management with Round-Robin Distribution
// Supports parallel requests across multiple API keys

export interface ApiKeyInfo {
  id: string
  name: string
  key: string
  maskedKey: string
  
  // Status tracking
  isActive: boolean
  lastUsed?: number
  lastError?: string
  lastErrorTime?: number
  
  // Rate limiting
  requestCount: number
  errorCount: number
  consecutiveErrors: number
  cooldownUntil?: number // timestamp when cooldown ends
  
  // Stats
  totalRequests: number
  totalErrors: number
  avgResponseTime: number
}

interface PendingRequest {
  id: string
  keyId: string
  startTime: number
}

const API_KEYS_STORAGE_KEY = 'api_keys_pool_v1'
const MAX_CONSECUTIVE_ERRORS = 3
const COOLDOWN_BASE_MS = 30000 // 30 seconds base cooldown
const COOLDOWN_MAX_MS = 300000 // 5 minutes max cooldown

class ApiKeyPoolClass {
  private keys: Map<string, ApiKeyInfo> = new Map()
  private activeKeyId: string | null = null
  private pendingRequests: Map<string, PendingRequest> = new Map()
  private roundRobinIndex = 0
  private concurrency = 4
  private listeners: Set<() => void> = new Set()
  private initialized = false

  constructor() {
    this.load()
  }

  private load() {
    try {
      const raw = localStorage.getItem(API_KEYS_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw)
        if (data.keys) {
          this.keys = new Map(Object.entries(data.keys))
        }
        if (data.activeKeyId) {
          this.activeKeyId = data.activeKeyId
        }
        if (data.concurrency) {
          this.concurrency = data.concurrency
        }
      }
      this.initialized = true
    } catch (e) {
      console.error('[ApiKeyPool] Failed to load:', e)
      this.keys = new Map()
      this.initialized = true
    }
  }

  private save() {
    try {
      const data: Record<string, ApiKeyInfo> = {}
      this.keys.forEach((v, k) => { data[k] = v })
      localStorage.setItem(API_KEYS_STORAGE_KEY, JSON.stringify({
        keys: data,
        activeKeyId: this.activeKeyId,
        concurrency: this.concurrency
      }))
    } catch (e) {
      console.error('[ApiKeyPool] Failed to save:', e)
    }
  }

  private notify() {
    this.listeners.forEach(fn => fn())
  }

  private maskKey(key: string): string {
    if (!key || key.length < 8) return '****'
    return key.slice(0, 4) + '****' + key.slice(-4)
  }

  private generateId(): string {
    return `key_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  // Subscribe to changes
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Get all keys
  getAllKeys(): ApiKeyInfo[] {
    return Array.from(this.keys.values())
  }

  // Get available keys (not in cooldown)
  getAvailableKeys(): ApiKeyInfo[] {
    const now = Date.now()
    return this.getAllKeys().filter(k => 
      k.isActive && (!k.cooldownUntil || k.cooldownUntil <= now)
    )
  }

  // Get active key ID
  getActiveKeyId(): string | null {
    return this.activeKeyId
  }

  // Get concurrency setting
  getConcurrency(): number {
    return this.concurrency
  }

  // Set concurrency
  setConcurrency(value: number) {
    this.concurrency = Math.max(1, Math.min(16, value))
    this.save()
    this.notify()
  }

  // Add a new key
  addKey(name: string, apiKey: string): ApiKeyInfo {
    const id = this.generateId()
    const keyInfo: ApiKeyInfo = {
      id,
      name: name.trim(),
      key: apiKey.trim(),
      maskedKey: this.maskKey(apiKey.trim()),
      isActive: true,
      requestCount: 0,
      errorCount: 0,
      consecutiveErrors: 0,
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0
    }

    this.keys.set(id, keyInfo)
    
    // If this is the first key, set it as active
    if (!this.activeKeyId) {
      this.activeKeyId = id
    }
    
    this.save()
    this.notify()
    return keyInfo
  }

  // Remove a key
  removeKey(id: string): boolean {
    const existed = this.keys.delete(id)
    if (existed) {
      if (this.activeKeyId === id) {
        // Set another key as active
        const remaining = this.getAllKeys()
        this.activeKeyId = remaining.length > 0 ? remaining[0].id : null
      }
      this.save()
      this.notify()
    }
    return existed
  }

  // Set active key
  setActiveKey(id: string): boolean {
    if (!this.keys.has(id)) return false
    this.activeKeyId = id
    this.save()
    this.notify()
    return true
  }

  // Clear active key (disable all)
  clearActiveKey() {
    this.activeKeyId = null
    this.save()
    this.notify()
  }

  // Get next key for request (round-robin among available keys)
  acquireKey(): ApiKeyInfo | null {
    const available = this.getAvailableKeys()
    if (available.length === 0) return null

    // Round-robin selection
    this.roundRobinIndex = (this.roundRobinIndex + 1) % available.length
    const selected = available[this.roundRobinIndex]
    
    // Update request count
    selected.requestCount++
    selected.lastUsed = Date.now()
    this.keys.set(selected.id, selected)
    
    return selected
  }

  // Get key for request (prefer less loaded keys)
  acquireKeyBalanced(): ApiKeyInfo | null {
    const available = this.getAvailableKeys()
    if (available.length === 0) return null

    // Sort by current pending requests (less loaded first)
    const pendingByKey = new Map<string, number>()
    this.pendingRequests.forEach(req => {
      pendingByKey.set(req.keyId, (pendingByKey.get(req.keyId) || 0) + 1)
    })

    available.sort((a, b) => {
      const pendingA = pendingByKey.get(a.id) || 0
      const pendingB = pendingByKey.get(b.id) || 0
      if (pendingA !== pendingB) return pendingA - pendingB
      // Tie-breaker: least errors
      return a.consecutiveErrors - b.consecutiveErrors
    })

    const selected = available[0]
    selected.requestCount++
    selected.lastUsed = Date.now()
    this.keys.set(selected.id, selected)
    
    return selected
  }

  // Start tracking a request
  startRequest(keyId: string): string {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.pendingRequests.set(requestId, {
      id: requestId,
      keyId,
      startTime: Date.now()
    })
    return requestId
  }

  // Complete a request successfully
  completeRequest(requestId: string) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return

    const key = this.keys.get(req.keyId)
    if (key) {
      const duration = Date.now() - req.startTime
      key.totalRequests++
      key.consecutiveErrors = 0
      key.cooldownUntil = undefined
      // Update average response time
      key.avgResponseTime = key.avgResponseTime 
        ? (key.avgResponseTime * 0.9 + duration * 0.1)
        : duration
      this.keys.set(key.id, key)
      this.save()
    }
    
    this.pendingRequests.delete(requestId)
  }

  // Report a request error
  reportError(requestId: string, error?: string, retryAfterMs?: number) {
    const req = this.pendingRequests.get(requestId)
    if (!req) return

    const key = this.keys.get(req.keyId)
    if (key) {
      key.totalErrors++
      key.errorCount++
      key.consecutiveErrors++
      key.lastError = error
      key.lastErrorTime = Date.now()

      // Apply cooldown if too many consecutive errors
      if (key.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS || retryAfterMs) {
        const cooldownMs = retryAfterMs || 
          Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * Math.pow(2, key.consecutiveErrors - 1))
        key.cooldownUntil = Date.now() + cooldownMs
        console.log(`[ApiKeyPool] Key ${key.name} in cooldown for ${cooldownMs}ms`)
      }
      
      this.keys.set(key.id, key)
      this.save()
    }
    
    this.pendingRequests.delete(requestId)
    this.notify()
  }

  // Reset error counts for a key
  resetKeyErrors(id: string) {
    const key = this.keys.get(id)
    if (key) {
      key.consecutiveErrors = 0
      key.errorCount = 0
      key.cooldownUntil = undefined
      key.lastError = undefined
      this.keys.set(id, key)
      this.save()
      this.notify()
    }
  }

  // Get current pending request count
  getPendingCount(): number {
    return this.pendingRequests.size
  }

  // Get status summary
  getStatus(): {
    totalKeys: number
    availableKeys: number
    activeKey: ApiKeyInfo | null
    pendingRequests: number
    concurrency: number
  } {
    return {
      totalKeys: this.keys.size,
      availableKeys: this.getAvailableKeys().length,
      activeKey: this.activeKeyId ? this.keys.get(this.activeKeyId) || null : null,
      pendingRequests: this.pendingRequests.size,
      concurrency: this.concurrency
    }
  }

  // Check if any key is available
  hasAvailableKey(): boolean {
    return this.getAvailableKeys().length > 0
  }

  // Execute a function with automatic key rotation and retry
  async executeWithKey<T>(
    fn: (apiKey: string, keyId: string) => Promise<T>,
    options?: {
      maxRetries?: number
      retryDelay?: number
    }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3
    const retryDelay = options?.retryDelay ?? 1000
    
    let lastError: Error | null = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const keyInfo = this.acquireKeyBalanced()
      if (!keyInfo) {
        throw new Error('No API keys available. Please add or check your API keys.')
      }

      const requestId = this.startRequest(keyInfo.id)
      
      try {
        const result = await fn(keyInfo.key, keyInfo.id)
        this.completeRequest(requestId)
        return result
      } catch (error: any) {
        lastError = error
        
        // Parse retry hint from error
        let retryAfterMs: number | undefined
        const errMsg = error?.message || String(error)
        const match = errMsg.match(/retry(?:\s*in)?\s*([0-9]+(?:\.[0-9]+)?)s/i)
        if (match) {
          retryAfterMs = Math.ceil(Number(match[1]) * 1000)
        }
        
        this.reportError(requestId, errMsg, retryAfterMs)
        
        // Wait before retry
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, retryDelay))
        }
      }
    }
    
    throw lastError || new Error('All retry attempts failed')
  }

  // Execute multiple requests in parallel with key distribution
  async executeParallel<T, R>(
    items: T[],
    fn: (item: T, apiKey: string, keyId: string) => Promise<R>,
    options?: {
      maxConcurrency?: number
      onProgress?: (completed: number, total: number) => void
    }
  ): Promise<Array<{ item: T; result?: R; error?: Error }>> {
    const maxConcurrency = options?.maxConcurrency ?? this.concurrency
    const results: Array<{ item: T; result?: R; error?: Error }> = []
    let completed = 0

    // Process in batches
    const processBatch = async (batch: T[]) => {
      return Promise.all(
        batch.map(async (item) => {
          try {
            const result = await this.executeWithKey((apiKey, keyId) => fn(item, apiKey, keyId))
            completed++
            options?.onProgress?.(completed, items.length)
            return { item, result }
          } catch (error) {
            completed++
            options?.onProgress?.(completed, items.length)
            return { item, error: error as Error }
          }
        })
      )
    }

    // Split into batches and process
    for (let i = 0; i < items.length; i += maxConcurrency) {
      const batch = items.slice(i, i + maxConcurrency)
      const batchResults = await processBatch(batch)
      results.push(...batchResults)
    }

    return results
  }
}

// Singleton instance
export const ApiKeyPool = new ApiKeyPoolClass()

// React hook for subscribing to pool changes
export function useApiKeyPool() {
  const [, forceUpdate] = React.useState({})
  
  React.useEffect(() => {
    return ApiKeyPool.subscribe(() => forceUpdate({}))
  }, [])
  
  return ApiKeyPool
}

// Need to import React for the hook
import React from 'react'
