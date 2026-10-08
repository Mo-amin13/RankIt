import type { NewRankingInput } from "./api";
import type { RankingItem } from "./types";

// The list being edited before a ranking starts. The server checks all of
// this again; these checks only give faster feedback.

export const MIN_ITEMS = 3;
export const MAX_ITEMS = 40;
export const MAX_TITLE_LENGTH = 100;
export const MAX_ITEM_NAME_LENGTH = 100;
export const MAX_IMAGE_URL_LENGTH = 2048;

export function createEmptyItem(): RankingItem {
  return {
    id: crypto.randomUUID(),
    name: "",
    imageURL: "",
    imageStatus: "idle",
  };
}

const isValidImageURL = (url: string): boolean => {
  const trimmedurl = url.trim();
  if (trimmedurl === "") {
    return true;
  }
  try {
    const url = new URL(trimmedurl);
    if (url.protocol !== "https:") {
      return false;
    }
  } catch {
    return false;
  }
  return true;
};

// Returns the first problem with the draft, or null when it can be reviewed.
export function validateDraft(title: string, items: RankingItem[]): string | null {
  if (!title.trim()) {
    return "Title cannot be empty!";
  }

  if (items.length > MAX_ITEMS || items.length < MIN_ITEMS) {
    return `You must have between ${MIN_ITEMS} and ${MAX_ITEMS} items.`;
  }

  if (items.some((item) => !item.name.trim())) {
    return "All items must have a name";
  }

  const uniqueNames = new Set(items.map((item) => item.name.trim().toLowerCase()));

  if (uniqueNames.size !== items.length) {
    return "Item names must be unique";
  }

  if (items.some((item) => !isValidImageURL(item.imageURL))) {
    return "There was an error with the image URL";
  }

  if (items.some((item) => item.imageURL.trim() && item.imageStatus === "loading")) {
    return "Please wait for the images to finish loading.";
  }

  if (items.some((item) => item.imageURL.trim() && item.imageStatus === "error")) {
    return "An image could not be loaded. Replace its URL or remove it.";
  }

  return null;
}

export function toCreateInput(title: string, items: RankingItem[]): NewRankingInput {
  return {
    title,
    items: items.map((item) => ({ name: item.name, imageUrl: item.imageURL })),
  };
}

// Turns the items of an existing ranking or a template into an editable draft.
export function draftItemsFrom(items: { name: string; imageUrl?: string }[]): RankingItem[] {
  return items.map((item) => ({
    ...createEmptyItem(),
    name: item.name,
    imageURL: item.imageUrl ?? "",
    imageStatus: item.imageUrl ? "loading" : "idle",
  }));
}

// Upper bound for binary insertion: placing the k-th new item into k placed
// items takes at most ceil(log2(k + 1)) decisions. Ties can only lower it.
export function maxDecisions(itemCount: number): number {
  let total = 0;
  for (let k = 1; k < itemCount; k += 1) {
    total += Math.ceil(Math.log2(k + 1));
  }
  return total;
}

// A rough time estimate, assuming a few seconds per choice.
export function estimatedMinutes(itemCount: number): number {
  return Math.max(1, Math.round((maxDecisions(itemCount) * 4) / 60));
}
