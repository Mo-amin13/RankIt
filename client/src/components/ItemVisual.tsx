import { useState } from "react";
import type { Item } from "../../../shared/types";
import Monogram from "./Monogram";

// Image for a server item, falling back to a monogram when there is no image
// or it fails to load. The name is always shown next to it, so alt is empty.
export default function ItemVisual({ item }: { item: Item }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = item.imageUrl !== undefined && item.imageUrl !== failedUrl;

  return (
    <span className="media">
      {showImage ? (
        <img
          src={item.imageUrl}
          alt=""
          onError={() => setFailedUrl(item.imageUrl ?? null)}
        />
      ) : (
        <Monogram name={item.name} />
      )}
    </span>
  );
}
