import { createKioskExplainer, updateKioskExplainer } from './core/kiosk-explainer.js'
import { StageScaler } from './core/stage-scaler.js'

const DRAFT_ASSET_ROOT = '/assets/drafts/video-key/'

const clips = Object.freeze([
  {
    file: 'intro-reveal-alpha.webm',
    label: 'Intro reveal',
    source: 'TPT_Intro-Reveal_SHORT.mp4',
    title: 'Intro reveal po usunięciu czerni',
    body: 'Czarne tło zostało zamienione na płynną alfę. Jasne tło aplikacji ujawnia jednak ciemne obwódki wynikające z kompresji H.264.'
  },
  {
    file: 'add-on-fx-alpha.webm',
    label: 'Add-on FX',
    source: 'TPT_Add-on-FX.mp4',
    title: 'Dodatkowa warstwa świetlna',
    body: 'To materiał najbardziej zbliżony do klasycznej warstwy efektowej. Po kluczowaniu zachowuje niebieskie światło, a czarne pole znika.'
  },
  {
    file: 'electricity-pulses-alpha.webm',
    label: 'Electricity pulses',
    source: 'TPT_Electricicy_Pulses.mp4',
    title: 'Impulsy elektryczne',
    body: 'Żółte impulsy pozostają widoczne na jasnym tle, ale część miękkiej poświaty staje się subtelniejsza niż na czerni.'
  },
  {
    file: 'particles-a-alpha.webm',
    label: 'Particles A',
    source: 'TPT_PARTICLES-A.mp4',
    title: 'Cząsteczki — warstwa A',
    body: 'Cząsteczki dobrze oddzielają się od tła. Najciemniejsze piksele na ich krawędziach pozostają ograniczeniem źródłowego MP4.'
  },
  {
    file: 'particles-b-alpha.webm',
    label: 'Particles B',
    source: 'TPT_PARTICLES-B.mp4',
    title: 'Cząsteczki — warstwa B',
    body: 'Druga warstwa zachowuje niezależny ruch i może być nakładana osobno. Podgląd odtwarza tylko reprezentatywny fragment.'
  },
  {
    file: 'device-fade-top-alpha.webm',
    label: 'Device fade top',
    source: 'TPT_DeviceFadeTop.mp4',
    title: 'Górna część urządzenia',
    body: 'Klucz usuwa czarne pole, ale może naruszać bardzo ciemne detale samego urządzenia. To warstwa wymagająca eksportu z natywną alfą.'
  },
  {
    file: 'device-electrons-outro-alpha.webm',
    label: 'Device + electrons outro',
    source: 'Device_wElectrons+Electricity-OUTRO.mp4',
    title: 'Urządzenie i elektrony — outro',
    body: 'Pełny obiekt jest czytelny, lecz czarny matte był już wtopiony w krawędzie. Draft pokazuje realną jakość możliwą do odzyskania.'
  },
  {
    file: 'full-fx-outro-alpha.webm',
    label: 'Full FX outro',
    source: 'TPT_wFullFX-OUTRO.mp4',
    title: 'Pełny zestaw efektów — outro',
    body: 'Kompozycja odzyskuje przezroczyste tło, ale miękkie światło i ciemne elementy konkurują o ten sam zakres luminancji.'
  },
  {
    file: 'outro-dereveal-alpha.webm',
    label: 'Outro de-reveal',
    source: 'TPT_Outro-DeReveal_SHORT.mp4',
    title: 'Outro de-reveal',
    body: 'Krótka warstwa końcowa po kluczowaniu. Na jasnym tle dobrze widać, gdzie źródłowy H.264 pozostawił ciemny fringe.'
  },
  {
    file: 'nanowire-opaque.mp4',
    label: 'Nanowire inset — bez klucza',
    source: 'TPT_Nanowire_InsetWindow.mp4',
    title: 'Nanowire inset pozostaje nieprzezroczysty',
    body: 'Ten plik nie ma czarnego tła do usunięcia. Niebiesko-szare pole jest częścią obrazu, więc pokazujemy je bez kluczowania.'
  }
])

