export const NANOWIRE_COLORS = Object.freeze({
  neutral: 0xd1d4d6,
  airborne: 0x6f8fe9,
  /* The broken atom reads red rather than white (IQM, 25 Aug): under the loupe
     a white core sat too close to the pale neutral atoms around it to be read
     as the faulty one. This is the palette's own error red lifted for a lit
     surface — `defect` itself is a maroon that goes muddy once the clearcoat
     is on it. The emissive follows it so the glow does not pull the core back
     towards beige. */
  defectCore: 0xd52b2f,
  defectCoreEmissive: 0x4a0d10,
  defect: 0xa70922,
  defectEmissive: 0x340008,
  repairedDefect: 0xd8f5df,
  correctionPulse: 0x10a95d,
  correctionPulseEmissive: 0x08703f
})

/* One satin ceramic-metal surface for both the navigation preview and the
   full experience. Story colours are applied on top of this identity; they
   never replace its roughness or clearcoat response. */
export const NANOWIRE_ATOM_SURFACE = Object.freeze({
  metalness: 0.025,
  roughness: 0.34,
  clearcoat: 0.3,
  clearcoatRoughness: 0.34,
  envMapIntensity: 1
})

/* The reference perturbation is a moving field across the complete lattice,
   not a radial marker around the defective atom. */
export const NANOWIRE_PERTURBED_FLOW_GRADIENT = Object.freeze([
  0xb90f2e,
  0xd52b2f,
  0xe95c2d,
  0xf2a72e,
  0xe8dc26,
  0xbddf24,
  0x72d936,
  0x25cc64,
  0x27c7a1
])

export const NANOWIRE_LOUPE_ERROR_GRADIENT = Object.freeze([
  0xffd99a,
  0xf29a73,
  0xe36b9d,
  0xcf55c4,
  0xad51d5,
  0x7b50ca,
  0x5145a8
])

export const NANOWIRE_LOUPE_CORRECTED_GRADIENT = Object.freeze([
  0x1f5fd0,
  0x2d70d8,
  0x4a87de,
  0x76a7e5,
  0x5a91df,
  0x386fce,
  0x2856b7
])

/* The finished wire, replacing the blue-to-lime flow it used to run (IQM,
   25 Aug). Both values are sampled from the finished wire on the design board:
   the body sits between #1C5FCB and #376ED6 across its lit faces, and the light
   passing through it reads around #8CC0EA. */
export const NANOWIRE_FINAL_FLOW_BASE = 0x1f5fd0
export const NANOWIRE_FINAL_FLOW_PULSE = 0x86cbe8
