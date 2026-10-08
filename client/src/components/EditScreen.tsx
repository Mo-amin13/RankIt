import type { SubmitEvent as ReactSubmitEvent } from "react";
import {
  MAX_IMAGE_URL_LENGTH,
  MAX_ITEMS,
  MAX_ITEM_NAME_LENGTH,
  MAX_TITLE_LENGTH,
  MIN_ITEMS,
} from "../draft";
import type { ImageStatus, RankingItem } from "../types";
import { AlertIcon, ArrowRightIcon, CloseIcon, PlusIcon } from "./icons";
import ItemImage from "./ItemImage";

type EditScreenProps = {
  title: string;
  items: RankingItem[];
  error: string;
  onTitleChange: (title: string) => void;
  onItemNameChange: (id: string, name: string) => void;
  onImageURLChange: (id: string, imageURL: string) => void;
  onImageStatusChange: (id: string, status: ImageStatus) => void;
  onAddItem: () => void;
  onRemoveItem: (id: string) => void;
  onSubmit: () => void;
};

export default function EditScreen({
  title,
  items,
  error,
  onTitleChange,
  onItemNameChange,
  onImageURLChange,
  onImageStatusChange,
  onAddItem,
  onRemoveItem,
  onSubmit,
}: EditScreenProps) {
  const handleSubmit = (event: ReactSubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <section className="page" aria-labelledby="edit-heading">
      <header className="page-head">
        <h1 id="edit-heading" className="page-title">New ranking</h1>
        <p className="page-sub">
          Add {MIN_ITEMS} to {MAX_ITEMS} items. You'll compare them two at a time and see the
          full ranking only at the end.
        </p>
      </header>

      <form onSubmit={handleSubmit} noValidate>
        <div className="title-field">
          <label htmlFor="ranking-title" className="field-label">Title</label>
          <input
            id="ranking-title"
            className="title-input"
            type="text"
            value={title}
            onChange={(event) => {
              onTitleChange(event.target.value);
            }}
            placeholder="For example: Favorite films"
            maxLength={MAX_TITLE_LENGTH}
            autoComplete="off"
          />
        </div>

        <div className="section-head">
          <h2>Items</h2>
          <span className="count">{items.length} / {MAX_ITEMS}</span>
        </div>

        <ol className="item-list">
          {items.map((item, index) => (
            <li key={item.id} className="item-row">
              <span className="item-index" aria-hidden="true">{index + 1}</span>
              <div className="item-fields">
                <label htmlFor={`name-${item.id}`} className="visually-hidden">
                  Item {index + 1} name
                </label>
                <input
                  id={`name-${item.id}`}
                  className="input input--name"
                  type="text"
                  value={item.name}
                  onChange={(event) => {
                    onItemNameChange(item.id, event.target.value);
                  }}
                  placeholder={`Item ${index + 1}`}
                  maxLength={MAX_ITEM_NAME_LENGTH}
                  autoComplete="off"
                />
                <label htmlFor={`image-${item.id}`} className="visually-hidden">
                  Item {index + 1} image URL (optional)
                </label>
                <input
                  id={`image-${item.id}`}
                  className="input input--url"
                  type="url"
                  value={item.imageURL}
                  onChange={(event) => {
                    onImageURLChange(item.id, event.target.value);
                  }}
                  placeholder="Image URL (optional, https://…)"
                  maxLength={MAX_IMAGE_URL_LENGTH}
                  autoComplete="off"
                />
                {item.imageStatus === "error" && (
                  <p role="alert" className="field-error">Image could not be loaded.</p>
                )}
              </div>
              <ItemImage item={item} onStatusChange={onImageStatusChange} />
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  onRemoveItem(item.id);
                }}
                disabled={items.length <= MIN_ITEMS}
                aria-label={`Remove item ${index + 1}`}
              >
                <CloseIcon />
              </button>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="add-btn"
          onClick={onAddItem}
          disabled={items.length >= MAX_ITEMS}
        >
          <PlusIcon size={16} />{" "}
          {items.length >= MAX_ITEMS ? `${MAX_ITEMS} items is the maximum` : "Add item"}
        </button>

        <div className="action-bar">
          <div className="action-bar-message">
            {error && (
              <p role="alert" className="alert">
                <AlertIcon /> {error}
              </p>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-lg">
            Review list <ArrowRightIcon />
          </button>
        </div>
      </form>
    </section>
  );
}