const backgrounds = Object.freeze([
  { id: 'app', label: 'Tło: aplikacja' },
  { id: 'checker', label: 'Tło: kontrola alfa' },
  { id: 'dark', label: 'Tło: ciemne' }
])

const stage = document.getElementById('kiosk-stage')
const surface = document.querySelector('.video-draft__surface')
const media = document.querySelector('[data-draft-media]')
const video = document.querySelector('[data-draft-video]')
const loading = document.querySelector('[data-draft-loading]')
const error = document.querySelector('[data-draft-error]')
const select = document.querySelector('[data-draft-select]')
const status = document.querySelector('[data-draft-status]')
const playButton = document.querySelector('[data-draft-action="play"]')
const backgroundButton = document.querySelector('[data-draft-action="background"]')

let activeIndex = 0
let backgroundIndex = 0
let loadSequence = 0

const explainer = createKioskExplainer({
  className: 'video-draft__explainer',
  headingLevel: 1,
  title: clips[0].title,
  body: clips[0].body,
  visible: true,
  ariaHidden: false
})
document.querySelector('[data-draft-explainer]').append(explainer.element)

for (const [index, clip] of clips.entries()) {
  const option = document.createElement('option')
  option.value = String(index)
  option.textContent = clip.label
  select.append(option)
}

function setPlayButton(paused) {
  playButton.textContent = paused ? 'Odtwórz' : 'Pauza'
  playButton.setAttribute('aria-pressed', String(paused))
}

async function loadClip(index) {
  activeIndex = (index + clips.length) % clips.length
  const clip = clips[activeIndex]
  const sequence = ++loadSequence

  select.value = String(activeIndex)
  media.classList.remove('is-ready')
  loading.hidden = false
  error.hidden = true
  status.textContent = `Źródło: ${clip.source}`
  updateKioskExplainer(explainer, {
    title: clip.title,
    body: clip.body,
    visible: true,
    ariaHidden: false
  })

  video.pause()
  video.src = `${DRAFT_ASSET_ROOT}${clip.file}`
  video.load()

  try {
    await new Promise((resolve, reject) => {
      const onReady = () => resolve()
      const onError = () => reject(new Error('Nie udało się odczytać lokalnego pliku podglądu.'))
      video.addEventListener('loadeddata', onReady, { once: true })
      video.addEventListener('error', onError, { once: true })
    })
    if (sequence !== loadSequence) return
    await video.play()
    media.classList.add('is-ready')
    loading.hidden = true
    setPlayButton(false)
  } catch (loadError) {
    if (sequence !== loadSequence) return
    loading.hidden = true
    error.textContent = `${loadError.message} Uruchom ponownie generator draftów i odśwież stronę.`
    error.hidden = false
    setPlayButton(true)
  }
}

function changeBackground() {
  backgroundIndex = (backgroundIndex + 1) % backgrounds.length
  const background = backgrounds[backgroundIndex]
  surface.dataset.draftBackground = background.id
  backgroundButton.textContent = background.label
}

document.querySelector('[data-draft-action="previous"]').addEventListener('click', () => {
  void loadClip(activeIndex - 1)
})

document.querySelector('[data-draft-action="next"]').addEventListener('click', () => {
  void loadClip(activeIndex + 1)
})

playButton.addEventListener('click', async () => {
  if (video.paused) {
    try {
      await video.play()
      setPlayButton(false)
    } catch {
      setPlayButton(true)
    }
  } else {
    video.pause()
    setPlayButton(true)
  }
})

backgroundButton.addEventListener('click', changeBackground)

select.addEventListener('change', () => {
  void loadClip(Number(select.value))
})

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    video.pause()
    setPlayButton(true)
  }
})

new StageScaler({
  stage,
  designWidth: 2160,
  designHeight: 3840
}).start()

void loadClip(0)
