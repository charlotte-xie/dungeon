# Play-testing scenarios

Unit tests check that the prompts say what we mean. Only play shows what a model does with them. These scenarios are short scripted play-tests on a live model, used to check prompt changes against [the storytelling requirements](../storytelling.md) and to compare runs over time.

Each scenario file gives the premise to paste in, a script of inputs, what that scenario exercises, and the results of earlier runs.

| Scenario | Exercises |
|---|---|
| [Relic hunter](relic-hunter.md) | Fantasy crypt with a rival: fights, NPC ultimatums, plan drift, Continue |
| [Office romance](office-romance.md) | Modern and dialogue-led: subtext, slow pacing, the player's inner life, life-sim drift |

## Before you start

- Run the dev server with `pnpm dev` and open http://localhost:3003.
- The maintainer enters the API key in **Settings**. Agents never type, read, print or log a key. To check one is set, test only that it is non-empty, for example `!!localStorage.getItem('dm.xaiKey')` for the xAI preset.
- The baseline runs use the **xAI** preset: Responses API, grok-4.3, narrator reasoning off, Plotter reasoning low, with memory, the plot plan and OOC instructions on and live state off. Note any settings that differ in your report.
- Play spends tokens on the maintainer's account. Keep a run to an opening and four to six turns.
- Play transcripts are private writing: never commit them. Quote only the lines a finding needs.

## Driving the app

**By hand.** Open **Adventure › New adventure**, paste the scenario's brief and style guide, and begin. Type each input and press **Act**; press **Continue** for a Continue turn. The trace under each reply shows the Plotter's calls, the steer, timings and cached tokens, and **Inspect** shows the plan and memory.

**By script.** With a browser tool, paste the helper below into the page. It records each model request and response body (never the headers, so the key is never touched) and drives the app's own buttons. It assumes the Responses API and is lost when the page reloads.

```js
window.__run = []
const realFetch = window.fetch.bind(window)
window.fetch = async (url, init) => {
  if (!/\/responses$/.test(String(url)) || typeof init?.body !== 'string') return realFetch(url, init)
  const entry = { body: JSON.parse(init.body) }
  window.__run.push(entry)
  const started = performance.now()
  const res = await realFetch(url, init)
  entry.ms = Math.round(performance.now() - started)
  try { entry.response = await res.clone().json() } catch {}
  return res
}
const args = (c) => { try { return JSON.parse(c.arguments) } catch { return {} } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Endings that may hand the story back: questions, waiting, the player's turn or choice.
const HAND_BACK = /\?|\b(your|the) (call|move|turn)\b|\bchoices?\b|\b(is|are) yours\b|\byours to\b|up to you|unless you|\bwait(s|ing)?\b|\bawaits?\b|invites? (a )?repl|for (your|an) answer|hold(s)? (its|their|her|his) breath|\bdecid|what (will|do) you/i
// Dialogue that may offer the player an X-or-Y, anywhere in the reply.
const OFFER = /[“"][^”"]*(\bchoices?\b|\bor\b)[^”"]*[”"]/i
// One line per request: the Plotter's calls, plan changes and steer, or the narrator's text.
window.__report = (list) => list.map((e) => {
  const out = e.response?.output || []
  const calls = out.filter((o) => o.type === 'function_call')
  const text = out.filter((o) => o.type === 'message').flatMap((o) => o.content || []).map((c) => c.text || '').join('').trim()
  const usage = e.response?.usage
  const cache = usage ? `${usage.input_tokens_details?.cached_tokens ?? 0}/${usage.input_tokens}` : ''
  if (e.body.tools) return {
    role: 'plotter', ms: e.ms, cache,
    calls: calls.map((c) => c.name).join(','),
    proseInstead: !calls.length && text ? text.slice(0, 120) : undefined,
    plan: calls.filter((c) => c.name === 'future_plot_plan').map((c) => { const a = args(c); return `${a.op}${a.position ? ' ' + a.position : ''}${a.text ? ': ' + a.text : ''}` }),
    steer: calls.filter((c) => c.name === 'steer').map((c) => args(c).text).join(' | '),
  }
  const ending = (text.match(/[^.!?…]+[.!?…]+["”’]?/g) || [text]).slice(-2).join(' ').trim()
  return { role: 'narrator', ms: e.ms, cache, words: text.split(/\s+/).filter(Boolean).length, paragraphs: text.split(/\n\s*\n/).length, handBack: HAND_BACK.test(ending), offer: OFFER.test(text), sayPlayer: /\bthe player\b/i.test(text), ending, text }
})
window.__waitIdle = async () => {
  const t0 = Date.now()
  await sleep(1500)
  while (Date.now() - t0 < 38000 && document.querySelector('button[title^="Stop"]')) await sleep(1000)
  return !document.querySelector('button[title^="Stop"]')
}
const setText = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
// Start a new adventure; leave the arguments out to keep the current brief.
window.__begin = async (scenario, styleGuide) => {
  const start = window.__run.length
  ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Adventure')).click()
  await sleep(600)
  ;[...document.querySelectorAll('button, [role=menuitem]')].find((b) => b.textContent.trim() === 'New adventure').click()
  await sleep(600)
  const [scenarioBox, styleBox] = document.querySelectorAll('.modal textarea')
  if (scenario !== undefined) setText(scenarioBox, scenario)
  if (styleGuide !== undefined) setText(styleBox, styleGuide)
  await sleep(200)
  ;[...document.querySelectorAll('.modal button')].find((b) => /begin/i.test(b.textContent)).click()
  const done = await window.__waitIdle()
  return { done, report: window.__report(window.__run.slice(start)) }
}
// Play one turn: text to act, or null to press Continue.
window.__act = async (text) => {
  const start = window.__run.length
  if (text === null) {
    ;[...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Continue').at(-1).click()
  } else {
    setText(document.querySelector('textarea'), text)
    await sleep(200)
    ;[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Act').click()
  }
  const done = await window.__waitIdle()
  return { done, report: window.__report(window.__run.slice(start)) }
}
// The plan as the Plotter last saw it.
window.__planNow = () => window.__run.filter((e) => e.body.tools).at(-1)?.body.input
  .filter((m) => m.type === 'function_call_output').map((m) => String(m.output))
  .find((o) => /^1\. /.test(o))
```

