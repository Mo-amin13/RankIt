import { describe, expect, it } from "vitest"

import {
  MAX_IMAGE_URL_LENGTH,
  MAX_ITEM_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  validateCreateRankingInput
} from "../../src/rankings/validation.js"

const validItems = [
  { name: "Arrival" },
  { name: "The Matrix" },
  { name: "Dune" }
]

describe("validateCreateRankingInput", () => {
  it("normalizes a valid ranking request", () => {
    const result = validateCreateRankingInput({
      title: "  Favorite movies  ",
      items: [
        {
          name: "  Arrival  ",
          imageUrl: "  https://example.com/arrival.jpg  ",
          ignored: "client-controlled value"
        },
        { name: "The Matrix", imageUrl: "   " },
        { name: " Dune " }
      ]
    })

    expect(result).toEqual({
      ok: true,
      value: {
        title: "Favorite movies",
        items: [
          { name: "Arrival", imageUrl: "https://example.com/arrival.jpg" },
          { name: "The Matrix" },
          { name: "Dune" }
        ]
      }
    })
  })

  it.each([undefined, null, 42, {}, { title: "   ", items: validItems }])(
    "rejects an invalid title from %#",
    (input) => {
      expect(validateCreateRankingInput(input)).toMatchObject({
        ok: false,
        error: { code: "INVALID_TITLE" }
      })
    }
  )

  it.each([
    undefined,
    [],
    validItems.slice(0, 2),
    Array.from({ length: 41 }, (_, index) => ({ name: `Item ${index + 1}` }))
  ])("rejects an invalid item collection from %#", (items) => {
    expect(validateCreateRankingInput({ title: "Movies", items })).toMatchObject({
      ok: false,
      error: { code: "INVALID_ITEMS" }
    })
  })

  it.each([null, 42, {}, { name: 42 }, { name: "   " }])(
    "rejects an invalid item name from %#",
    (invalidItem) => {
      expect(
        validateCreateRankingInput({
          title: "Movies",
          items: [invalidItem, validItems[1], validItems[2]]
        })
      ).toMatchObject({
        ok: false,
        error: { code: "INVALID_ITEM_NAME" }
      })
    }
  )

  it("rejects names duplicated after trimming and case normalization", () => {
    const result = validateCreateRankingInput({
      title: "Movies",
      items: [{ name: "Arrival" }, { name: " arrival " }, { name: "Dune" }]
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "DUPLICATE_ITEM_NAME" }
    })
  })

  it.each([
    "http://example.com/image.jpg",
    "not a URL",
    42
  ])("rejects an invalid image URL from %#", (imageUrl) => {
    const result = validateCreateRankingInput({
      title: "Movies",
      items: [{ name: "Arrival", imageUrl }, validItems[1], validItems[2]]
    })

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_IMAGE_URL" }
    })
  })

  it("accepts the maximum of 40 uniquely named items", () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      name: `Item ${index + 1}`
    }))

    expect(validateCreateRankingInput({ title: "Forty items", items })).toMatchObject({
      ok: true,
      value: { items }
    })
  })

  describe("length limits", () => {
    function urlOfLength(length: number): string {
      const prefix = "https://example.com/"
      return prefix + "a".repeat(length - prefix.length)
    }

    it("accepts a title, item name and image URL exactly at the limit", () => {
      const result = validateCreateRankingInput({
        title: "T".repeat(MAX_TITLE_LENGTH),
        items: [
          { name: "N".repeat(MAX_ITEM_NAME_LENGTH), imageUrl: urlOfLength(MAX_IMAGE_URL_LENGTH) },
          validItems[1],
          validItems[2]
        ]
      })

      expect(result.ok).toBe(true)
    })

    it("measures length after trimming", () => {
      const result = validateCreateRankingInput({
        title: `   ${"T".repeat(MAX_TITLE_LENGTH)}   `,
        items: [{ name: `  ${"N".repeat(MAX_ITEM_NAME_LENGTH)}  ` }, validItems[1], validItems[2]]
      })

      expect(result.ok).toBe(true)
    })

    it("rejects a title one character over the limit", () => {
      expect(
        validateCreateRankingInput({ title: "T".repeat(MAX_TITLE_LENGTH + 1), items: validItems })
      ).toMatchObject({ ok: false, error: { code: "INVALID_TITLE" } })
    })

    it("rejects an item name one character over the limit", () => {
      expect(
        validateCreateRankingInput({
          title: "Movies",
          items: [validItems[0], { name: "N".repeat(MAX_ITEM_NAME_LENGTH + 1) }, validItems[2]]
        })
      ).toMatchObject({ ok: false, error: { code: "INVALID_ITEM_NAME" } })
    })

    it("rejects an image URL one character over the limit", () => {
      expect(
        validateCreateRankingInput({
          title: "Movies",
          items: [
            { name: "Arrival", imageUrl: urlOfLength(MAX_IMAGE_URL_LENGTH + 1) },
            validItems[1],
            validItems[2]
          ]
        })
      ).toMatchObject({ ok: false, error: { code: "INVALID_IMAGE_URL" } })
    })
  })
})
