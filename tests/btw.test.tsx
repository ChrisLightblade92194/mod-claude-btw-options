import { expect, test } from 'claude-code/testing'

declare const setTimeout: (fn: () => void, ms: number) => unknown

const PLUGIN = 'btw-opzioni'
const WRAP_UP = 'mcp__ccd_turn__wrap_up'
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

async function until(condition: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 200 && !(await condition()); i++) await new Promise<void>(r => setTimeout(r, 5))
  expect(await condition()).toBe(true)
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: tab interni raggruppati per domanda, riapertura delle domande passate, riprova, chiusura di gruppo`, async ($, on) => {
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
    expect(await pane.find({ text: 'Hai risposto: «SQLite»' })).toBeDefined()

    // Una domanda passata: il gruppo riapre le sue schede, anche per le opzioni non approfondite.
    const reopeners = async () =>
      (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('reopen-'))
    expect(await reopeners()).toHaveLength(1)
    await pane.press({ key: (await reopeners())[0]!.key! })
    expect(await pane.find({ text: 'Domanda già risposta: puoi ancora approfondire le sue opzioni.' })).toBeDefined()
    expect((await pane.find({ key: 'btw-0-1' }))?.text).toContain('Approfondimento aperto')
    expect((await pane.find({ key: 'btw-0-0' }))?.text).toContain('Approfondisci')
    const late = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 5)
    expect(prompts[4]).toContain('«Postgres»')
    expect(prompts[4]).toContain('ho già risposto: «SQLite»')
    expect(prompts[4]).not.toContain('non ho ancora risposto')
    releases[4]?.()
    await late
    expect(await pane.find({ text: 'Risposta 5' })).toBeDefined()
    await pane.press({ key: 'hide-options' })
    expect(await pane.find({ key: 'btw-0-0' })).toBeUndefined()
    expect(closed).toEqual([])

    // Una seconda domanda: i suoi tab finiscono in un gruppo a parte.
    const call2 = $.tool.call({ tool: 'AskUserQuestion', questions: CACHE })
    await until(() => calls === 2)
    const third = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 6)
    expect(prompts[5]).toContain('«Redis»')
    expect(prompts[5]).toContain('non ho ancora risposto')
    releases[5]?.()
    await third
    const groupClosers = async () =>
      (await pane.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('close-group-'))
    expect(await groupClosers()).toHaveLength(2)
    expect(await pane.find({ text: 'Quale database usiamo?' })).toBeDefined()
    expect(await pane.find({ text: 'Che cache usiamo?' })).toBeDefined()

    // Riaprire una domanda passata mentre un'altra è aperta, poi nasconderla, riporta alle schede di quella aperta.
    await pane.press({ key: (await reopeners())[0]!.key! })
    expect(await pane.find({ text: 'Domanda già risposta: puoi ancora approfondire le sue opzioni.' })).toBeDefined()
    await pane.press({ key: 'hide-options' })
    expect(await pane.find({ text: "Dubbi su un'opzione? Approfondiscila: la selezione nel dialogo resta." })).toBeDefined()

    // La crocetta chiude il gruppo intero; chiuso l'ultimo, si chiude il pannello.
    await pane.press({ key: (await groupClosers())[0]!.key! })
    expect(await groupClosers()).toHaveLength(1)
    expect(await pane.find({ text: 'Risposta 3' })).toBeUndefined()
    expect(await pane.find({ text: 'Risposta 6' })).toBeDefined()
    answer()
    await call2
    expect(closed).toEqual([])
    await pane.press({ key: (await groupClosers())[0]!.key! })
    expect(closed).toEqual([PLUGIN])
  })

  test(`${surface}: scelta del riquadro di fine turno`, async ($, on) => {
    const prompts: string[] = []
    const releases: (() => void)[] = []
    const opened: string[] = []
    const closed: string[] = []

    on('model.fork', async (_$, e) => {
      prompts.push(e.prompt)
      const n = prompts.length
      await new Promise<void>(resolve => releases.push(resolve))
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
    on('tool.call', { tool: WRAP_UP }, async () => ({ result: {} }) as never)
    on('prompt.submit', (_$, e) => ({ text: e.text }) as never)

    // Il riquadro resta dopo la chiamata: le schede compaiono, i bottoni dell'app (commit…) no.
    await $.tool.call({
      tool: WRAP_UP,
      recap: 'Lo schema della convenzione è pronto.',
      ask: 'Quale ambito per la prima versione?',
      actions: [
        { label: 'Prima la convenzione' },
        { label: 'Convenzione più tool', message: 'Fai la convenzione e anche il tool' },
        { action: 'commit' },
      ],
    } as never)
    expect(opened).toEqual([PLUGIN])
    const pane = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', requestId: PLUGIN, props: PANE_PROPS })
    expect(await pane.findAll({ type: 'Button' })).toHaveLength(2)
    expect(await pane.find({ text: "Dubbi su un'opzione? Approfondiscila: i bottoni del riquadro restano." })).toBeDefined()
    expect(await pane.find({ text: 'Fai la convenzione e anche il tool' })).toBeDefined()

    const first = pane.press({ key: 'btw-0-1' })
    await until(() => prompts.length === 1)
    expect(prompts[0]).toContain('«Convenzione più tool»')
    expect(prompts[0]).toContain('Domanda: Quale ambito per la prima versione?')
    expect(prompts[0]).toContain('- Prima la convenzione')
    expect(prompts[0]).toContain('riquadro di fine turno')
    expect(prompts[0]).toContain('non ho ancora risposto')
    expect(prompts[0]).toContain('Lo schema della convenzione è pronto.')
    releases[0]?.()
    await first

    // Il messaggio successivo chiude la scelta: un bottone del riquadro diventa la risposta.
    await $.prompt.submit({ text: 'Fai la convenzione e anche il tool' } as never)
    await until(async () => (await pane.find({ key: 'btw-0-0' })) === undefined)
    expect(await pane.find({ text: 'Hai risposto: «Convenzione più tool»' })).toBeDefined()
    expect(closed).toEqual([])
    const reopen = (await pane.findAll({ type: 'Button' })).find(b => b.key?.startsWith('reopen-'))
    await pane.press({ key: reopen!.key! })
    const late = pane.press({ key: 'btw-0-0' })
    await until(() => prompts.length === 2)
    expect(prompts[1]).toContain('ho già risposto: «Convenzione più tool»')
    releases[1]?.()
    await late
    await pane.press({ key: 'hide-options' })

    const closer = (await pane.findAll({ type: 'Button' })).find(b => b.key?.startsWith('close-group-'))
    await pane.press({ key: closer!.key! })
    expect(closed).toEqual([PLUGIN])

    // Un solo bottone, o nessuna domanda, non è una scelta da approfondire: il pannello non si apre.
    await $.tool.call({ tool: WRAP_UP, recap: 'Fatto.', ask: 'Faccio il push?', actions: [{ label: 'Sì, push' }] } as never)
    await $.tool.call({ tool: WRAP_UP, recap: 'Fatto.' } as never)
    expect(opened).toEqual([PLUGIN])
  })
}
