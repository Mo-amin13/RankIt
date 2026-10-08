import type { ImageStatus, RankingItem } from "../types";
import { ImageIcon } from "./icons";
import Monogram from "./Monogram";

type ItemImageProp = {
  item: RankingItem;
  onStatusChange: (id: string, status: ImageStatus) => void;
  variant?: "thumb" | "card";
};

export default function ItemImage({
  item,
  onStatusChange,
  variant = "thumb",
}: ItemImageProp) {
  const url = item.imageURL.trim();
  const className = `media media--${variant}`;

  if (!url) {
    return (
      <span className={`${className} is-empty`}>
        {variant === "card" ? <Monogram name={item.name} /> : <ImageIcon size={18} />}
      </span>
    );
  }

  if (item.imageStatus === "error") {
    return (
      <span className={`${className} is-error`}>
        {variant === "card" ? <Monogram name={item.name} /> : <span aria-hidden="true">!</span>}
      </span>
    );
  }

  return (
    <span className={`${className} ${item.imageStatus === "loading" ? "is-loading" : ""}`}>
      {item.imageStatus === "loading" && (
        <span className="visually-hidden" role="status">
          Loading image…
        </span>
      )}
      <img
        src={url}
        onError={() => onStatusChange(item.id, "error")}
        onLoad={() => onStatusChange(item.id, "loaded")}
        alt={variant === "card" ? "" : `Preview of ${item.name.trim() || "item"}`}
      />
    </span>
  );
}
