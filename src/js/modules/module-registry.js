export const MODULE_CATEGORIES = Object.freeze({
  nanoscale: {
    label: 'Nanoscale & qubits',
    color: '#1f9bff'
  },
  topological: {
    label: 'Topological quantum',
    color: '#9567ff'
  }
  /* "Readout & measurement" went with Module 08, its only member. */
})

/* Order is the visitor's route through the floor, set by IQM on 25 Aug: the
   principle first, then matter, then the device built up from it, and the scale
   comparison last. `number` is the printed label rather than the array index,
   because 07 is a slot whose module does not exist yet. */
/* Where a card title is broken across two lines on the 25 Aug board, the break
   is carried here rather than left to wrapping — the box is wide enough to fit
   "Protection of quantum information" on one line, so it would never break
   where the design breaks it. `title` stays the plain string: it is what the
   host's loading and error screens escape into their headings, and what the
   card announces to a screen reader. */
export const MODULES = Object.freeze([
  {
    id: 'quantum-vs-classical',
    displayWord: 'QUANTUM',
    number: '01',
    title: 'What makes quantum different?',
    titleHtml: 'What makes<br>quantum different?',
    summary: "Not a faster computer, a different one.",
    interaction: 'Principle activator and classical-versus-quantum comparison',
    category: 'topological',
    waitForPresentationReady: true,
    load: () => import('./quantum-vs-classical/index.js')
  },
  {
    id: 'states-of-matter',
    displayWord: 'MATTER',
    number: '02',
    title: 'A new state of matter',
    summary: 'Solid, liquid, gas... topoconductor.',
    interaction: 'Animation scrubber with state transitions',
    category: 'topological',
    load: () => import('./states-of-matter/index.js')
  },
  {
    id: 'qubit-explorer',
    displayWord: 'QUBIT',
    number: '03',
    title: 'Build a topoconductor',
    summary: 'Two materials. One superpower.',
    interaction: 'Drag, combine and explore interactive material layers',
    category: 'nanoscale',
    load: () => import('./qubit-explorer/index.js')
  },
  {
    id: 'protecting-information',
    displayWord: 'PROTECT',
    number: '04',
    title: 'Protection of quantum information',
    titleHtml: 'Protection of<br>quantum information',
    summary: 'A novel approach to quantum stability.',
    interaction: '3D device explorer, hotspots and adjustable parameters',
    category: 'nanoscale',
    preview: {
      kind: 'video',
      layout: 'portal',
      src: '/assets/modules/protecting-information/module-selection-screen.mp4'
    },
    load: () => import('./protecting-information/index.js')
  },
  {
    id: 'build-nanowire',
    displayWord: 'NANOWIRE',
    number: '05',
    title: 'Build a qubit',
    summary: 'Built one atom at a time',
    interaction: 'Swipe-built atomic layers, heat-map scan and magnified defect repair',
    category: 'nanoscale',
    waitForPresentationReady: true,
    load: () => import('./build-nanowire/index.js')
  },
  {
    id: 'build-majorana-2',
    displayWord: 'MAJORANA',
    number: '06',
    title: 'Build a Majorana 2',
    summary: "Inside Microsoft's breakthrough chip",
    interaction: 'Drag-and-drop 3D assembly, snapping and callouts',
    category: 'topological',
    preview: {
      src: '/assets/modules/build-majorana-2/majorana-intro-hero.png',
      alt: 'Majorana 2 quantum chip'
    },
    preview3d: { kind: 'majorana' },
    load: () => import('./build-majorana-2/index.js')
  },
  /* Slot 07 is still in production. A module with no `load` is a concept entry:
     the card renders as an FPO placeholder and cannot be opened. The last
     placeholder carried here was pulled for ending the carousel on an
     unexplained abstract sphere, so this one shows a plain marked-up slot
     instead of a generated shape, and 06's "Up next" banner skips it for 08. */
  {
    id: 'measurement-based',
    displayWord: 'FPO',
    number: '07',
    title: 'Measurement-based quantum computing',
    titleHtml: 'Measurement-based<br>quantum computing',
    summary: 'In production.',
    interaction: 'To be confirmed',
    category: 'topological',
    placeholder: true
  },
  {
    id: 'nanoscale',
    displayWord: 'NANO',
    number: '08',
    title: 'The scale of topological qubits',
    summary: 'A million qubits—in the palm of your hand.',
    interaction: 'Multi-level zoom, hotspots and scale comparison',
    category: 'nanoscale',
    waitForPresentationReady: true,
    load: () => import('./nanoscale/index.js')
  }
])

/** Whether a module can be entered, as opposed to being a placeholder slot. */
export function isPlayable(module) {
  return typeof module?.load === 'function'
}

/**
 * The module a visitor should be offered at the end of this one, or null at the
 * end of the run.
 *
 * Placeholder slots are skipped rather than special-cased, which is what makes
 * 06 offer 08 while 07 is still in production — IQM asked for that hop
 * explicitly, and it stops being a hop on its own once 07 ships.
 */
export function nextPlayableModule(moduleId) {
  const index = MODULES.findIndex(module => module.id === moduleId)
  if (index < 0) return null
  return MODULES.slice(index + 1).find(isPlayable) || null
}

export function getModule(moduleId) {
  return MODULES.find(module => module.id === moduleId) || null
}
