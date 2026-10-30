export type BtwMessage = { role: 'io' | 'claude'; text: string }

export type BtwOption = { label: string; description?: string }

export type BtwQuestion = { question: string; header?: string; options: BtwOption[]; multiSelect?: boolean }

// Una chiamata ad AskUserQuestion, o una scelta del riquadro di fine turno (`box`, con il suo riepilogo):
// le sue domande e, una volta chiusa, le risposte (testo della domanda -> risposta).
export type BtwAsked = {
  questions: BtwQuestion[]
  answers: Record<string, string>
  isAnswered: boolean
  box?: { recap: string }
}

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
      asked: Record<string, BtwAsked>
      shown: string | null
      threads: Record<string, BtwThread>
      tab: string | null
    }
  }
}
