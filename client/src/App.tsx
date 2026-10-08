import { useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router";
import type { Item } from "../../shared/types";
import { api } from "./api";
import EditScreen from "./components/EditScreen";
import ReviewScreen from "./components/ReviewScreen";
import TopBar from "./components/TopBar";
import {
  MAX_ITEMS,
  MIN_ITEMS,
  createEmptyItem,
  draftItemsFrom,
  toCreateInput,
  validateDraft,
} from "./draft";
import HomePage from "./pages/HomePage";
import RankingPage from "./pages/RankingPage";
import type { RankingTemplate } from "./templates";
import type { ImageStatus, RankingItem } from "./types";
import { useDocumentTitle } from "./useDocumentTitle";
import { useRequestRunner } from "./useRequestRunner";

// Routes:
//   /            home: your rankings, templates, "New ranking"
//   /new         edit the list
//   /new/review  check the list, then start ranking
//   /r/:id       compare, then results; reloads resume where you left off
function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { busy, error, setError, run } = useRequestRunner();

  // The list being edited. It lives here so it survives moving between
  // /new and /new/review.
  const [title, setTitle] = useState("");
  const [items, setItems] = useState<RankingItem[]>([
    createEmptyItem(),
    createEmptyItem(),
    createEmptyItem(),
  ]);

  // Each page starts at the top, even when the previous one was scrolled.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  function updateItemName(id: string, name: string) {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id
          ? {
              ...item,
              name,
            }
          : item,
      ),
    );
  }

  const addItem = () => {
    if (items.length >= MAX_ITEMS) {
      return;
    }
    setItems((currentItems) => [...currentItems, createEmptyItem()]);
  };

  const removeItem = (id: string) => {
    if (items.length <= MIN_ITEMS) {
      return;
    }

    setItems((currentItems) => currentItems.filter((item) => item.id !== id));
  };

  const updateImageURL = (id: string, imageURL: string) => {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id
          ? {
              ...item,
              imageURL,
              imageStatus: !imageURL.trim()
                ? "idle"
                : imageURL.trim() === item.imageURL.trim()
                  ? item.imageStatus
                  : "loading",
            }
          : item,
      ),
    );
  };

  const updateImageStatus = (id: string, status: ImageStatus) => {
    setItems((currentItems) =>
      currentItems.map((item) =>
        item.id === id ? { ...item, imageStatus: status } : item,
      ),
    );
  };

  const handleSubmit = () => {
    const problem = validateDraft(title, items);
    setError(problem ?? "");
    if (!problem) {
      navigate("/new/review");
    }
  };

  const handleStartComparing = () =>
    run(async () => {
      const result = await api.createRanking(toCreateInput(title, items));
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      navigate(`/r/${result.value.id}`, { state: { view: result.value } });
    });

  // Replaces the draft, e.g. with a template or an earlier ranking's items.
  const startDraft = (draftTitle: string, draftItems: { name: string; imageUrl?: string }[]) => {
    setTitle(draftTitle);
    setItems(draftItems.length > 0 ? draftItemsFrom(draftItems) : [
      createEmptyItem(),
      createEmptyItem(),
      createEmptyItem(),
    ]);
    setError("");
  };

  const newRanking = () => {
    startDraft("", []);
    navigate("/new");
  };

  // "Rank as is" goes to the review screen; "Edit first" to the edit screen.
  const startFromTemplate = (template: RankingTemplate, mode: "rank" | "edit") => {
    startDraft(template.title, template.items.map((name) => ({ name })));
    navigate(mode === "rank" ? "/new/review" : "/new");
  };

  // "Edit items" on a results page: copy that ranking into the draft.
  const editItems = (rankingTitle: string, rankingItems: Item[]) => {
    startDraft(rankingTitle, rankingItems);
    navigate("/new");
  };

  const draftIsValid = validateDraft(title, items) === null;

  return (
    <div className="app">
      <Routes>
        <Route
          path="/"
          element={<HomePage onNewRanking={newRanking} onUseTemplate={startFromTemplate} />}
        />
        <Route
          path="/new"
          element={
            <Page title="New ranking" step="create">
              <EditScreen
                title={title}
                items={items}
                error={error}
                onTitleChange={setTitle}
                onItemNameChange={updateItemName}
                onImageURLChange={updateImageURL}
                onImageStatusChange={updateImageStatus}
                onAddItem={addItem}
                onRemoveItem={removeItem}
                onSubmit={handleSubmit}
              />
            </Page>
          }
        />
        <Route
          path="/new/review"
          element={
            // Reloading here loses the draft, so go back to editing.
            draftIsValid ? (
              <Page title="Review" step="review">
                <ReviewScreen
                  title={title}
                  onBack={() => {
                    setError("");
                    navigate("/new");
                  }}
                  onStart={handleStartComparing}
                  items={items}
                  onImageStatusChange={updateImageStatus}
                  busy={busy}
                  error={error}
                />
              </Page>
            ) : (
              <Navigate to="/new" replace />
            )
          }
        />
        <Route path="/r/:id" element={<RankingRoute onEditItems={editItems} />} />
        <Route
          path="*"
          element={
            <Page title="Page not found">
              <section className="page">
                <h1 className="page-title">Page not found</h1>
                <p className="page-sub">There is nothing at this address.</p>
                <div className="action-row action-row--start">
                  <Link to="/" className="btn btn-primary">Go to your rankings</Link>
                </div>
              </section>
            </Page>
          }
        />
      </Routes>
    </div>
  );
}

// A new key per ranking ID gives each ranking a fresh page, so going from one
// ranking to another (e.g. "Rank again") never mixes their state.
function RankingRoute({ onEditItems }: { onEditItems: (title: string, items: Item[]) => void }) {
  const { id = "" } = useParams();

  return <RankingPage key={id} id={id} onEditItems={onEditItems} />;
}

function Page({
  title,
  step,
  children,
}: {
  title: string;
  step?: "create" | "review";
  children: ReactNode;
}) {
  useDocumentTitle(title);

  return (
    <>
      <TopBar step={step} />
      <main>{children}</main>
    </>
  );
}

export default App;
