import vaultOrbitHero from './assets/fallback-art/vault-orbit-hero.svg'
import vaultOrbitGallery from './assets/fallback-art/vault-orbit-gallery.svg'
import vaultOrbitCover from './assets/fallback-art/vault-orbit-cover.svg'
import signalGridHero from './assets/fallback-art/signal-grid-hero.svg'
import signalGridGallery from './assets/fallback-art/signal-grid-gallery.svg'
import signalGridCover from './assets/fallback-art/signal-grid-cover.svg'
import emberPortalHero from './assets/fallback-art/ember-portal-hero.svg'
import emberPortalGallery from './assets/fallback-art/ember-portal-gallery.svg'
import emberPortalCover from './assets/fallback-art/ember-portal-cover.svg'
import pulseArrayHero from './assets/fallback-art/pulse-array-hero.svg'
import pulseArrayGallery from './assets/fallback-art/pulse-array-gallery.svg'
import pulseArrayCover from './assets/fallback-art/pulse-array-cover.svg'
import prismTiltHero from './assets/fallback-art/prism-tilt-hero.svg'
import prismTiltGallery from './assets/fallback-art/prism-tilt-gallery.svg'
import prismTiltCover from './assets/fallback-art/prism-tilt-cover.svg'

export type FallbackArtworkVariant = 'hero' | 'cover' | 'gallery'

type FallbackArtworkSet = {
  id: string
  hero: string
  cover: string
  gallery: string
}

const fallbackArtworkSets: FallbackArtworkSet[] = [
  { id: 'vault-orbit', hero: vaultOrbitHero, cover: vaultOrbitCover, gallery: vaultOrbitGallery },
  { id: 'signal-grid', hero: signalGridHero, cover: signalGridCover, gallery: signalGridGallery },
  { id: 'ember-portal', hero: emberPortalHero, cover: emberPortalCover, gallery: emberPortalGallery },
  { id: 'pulse-array', hero: pulseArrayHero, cover: pulseArrayCover, gallery: pulseArrayGallery },
  { id: 'prism-tilt', hero: prismTiltHero, cover: prismTiltCover, gallery: prismTiltGallery }
]

function hashArtworkKey(value: string): number {
  let hash = 0

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }

  return hash
}

function getFallbackArtworkSet(key: string | null | undefined): FallbackArtworkSet {
  const normalizedKey = key?.trim().toLowerCase()

  if (!normalizedKey) {
    return fallbackArtworkSets[0]
  }

  return fallbackArtworkSets[hashArtworkKey(normalizedKey) % fallbackArtworkSets.length]
}

export function getFallbackArtworkUri(key: string | null | undefined, variant: FallbackArtworkVariant): string {
  return getFallbackArtworkSet(key)[variant]
}
