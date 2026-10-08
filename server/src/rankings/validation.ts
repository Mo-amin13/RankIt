export type NormalizedRankingItem = {
  name: string
  imageUrl?: string
}

export type ValidatedCreateRankingInput = {
  title: string
  items: NormalizedRankingItem[]
}

export type ValidationErrorCode =
  | "INVALID_TITLE"
  | "INVALID_ITEMS"
  | "INVALID_ITEM_NAME"
  | "INVALID_IMAGE_URL"
  | "DUPLICATE_ITEM_NAME"

// Limits on trimmed lengths. Long enough for any real title or name, short
// enough that one ranking cannot bloat the database or break the layout.
export const MAX_TITLE_LENGTH = 100
export const MAX_ITEM_NAME_LENGTH = 100
export const MAX_IMAGE_URL_LENGTH = 2048

type ValidationError = {
  code: ValidationErrorCode
  message: string
}

export type CreateRankingValidationResult =
  | { ok: true; value: ValidatedCreateRankingInput }
  | { ok: false; error: ValidationError }

type NamedItemInput = Record<string, unknown> & {
  name: string
}

function failure(
  code: ValidationErrorCode,
  message: string
): CreateRankingValidationResult {
  return { ok: false, error: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isNamedItem(value: unknown): value is NamedItemInput {
  return isRecord(value) && typeof value.name === "string" && value.name.trim() !== ""
}

function hasTooLongName(item: NamedItemInput): boolean {
  return item.name.trim().length > MAX_ITEM_NAME_LENGTH
}

function hasInvalidImageUrl(item: NamedItemInput): boolean {
  const imageUrl = item.imageUrl

  if (imageUrl === undefined) {
    return false
  }

  if (typeof imageUrl !== "string") {
    return true
  }

  const trimmedImageUrl = imageUrl.trim()

  if (trimmedImageUrl === "") {
    return false
  }

  if (trimmedImageUrl.length > MAX_IMAGE_URL_LENGTH) {
    return true
  }

  try {
    return new URL(trimmedImageUrl).protocol !== "https:"
  } catch {
    return true
  }
}

export function validateCreateRankingInput(
  input: unknown
): CreateRankingValidationResult {
  if (!isRecord(input)) {
    return failure("INVALID_TITLE", "Enter a valid ranking title.")
  }

  const { title, items } = input

  if (typeof title !== "string" || title.trim() === "") {
    return failure("INVALID_TITLE", "Enter a valid ranking title.")
  }

  if (title.trim().length > MAX_TITLE_LENGTH) {
    return failure(
      "INVALID_TITLE",
      `Keep the title to ${MAX_TITLE_LENGTH} characters or fewer.`
    )
  }

  if (!Array.isArray(items) || items.length < 3 || items.length > 40) {
    return failure("INVALID_ITEMS", "Provide between 3 and 40 items.")
  }

  if (!items.every(isNamedItem)) {
    return failure("INVALID_ITEM_NAME", "Every item must have a name")
  }

  if (items.some(hasTooLongName)) {
    return failure(
      "INVALID_ITEM_NAME",
      `Keep item names to ${MAX_ITEM_NAME_LENGTH} characters or fewer.`
    )
  }

  if (items.some(hasInvalidImageUrl)) {
    return failure(
      "INVALID_IMAGE_URL",
      "Please enter a valid image URL or leave it empty."
    )
  }

  const normalizedItems: NormalizedRankingItem[] = items.map((item) => {
    const imageUrl = typeof item.imageUrl === "string" ? item.imageUrl.trim() : ""

    return {
      name: item.name.trim(),
      ...(imageUrl === "" ? {} : { imageUrl })
    }
  })

  const comparableNames = normalizedItems.map((item) => item.name.toLowerCase())
  const uniqueNames = new Set(comparableNames)

  if (uniqueNames.size !== comparableNames.length) {
    return failure("DUPLICATE_ITEM_NAME", "No duplicates are allowed.")
  }

  return {
    ok: true,
    value: {
      title: title.trim(),
      items: normalizedItems
    }
  }
}
