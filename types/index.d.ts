export type BtwMessage = { role: 'io' | 'claude'; text: string }

export type BtwOption = { label: string; description?: string }

export type BtwQuestion = { question: string; header?: string; options: BtwOption[]; multiSelect?: boolean }

export type BtwPending = { id: string; questions: BtwQuestion[] }

export type BtwThread = {
  question: string
  options: BtwOption[]
  option: string
  messages: BtwMessage[]
  isBusy: boolean
  isFailed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'btw-opzioni': {
      pending: BtwPending | null
      threads: Record<string, BtwThread>
      tab: string | null
    }
  }
}
