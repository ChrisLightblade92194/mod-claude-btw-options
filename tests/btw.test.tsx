import { expect, test } from 'claude-code/testing'

declare const setTimeout: (fn: () => void, ms: number) => unknown

const PLUGIN = 'btw-opzioni'
const QUESTIONS = [
  {
    question: 'Quale database usiamo?',
    header: 'DB',
    multiSelect: false,
    options: [
      { label: 'Postgres', description: 'Server relazionale' },
      { label: 'SQLite', description: 'File locale' },
    ],
  },
]
const CACHE = [
  {
    question: 'Che cache usiamo?',
    header: 'Cache',
    multiSelect: false,
    options: [
      { label: 'Redis', description: 'Cache esterna condivisa' },
      { label: 'In memoria', description: 'Cache nel processo' },
    ],
  },
]
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const PANE_PROPS = { title: 'btw', isFocused: true, bodyColumns: 60, placement: 'dock' } as never

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise<void>(r => setTimeout(r, 5))
  expect(condition()).toBe(true)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: tab interni raggruppati per domanda, apertura solo a risposta riuscita, riprova, chiusura di gruppo`, async ($, on) => {
    const prompts: string[] = []
    const releases: (() => void)[] = []
    const opened: string[] = []
    const closed: string[] = []
    let calls = 0
    let answer: () => void = () => {}

    on('model.fork', async (_$, e) => {
      prompts.push(e.prompt)
      const n = prompts.length
      await new Promise<void>(resolve => releases.push(resolve))
      if (n === 2) return { value: { isAnswered: false as const, reason: 'empty-reply' as const, usage: USAGE } }
      return { value: { isAnswered: true as const, text: `Risposta ${n}`, usage: USAGE } }
    })
    on('ui.open', (_$, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } } as never
    })
    on('ui.close', (_$, e) => {
      closed.push(e.id)
      return { value: undefined } as never
    })
    on('tool.call', { tool: 'AskUserQuestion' }, async () => {
      calls++
      await new Promise<void>(resolve => (answer = resolve))
      return { result: { questions: QUESTIONS, answers: { 'Quale database usiamo?': 'SQLite' } } } as never
    })

    const call = $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    // Come nell'app: il pannello si disegna dopo che la mod ha registrato la domanda aperta.
    await until(() => calls === 1)
    expect(opened).toEqual([PLUGIN])
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
    expect(await pane.findAll({ type: 'Button' })).toHaveLength(2)

    // Due approfondimenti in parallelo: durante l'attesa la scheda mostra lo spinner, nessun bottone.
    const first = pane.press({ key: 'btw-0-1' })
    await until(() => prompts.length === 1)
    const second = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 2)
    expect(prompts[0]).toContain('«SQLite»')
    expect(prompts[0]).toContain('- Postgres: Server relazionale')
    expect(prompts[1]).toContain('«Postgres»')
    expect(await pane.find({ text: 'Sto chiedendo a Claude…' })).toBeDefined()
    expect(await pane.find({ key: 'btw-0-1' })).toBeUndefined()
    expect(await pane.find({ key: 'btw-0-0' })).toBeUndefined()
    expect(await pane.find({ text: '… SQLite' })).toBeDefined()
    expect(opened).toEqual([PLUGIN])

    // La stessa opzione non riparte mentre aspetta.
    expect(prompts).toHaveLength(2)

    releases[0]?.()
    releases[1]?.()
    await first
    await second

    // SQLite riuscito: «Apri approfondimento» porta al suo tab. Postgres fallito: «Riprova».
    expect((await pane.find({ key: 'btw-0-1' }))?.text).toContain('Apri approfondimento')
    expect((await pane.find({ key: 'btw-0-0' }))?.text).toContain('Riprova')
    expect(await pane.find({ text: 'Non riuscito' })).toBeDefined()
    await pane.press({ key: 'btw-0-1' })
    expect((await pane.find({ key: 'btw-0-1' }))?.text).toContain('Approfondimento aperto')
    expect(await pane.find({ text: 'Risposta 1' })).toBeDefined()

    // «Chiedi» invia quanto scritto nel campo.
    const field = (await pane.findAll({ type: 'Input' }))[0]
    expect(field).toBeDefined()
    await pane.input({ key: field!.key!, text: 'E se i dati crescono?', kind: 'change' })
    const followUp = pane.press({ key: 'send' })
    await until(() => prompts.length === 3)
    expect(prompts[2]).toContain('Io: E se i dati crescono?')
    expect(prompts[2]).toContain('Tu: Risposta 1')
    releases[2]?.()
    await followUp
    expect(await pane.find({ text: 'Risposta 3' })).toBeDefined()

    // Riprova rilancia l'opzione fallita.
    const retry = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 4)
    expect(prompts[3]).toContain('«Postgres»')
    releases[3]?.()
    await retry
    expect((await pane.find({ key: 'btw-0-0' }))?.text).toContain('Approfondimento aperto')
    expect(await pane.find({ text: 'Risposta 4' })).toBeDefined()

    // Chiudere un approfondimento lo toglie dai tab.
    await pane.press({ key: 'close-thread' })
    expect(await pane.find({ text: 'Risposta 4' })).toBeUndefined()
    expect((await pane.find({ key: 'btw-0-0' }))?.text).toContain('Approfondisci')

    answer()
    await call
    expect(closed).toEqual([])
    expect(await pane.find({ key: 'btw-0-1' })).toBeUndefined()
    expect(await pane.find({ text: 'Risposta 3' })).toBeDefined()

    // Una seconda domanda: i suoi tab finiscono in un gruppo a parte.
    const call2 = $.tool.call({ tool: 'AskUserQuestion', questions: CACHE })
    await until(() => calls === 2)
    const third = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 5)
    expect(prompts[4]).toContain('«Redis»')
    releases[4]?.()
    await third
    const groupClosers = async () =>
      (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('close-group-'))
    expect(await groupClosers()).toHaveLength(2)
    expect(await pane.find({ text: 'Quale database usiamo?' })).toBeDefined()
    expect(await pane.find({ text: 'Che cache usiamo?' })).toBeDefined()

    // La crocetta chiude il gruppo intero; chiuso l'ultimo, si chiude il pannello.
    await pane.press({ key: (await groupClosers())[0]!.key! })
    expect(await groupClosers()).toHaveLength(1)
    expect(await pane.find({ text: 'Risposta 3' })).toBeUndefined()
    expect(await pane.find({ text: 'Risposta 5' })).toBeDefined()
    answer()
    await call2
    expect(closed).toEqual([])
    await pane.press({ key: (await groupClosers())[0]!.key! })
    expect(closed).toEqual([PLUGIN])
  })
}