Run one turn per call: `await __begin(brief, style)`, then `await __act('…')` or `await __act(null)`. Each call waits up to about 40 seconds; if `done` comes back false, call `await __waitIdle()` and read the turn with `__report(__run.slice(-2))`. The scripts are a shape to follow, not lines to paste blindly: adapt each input to what the story just did, keeping the kind of move the script asks for.

## What to record

For every reply:

- **Plotter:** its calls, the plan changes, and the steer. Note whether it wrote prose or typed its calls as text instead of making them, and whether the steer reminder fired.
- **Narrator:** words and paragraphs, every NPC line, and how the reply ends.
- **Timing and cache:** each role's time and cached tokens.

At the end, the plan as it stands and anything memory got wrong.

## What to look for

Check each reply against [the storytelling requirements](../storytelling.md). These are the failures seen so far.

**Endings and choices**

- The reply hands the story back: a question, an NPC's included ("Walk back with me?"); "Your choice." or "leaves the choice entirely yours"; "The first step is yours."; someone or something waiting ("The Vaults wait.", "the question implicit in the pause"). The helper flags endings like these as `handBack`, and dialogue with "or" or "choice" in it as `offer`; read each flagged reply yourself, since many flags are innocent.
- An NPC lays out the options in dialogue anywhere in the reply, even when the reply ends elsewhere: "Two choices. We go back together…, or we press on…".
- "The player" appears in the story itself, in narration or dialogue (`sayPlayer`): "She stops at the player's table", "Sam, keep the player on it".
- An NPC delivers an X-or-Y in dialogue: "Split what we can carry, or die alone." A terse line said on the move while the NPC acts ("Deeper or drown," already moving) is a character, not a menu; note it but don't count it.
- The same choice re-offered over several replies.

**Story movement**

- Micro actions: a fight or exchange running reply after reply, each ending on the next attack or the next line.
- A development replayed: the same thing lost, found or revealed twice.
- Continue that adds a beat instead of reaching a meaningful development: an outcome, a transition to a new scene, a consequence landing.
- Length: the brief asks for two or three paragraphs. Note standard replies of one paragraph, or of four and more.

**The player's character**

- After the player's own input, the reply should open with their move: what they did, briefly, and what they said, in their exact words. Note replies that open on someone else's response instead, paraphrase the player's speech, or echo the input word for word.
- The narrator moves, speaks or decides for the player ("You turn left."), or tells them what they feel. On Continue, moving the player along through routine is softer; still note it.

**The Plotter**

- Steers should describe what happens in the world. Flag steers that frame the player's decision ("must choose", "forcing a choice"), give writing instructions ("Keep the dialogue terse", "End ready for their next action") or move the player.
- The opening should set up memory and the plan on the first try, without the steer reminder.
- The plan should hold a few medium- and long-term directions. Flag entries that are just the current scene, completed or abandoned entries left in place, and good threads the story revealed that never entered the plan.
- Memory entries should start with `is`, and NPC goals should be recorded as `wants`.

**Mechanics**

- Each role's cached tokens should grow on warm turns. xAI misses some requests on its side; before blaming the provider, check that each role's request extends its previous one.
- The Plotter taking more than about 15 seconds.

## Reporting

1. A table with one row per reply: the input, NPC lines, how the reply ends, and any flags.
2. The plan as it built up, turn by turn.
3. The mechanism behind each failure, traced to the prompt text, plan or steer that caused it, before proposing any fix. The maintainer chooses the fix.
4. What the run didn't exercise.

Add a line to the scenario's results so the next run has a baseline.
