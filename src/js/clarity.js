window.clarity = window.clarity || function () {
  (window.clarity.q = window.clarity.q || []).push(arguments)
}

const script = document.createElement('script')
script.async = true
script.src = 'https://www.clarity.ms/tag/yq1mx1084q'
script.addEventListener('error', () => {
  console.warn('[clarity] Analytics could not load; kiosk operation is unaffected.')
})
document.head.appendChild(script)
