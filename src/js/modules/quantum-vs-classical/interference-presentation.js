import { INTERFERENCE_STAGES } from './interference-stages.js'

export const INTERFERENCE_TIPS = Object.freeze({
  [INTERFERENCE_STAGES.FIRST_SOURCE]: 'Tap on the glowing buoy to send out a wave',
  [INTERFERENCE_STAGES.FIRST_LESSON]: 'Tap anywhere to continue',
  [INTERFERENCE_STAGES.SECOND_SOURCE]: 'Tap the new buoy to send a second wave',
  [INTERFERENCE_STAGES.SECOND_LESSON]: 'Tap anywhere to continue.',
  [INTERFERENCE_STAGES.THIRD_LESSON]: 'Tap anywhere to continue.',
  [INTERFERENCE_STAGES.FIELD_SEQUENCE]:
    'Tap the glowing buoy till you reach the right answer'
})

/* The finale card, authored in the Interference frames. `lines` carries the
   designed line breaks; the panel is positioned against them, so letting the
   text wrap on its own re-ragged it. The rendered card and the spoken
   announcement previously each held their own copy of this string and could
   drift apart, so both now read it from here. */
export const INTERFERENCE_FINALE = Object.freeze({
  body: 'Through interference, quantum algorithms cancel out millions of wrong possibilities until only the correct answer rises to the top.',
  /* Re-ragged to four. The panel sets the body to nowrap so this array is the
     wrap, and after the copy change the widest of the three lines came to
     1099px against an 880px box — it simply ran out of the card. These four
     measure 851, 830, 737 and 681, and four lines at the body's 79.8px leading
     come to 319px, which the authored 320px box already holds. */
  lines: Object.freeze([
    'Quantum algorithms manipulate',
    'waves so wrong answers cancel',
    'and sink, leaving the correct',
    'solution to rise to the top.'
  ]),
  tip: 'Tap to finish',
  title: 'One true solution!'
})

export function getInterferencePresentation({
  stage,
  outcome = false
}) {
  if (outcome) {
    return Object.freeze({
      body: INTERFERENCE_FINALE.body,
      showTitle: true,
      tip: INTERFERENCE_FINALE.tip,
      title: INTERFERENCE_FINALE.title
    })
  }

  if (stage === INTERFERENCE_STAGES.RESOLVING) {
    return Object.freeze({
      body: '',
      showTitle: false,
      tip: null,
      title: ''
    })
  }

  return Object.freeze({
    body: '',
    showTitle: false,
    tip: INTERFERENCE_TIPS[stage] ?? null,
    title: ''
  })
}
