import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BtwOption, BtwQuestion, BtwThread } from '../types'

const PANE = 'btw-opzioni'
const TITLE = 'btw'
// Animato dal surface (SMIL): nessun ridisegno del pannello mentre gira.
const SPINNER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">' +
  '<circle cx="12" cy="12" r="9" fill="none" stroke="#d97757" stroke-opacity="0.25" stroke-width="3"/>' +
  '<path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="#d97757" stroke-width="3" stroke-linecap="round">' +
  '<animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.8s" repeatCount="indefinite"/>' +
  '</path></svg>'
const pending = atom({ plugin: 'btw-opzioni', key: 'pending' } as const, null)
const threads = atom({ plugin: 'btw-opzioni', key: 'threads' } as const, {})
const tab = atom({ plugin: 'btw-opzioni', key: 'tab' } as const, null)
const starting = new Set<string>()
// Il testo che si sta scrivendo nel campo di un tab: lo legge il bottone «Chiedi».
const drafts = new Map<string, string>()

function isQuestion(value: unknown): value is BtwQuestion {
  const q = value as BtwQuestion
  return typeof q?.question === 'string' && Array.isArray(q.options)
}

function forkPrompt(thread: BtwThread): string {
  const options = thread.options
    .map(o => `- ${o.label}${o.description ? `: ${o.description}` : ''}`)
    .join('\n')
  const [first, ...rest] = thread.messages
  const history = rest
    .map(m => (m.role === 'io' ? `Io: ${m.text}` : `Tu: ${m.text}`))
    .join('\n\n')

  return [
    '[btw: domanda laterale, fuori dal filo principale della conversazione]',
    'Mi hai appena fatto questa domanda a scelta; il dialogo è ancora aperto e non ho ancora risposto.',
    `Domanda: ${thread.question}`,
    `Opzioni:\n${options}`,
    first?.text ?? '',
    history && `Seguito di questo approfondimento:\n${history}`,
    'Spiega in modo semplice e concreto, confrontando con le altre opzioni quando serve.',
    'Non scegliere al posto mio se non te lo chiedo, non usare strumenti, sii conciso e rispondi nella lingua della conversazione.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

// I tab si raggruppano per domanda d'origine: l'id di un thread è `<chiamata>:<domanda>:<opzione>`.
function groupByQuestion(all: Record<string, BtwThread>) {
  const groups = new Map<string, { key: string; question: string; ids: string[] }>()
  for (const [id, thread] of Object.entries(all)) {
    const key = id.slice(0, id.lastIndexOf(':'))
    const group = groups.get(key) ?? { key, question: thread.question, ids: [] }
    group.ids.push(id)
    groups.set(key, group)
  }
  return [...groups.values()]
}

async function ask($: EngineInterface, id: string, text: string) {
  let isSent = false
  await update($, threads, all => {
    const thread = all[id]
    isSent = thread !== undefined && !thread.isBusy
    if (!thread || thread.isBusy) return all
    return { ...all, [id]: { ...thread, isBusy: true, messages: [...thread.messages, { role: 'io' as const, text }] } }
  })
  const thread = (await read($, threads))[id]
  if (!isSent || !thread) return

  const reply = await $.model.fork({ prompt: forkPrompt(thread) })
  const answer = reply.isAnswered ? reply.text : `_Nessuna risposta (${reply.reason})._`
  await update($, threads, all => {
    const current = all[id]
    if (!current) return all
    return {
      ...all,
      [id]: {
        ...current,
        isBusy: false,
        isFailed: current.messages.length === 1 && !reply.isAnswered,
        messages: [...current.messages, { role: 'claude' as const, text: answer }],
      },
    }
  })
}

async function startOption($: EngineInterface, id: string, question: BtwQuestion, option: BtwOption) {
  // Un click ripetuto prima che il thread esista non deve lanciare una seconda richiesta.
  if (starting.has(id) || (await read($, threads))[id]) return
  starting.add(id)
  await update($, threads, all =>
    all[id]
      ? all
      : {
          ...all,
          [id]: {
            question: question.question,
            options: question.options,
            option: option.label,
            messages: [],
            isBusy: false,
            isFailed: false,
          },
        },
  )
  starting.delete(id)
  await update($, tab, () => id)
  await ask($, id, `Voglio capire meglio l'opzione «${option.label}»: cosa significa e cosa comporta sceglierla?`)
}

async function retryOption($: EngineInterface, id: string, question: BtwQuestion, option: BtwOption) {
  await update($, threads, all => {
    const { [id]: _failed, ...rest } = all
    return rest
  })
  await startOption($, id, question, option)
}

async function submit($: EngineInterface, id: string) {
  const text = drafts.get(id)?.trim()
  if (!text) return
  if ((await read($, threads))[id]?.isBusy) {
    $.ui.toast('btw: aspetta la risposta in corso, poi invia la domanda')
    return
  }
  drafts.delete(id)
  await ask($, id, text)
}

async function closeThreads($: EngineInterface, ids: readonly string[]) {
  for (const id of ids) drafts.delete(id)
  await update($, threads, all => Object.fromEntries(Object.entries(all).filter(([id]) => !ids.includes(id))))
  const rest = Object.keys(await read($, threads))
  await update($, tab, current => (current !== null && ids.includes(current) ? (rest[rest.length - 1] ?? null) : current))
  if (rest.length === 0 && (await read($, pending)) === null) await $.ui.close({ id: PANE })
}

export const register: Register = on => {
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const questions = (e.questions as readonly unknown[]).filter(isQuestion)
    if (questions.length === 0) return next(e)

    await update($, pending, () => ({ id: e.tool_use_id, questions }))
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    if (!opened.isPlaced) $.ui.toast(`btw-opzioni: pannello non mostrato (${opened.reason})`)

    try {
      return await next(e)
    } finally {
      await update($, pending, current => (current?.id === e.tool_use_id ? null : current))
      if (Object.keys(await read($, threads)).length === 0) await $.ui.close({ id: PANE })
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Markdown, Button } = els
    const Svg = 'Svg' in els ? els.Svg : undefined
    const Input = 'Input' in els ? els.Input : undefined
    const open = await read($, pending)
    const all = await read($, threads)
    const ids = Object.keys(all)
    const shown = await read($, tab)
    const activeId = shown && all[shown] ? shown : ids[ids.length - 1]
    const active = activeId ? all[activeId] : undefined

    const working = (key: string, text: string) => (
      <Box key={key} flexDirection="row" gap={1} alignItems="center">
        {Svg ? <Svg source={SPINNER_SVG} alt="In corso" width={16} height={16} isInteractive /> : <Text color="claude">⏳</Text>}
        <Text dimColor>{text}</Text>
      </Box>
    )

    if (!open && !active) return <Text dimColor>Nessuna domanda a scelta aperta.</Text>

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {open && (
          <Box key="options" flexDirection="column" gap={1}>
            <Text dimColor>Dubbi su un'opzione? Approfondiscila: la selezione nel dialogo resta.</Text>
            {open.questions.map((q, qi) => (
              <Box key={`q-${qi}`} flexDirection="column" gap={1}>
                <Text>
                  {q.header && <Text bold color="claude">{q.header} · </Text>}
                  <Text bold>{q.question}</Text>
                </Text>
                {q.options.map((option, oi) => {
                  const id = `${open.id}:${qi}:${oi}`
                  const key = `btw-${qi}-${oi}`
                  const thread = all[id]
                  const isWaiting = thread !== undefined && thread.messages.length < 2
                  const isReady = thread !== undefined && !isWaiting && !thread.isFailed

                  return (
                    <Box
                      key={`card-${qi}-${oi}`}
                      flexDirection="column"
                      borderStyle="round"
                      borderColor={isReady ? 'claude' : 'subtle'}
                      paddingX={1}
                    >
                      <Text bold>{option.label}</Text>
                      {option.description && <Text dimColor>{option.description}</Text>}
                      <Box marginTop={1} flexDirection="row" gap={2} alignItems="center">
                        {!thread && (
                          <Button key={key} label="? Approfondisci" onPress={() => void startOption($, id, q, option)} />
                        )}
                        {isWaiting && working(`${key}-busy`, 'Sto chiedendo a Claude…')}
                        {isReady && (
                          <Button
                            key={key}
                            label={activeId === id ? '✓ Approfondimento aperto' : 'Apri approfondimento'}
                            variant="primary"
                            onPress={() => void update($, tab, () => id)}
                          />
                        )}
                        {thread?.isFailed && <Text color="error">Non riuscito</Text>}
                        {thread?.isFailed && (
                          <Button key={key} label="↻ Riprova" onPress={() => void retryOption($, id, q, option)} />
                        )}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        )}

        {activeId && active && (
          <Box key="threads" flexDirection="column" gap={1}>
            <Text bold>Approfondimenti</Text>
            {groupByQuestion(all).map(group => (
              <Box key={`group-${group.key}`} flexDirection="column">
                <Box flexDirection="row" gap={1} alignItems="center">
                  <Box flexGrow={1} flexShrink={1}>
                    <Text dimColor>{group.question}</Text>
                  </Box>
                  <Button
                    key={`close-group-${group.key}`}
                    label="✕"
                    plain
                    dimColor
                    onPress={() => void closeThreads($, group.ids)}
                  />
                </Box>
                <Box flexDirection="row" flexWrap="wrap" gap={1}>
                  {group.ids.map(id => {
                    const thread = all[id]
                    if (!thread) return null
                    return (
                      <Button
                        key={`tab-${id}`}
                        label={thread.isBusy ? `… ${thread.option}` : thread.option}
                        variant={id === activeId ? 'primary' : undefined}
                        onPress={() => void update($, tab, () => id)}
                      />
                    )
                  })}
                </Box>
              </Box>
            ))}
            <Box flexDirection="column" gap={1} borderStyle="round" borderColor="claude" paddingX={1}>
              <Text dimColor>{active.question}</Text>
              <Text bold color="claude">{active.option}</Text>
              {active.messages.slice(1).map((m, i) =>
                m.role === 'io' ? (
                  <Text key={`m${i}`} bold>› {m.text}</Text>
                ) : (
                  <Markdown key={`m${i}`} text={m.text} />
                ),
              )}
              {active.isBusy && working('busy', 'Claude sta rispondendo…')}
              {Input && (
                <Box flexDirection="column" gap={1}>
                  <Input
                    key={`ask-${activeId}-${active.messages.filter(m => m.role === 'io').length}`}
                    placeholder="Altra domanda su questa opzione…"
                    onInput={text => void drafts.set(activeId, text)}
                    onSubmit={text => {
                      drafts.set(activeId, text)
                      void submit($, activeId)
                    }}
                  />
                  <Box flexDirection="row" gap={2}>
                    <Button key="send" label="Chiedi" variant="primary" onPress={() => void submit($, activeId)} />
                    <Button key="close-thread" label="Chiudi approfondimento" onPress={() => void closeThreads($, [activeId])} />
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
