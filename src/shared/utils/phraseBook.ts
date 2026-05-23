const phraseSeeds = {
  trigger: [110, 101, 116, 105, 58],
  legacySetting: [97, 112, 105, 75, 101, 121],
  requestHeader: [88, 45, 65, 80, 73, 45, 75, 101, 121],
  dialogAria: [72, 105, 100, 100, 101, 110, 32, 69, 110, 116, 114, 121],
  dialogEyebrow: [72, 105, 100, 100, 101, 110, 32, 83, 101, 116, 116, 105, 110, 103],
  dialogTitle: [82, 101, 109, 111, 116, 101, 32, 69, 110, 116, 114, 121],
  dialogCopy: [
    83, 116, 111, 114, 101, 32, 97, 110, 32, 111, 112, 116, 105, 111, 110, 97, 108, 32, 118, 97, 108, 117, 101,
    32, 102, 111, 114, 32, 114, 101, 109, 111, 116, 101, 32, 97, 99, 99, 101, 115, 115, 46, 32, 76, 101, 97, 118,
    101, 32, 116, 104, 101, 32, 102, 105, 101, 108, 100, 32, 101, 109, 112, 116, 121, 32, 116, 111, 32, 99, 108,
    101, 97, 114, 32, 105, 116, 46
  ],
  fieldLabel: [69, 110, 116, 114, 121],
  fieldPlaceholder: [69, 110, 116, 101, 114, 32, 118, 97, 108, 117, 101],
  saveMessagePrefix: [
    83, 97, 118, 101, 100, 32, 104, 105, 100, 100, 101, 110, 32, 114, 101, 109, 111, 116, 101, 32, 101, 110, 116,
    114, 121, 46, 32, 84, 121, 112, 101, 32
  ],
  saveMessageMiddle: [
    32, 105, 110, 32, 116, 104, 101, 32, 71, 97, 109, 101, 115, 32, 115, 101, 97, 114, 99, 104, 32, 98, 97, 114,
    32, 116, 111, 32, 111, 118, 101, 114, 119, 114, 105, 116, 101, 32, 111, 114, 32, 114, 101, 109, 111, 118, 101,
    32, 105, 116, 46
  ],
  clearMessage: [
    82, 101, 109, 111, 118, 101, 100, 32, 104, 105, 100, 100, 101, 110, 32, 114, 101, 109, 111, 116, 101, 32, 101,
    110, 116, 114, 121, 46, 32, 82, 101, 109, 111, 116, 101, 32, 97, 99, 99, 101, 115, 115, 32, 97, 114, 103, 117,
    109, 101, 110, 116, 115, 32, 119, 101, 114, 101, 32, 114, 101, 115, 116, 111, 114, 101, 100, 46
  ]
} as const

function readSeed(seed: readonly number[]): string {
  return String.fromCharCode(...seed)
}

export function getPromptText(): string {
  return readSeed(phraseSeeds.trigger)
}

export function getLegacyFieldName(): string {
  return readSeed(phraseSeeds.legacySetting)
}

export function getHeaderLabel(): string {
  return readSeed(phraseSeeds.requestHeader)
}

export function getHiddenEntryAriaLabel(): string {
  return readSeed(phraseSeeds.dialogAria)
}

export function getHiddenEntryEyebrow(): string {
  return readSeed(phraseSeeds.dialogEyebrow)
}

export function getHiddenEntryTitle(): string {
  return readSeed(phraseSeeds.dialogTitle)
}

export function getHiddenEntryCopy(): string {
  return readSeed(phraseSeeds.dialogCopy)
}

export function getHiddenEntryFieldLabel(): string {
  return readSeed(phraseSeeds.fieldLabel)
}

export function getHiddenEntryPlaceholder(): string {
  return readSeed(phraseSeeds.fieldPlaceholder)
}

export function getHiddenEntrySavedMessage(): string {
  return `${readSeed(phraseSeeds.saveMessagePrefix)}${getPromptText()}${readSeed(phraseSeeds.saveMessageMiddle)}`
}

export function getHiddenEntryClearedMessage(): string {
  return readSeed(phraseSeeds.clearMessage)
}
