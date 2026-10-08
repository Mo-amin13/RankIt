export type ImageStatus = "idle" | "loading" | "loaded" | "error";
export type RankingItem = {
  id: string;
  name: string;
  imageURL: string;
  imageStatus: ImageStatus;
};