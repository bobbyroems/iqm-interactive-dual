/*
 * Top narrative cards for Interference.
 *
 * Layout, copy, line breaks, emphasis colors, and diagram assets come from the
 * seven authored Interference frames in IQM Makeshift Internal.fig. The three
 * diagrams are the delivered animated clips, prepared by
 * scripts/prepare-panel-video.mjs.
 */

import { createKioskExplainer } from '../../core/kiosk-explainer.js'

const TOOLTIP_ASSET_ROOT = '/assets/modules/differences/interference-tooltips'

/* The three diagrams are delivered as animated clips. Each one draws its wave
   from an empty axis and clears back to it, so it returns to its own first
   frame and loops without the crossfade the one-shot panel clips need — see
   scripts/prepare-panel-video.mjs. The constructive and destructive panels come
   from a single master that draws both in sequence, cut on the blank frame
   between them. */
function graphic(filename, width, height, alt) {
  return Object.freeze({
    alt,
    height,
    src: `${TOOLTIP_ASSET_ROOT}/${filename}`,
    type: 'video',
    width
  })
}

export const LESSON_COPY = Object.freeze({
  intro: Object.freeze({
    body: 'How quantum computers use waves to amplify the more likely answers and cancel out less likely ones.',
    bodyHtml: 'How quantum computers use waves to<br><strong>amplify</strong> the more likely answers and<br><strong>cancel out</strong> less likely ones.',
    continue: false,
    graphic: null,
    title: 'Quantum interference'
  }),
  one: Object.freeze({
    body: 'Each wave is an instruction that moves through all possible answers at once.',
    bodyHtml: 'Each wave is an <strong>instruction</strong> that<br>moves through all possible<br>answers at once.',
    continue: true,
    graphic: graphic(
      'wave-probability.webm',
      808,
      639,
      'A probability wave rising from a horizontal axis.'
    ),
    title: 'Sea of Probabilities'
  }),
  bridge: Object.freeze({
    body: "But one wave isn't enough to isolate the right answer.",
    bodyHtml: "But one wave isn't enough to<br>isolate the right answer.",
    continue: false,
    graphic: null,
    title: ''
  }),
  constructive: Object.freeze({
    body: 'Where waves meet, they interfere and their heights combine. Peaks that line up amplify, while peaks and valleys cancel each other out.',
    bodyHtml: 'Where waves meet, they <strong>interfere</strong><br>and their heights combine. Peaks<br>that line up amplify, while peaks<br>and valleys cancel each other out.',
    continue: true,
    graphic: graphic(
      'constructive-interference.webm',
      800,
      639,
      'Aligned waves combining into constructive interference.'
    ),
    title: 'Interference'
  }),
  destructive: Object.freeze({
    body: 'Where waves meet, they interfere and their heights combine. Peaks that line up amplify, while peaks and valleys cancel each other out.',
    bodyHtml: 'Where waves meet, they <strong>interfere</strong><br>and their heights combine. Peaks<br>that line up amplify, while peaks<br>and valleys cancel each other out.',
    continue: true,
    graphic: graphic(
      'destructive-interference.webm',
      800,
      639,
      'Opposing waves combining into destructive interference.'
    ),
    title: 'Interference'
  }),
  add: Object.freeze({
    body: 'Adding more waves forces the wrong answers to sink so the true solution can rise up and stand out.',
    bodyHtml: 'Adding more waves forces the<br>wrong answers to sink so the <strong>true<br>solution can rise up</strong> and stand<br>out.',
    continue: false,
    graphic: null,
    title: 'Add more waves'
  })
})

function authoredBodyContent(html) {
  /* `bodyHtml` is a closed set of local authored strings. Parsing stays in the
     Interference adapter; the shared component only accepts safe DOM content. */
  const template = document.createElement('template')
  template.innerHTML = html
  return template.content
}

function createLessonPanel(key, copy) {
  const panel = createKioskExplainer({
    bodyAriaLabel: copy.body,
    bodyContent: authoredBodyContent(copy.bodyHtml),
    className: [
      'qvc-interference__lesson-panel',
      copy.graphic ? 'qvc-interference__lesson-panel--graphic' : ''
    ].filter(Boolean).join(' '),
    layout: copy.graphic ? 'split' : 'stacked',
    media: copy.graphic,
    title: copy.title,
    visible: true
  })
  panel.element.dataset.lessonStage = key
  panel.element.hidden = key !== 'intro'
  panel.copy.classList.add('qvc-interference__lesson-copy')
  panel.title.classList.add('qvc-interference__tooltip-title')
  panel.body.classList.add('qvc-interference__tooltip-description')
  panel.media.classList.add('qvc-interference__lesson-visual')
  return panel.element
}

/**
 * Starts the active panel's clip and stops every other one.
 *
 * The lesson switches panels by toggling `hidden` on them directly rather than
 * through the explainer's own visibility API, so the component's play-on-show
 * never fires here. Each clip is also rewound: a panel the visitor returns to
 * should draw its wave again from the empty axis rather than resume wherever it
 * was stopped, and its first frame is that empty axis, so a paused clip left
 * mid-animation would otherwise be the still they see.
 *
 * @param {Element} lesson root returned by createInterferenceLesson
 * @param {string|null} key active panel's stage key, null to stop all
 */
export function setLessonPlayback(lesson, key) {
  for (const panel of lesson.querySelectorAll('[data-lesson-stage]')) {
    const video = panel.querySelector('video')
    if (!video) continue
    if (panel.dataset.lessonStage === key) {
      video.currentTime = 0
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }
}

export function createInterferenceLesson() {
  const lesson = document.createElement('section')
  lesson.className = 'qvc-interference__lesson'
  lesson.dataset.lesson = ''
  lesson.hidden = true
  lesson.setAttribute('aria-hidden', 'true')
  lesson.toggleAttribute('inert', true)
  lesson.inert = true
  lesson.append(...Object.entries(LESSON_COPY).map(([key, copy]) => (
    createLessonPanel(key, copy)
  )))
  return lesson
}
