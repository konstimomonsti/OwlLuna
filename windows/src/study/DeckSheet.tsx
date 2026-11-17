// The notebook's flashcards: a grid of index cards, with study, a new card, and the card editor.

import { Layers, Pencil, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { confirm, EmptyPlate, IconButton, Sheet } from "../design/controls";
import "../design/study.css";
import { dayKey } from "../model/days";
import { newCard, sideIsEmpty, type CardSide, type Flashcard } from "../model/flashcard";
import type { NotebookDocument } from "../editor/document";
import { goToPage, type Session } from "../editor/session";
import { removeCardImage } from "./cardImages";
import { CardFace, useCardImage } from "./CardFace";
import { addCard, clearEdit, ensureCards, removeCard, updateCard, useCards } from "./cardStore";
import { dueAmong, deckSentence } from "./queue";
import { Review } from "./Review";
import { t, tp } from "../i18n";

type Mode = { kind: "list" } | { kind: "edit"; cardID: string | "new" };

export function DeckSheet(props: { doc: NotebookDocument; session: Session; onClose: () => void }) {
  const { doc, session } = props;
  const cards = useCards((state) => state.cards[doc.id]);
  const edit = useCards((state) => state.edit);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [turned, setTurned] = useState<Set<string>>(new Set());
  const [reviewing, setReviewing] = useState<"due" | "all" | null>(null);

  useEffect(() => {
    void ensureCards(doc.fs, doc.id).catch(() => {});
  }, [doc]);

  // A card made from ink or tape asks to be opened for editing.
  useEffect(() => {
    if (edit && edit.notebook === doc.id) {
      setMode({ kind: "edit", cardID: edit.cardID });
      clearEdit();
    }
  }, [edit, doc.id]);

  const list = cards ?? [];
  const day = dayKey();
  const due = dueAmong(list.map((card) => card.due), day);

  if (reviewing) {
    return (
      <Review
        fs={doc.fs}
        notebooks={[doc.id]}
        all={reviewing === "all"}
        onClose={() => setReviewing(null)}
        onGoToPage={(_, pageID) => {
          if (doc.page(pageID)) goToPage(session, pageID);
          props.onClose();
        }}
      />
    );
  }

  if (mode.kind === "edit") {
    const existing = mode.cardID === "new" ? null : list.find((card) => card.id === mode.cardID) ?? null;
    return <CardEditor doc={doc} card={existing} onClose={() => setMode({ kind: "list" })} />;
  }

  const remove = async (card: Flashcard) => {
    if (await confirm({ title: t("Delete this card?"), message: t("Its clippings are deleted with it."), confirm: t("Delete"), destructive: true })) {
      await removeCard(doc.fs, doc.id, card.id);
    }
  };

  return (
    <Sheet
      title={t("Flashcards")}
      wide
      testid="deck-sheet"
      onClose={props.onClose}
      foot={
        <>
          <button type="button" className="btn" onClick={() => setMode({ kind: "edit", cardID: "new" })} data-testid="new-card"><Plus /> {t("New Card")}</button>
          {due > 0 ? (
            <button type="button" className="btn primary" onClick={() => setReviewing("due")} data-testid="study-cards">{tp(due, "Study {count} Card", "Study {count} Cards")}</button>
          ) : (
            <button type="button" className="btn" disabled={list.length === 0} onClick={() => setReviewing("all")} data-testid="study-all">{t("Study All Anyway")}</button>
          )}
        </>
      }
    >
      <div className="deck-head">
        <span className="secondary" data-testid="deck-counts">{deckSentence(list, due)}</span>
      </div>
      {list.length === 0 ? (
        <EmptyPlate icon={<Layers />} title={t("No cards yet")}>{t("Lift a strip of study tape or select handwriting and press the cards button, or make one by hand.")}</EmptyPlate>
      ) : (
        <div className="deck-grid" data-testid="deck-grid">
          {list.map((card) => {
            const back = turned.has(card.id);
            return (
              <div key={card.id} className="index-card deck-card" data-testid="deck-card" data-card={card.id}>
                <span className="side-name">{back ? t("Back") : t("Front")}</span>
                <div className="tools">
                  <IconButton label={t("Edit Card")} onClick={() => setMode({ kind: "edit", cardID: card.id })} testid="card-edit"><Pencil /></IconButton>
                  <IconButton label={t("Delete Card")} onClick={() => void remove(card)} testid="card-delete"><Trash2 /></IconButton>
                </div>
                <button
                  type="button"
                  className="face"
                  onClick={() => setTurned((now) => { const next = new Set(now); if (next.has(card.id)) next.delete(card.id); else next.add(card.id); return next; })}
                  title={t("Turn the card over")}
                  data-testid="card-flip"
                >
                  <CardFace fs={doc.fs} notebook={doc.id} side={back ? card.back : card.front} empty={t("(empty)")} />
                  <span className="due-mark">{card.due <= day ? t("Due") : t("Due {date}", { date: card.due })}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

function SideEditor(props: { doc: NotebookDocument; name: string; side: CardSide; onChange: (side: CardSide) => void; onRemoveImage: (file: string) => void; testid: string }) {
  const { side } = props;
  const url = useCardImage(props.doc.fs, props.doc.id, side.image);
  return (
    <div className="side">
      <span className="label">{props.name}</span>
      <textarea className="field" value={side.text} onChange={(event) => props.onChange({ ...side, text: event.target.value })} data-testid={`${props.testid}-text`} />
      {side.image && (
        <div className="clip-box">
          {url && <img className="card-clip" src={url} alt="" draggable={false} data-testid={`${props.testid}-clip`} />}
          <button type="button" className="btn small flat" onClick={() => { props.onRemoveImage(side.image!); props.onChange({ text: side.text, imageText: undefined }); }} data-testid={`${props.testid}-clip-remove`}><X /> {t("Remove Clipping")}</button>
        </div>
      )}
    </div>
  );
}

function CardEditor(props: { doc: NotebookDocument; card: Flashcard | null; onClose: () => void }) {
  const { doc, card } = props;
  const [front, setFront] = useState<CardSide>(card?.front ?? { text: "" });
  const [back, setBack] = useState<CardSide>(card?.back ?? { text: "" });
  // The clippings dropped from the card are deleted once it is saved, so Cancel brings them back.
  const [dropped, setDropped] = useState<string[]>([]);

  const clean = (side: CardSide): CardSide => {
    const out: CardSide = { text: side.text };
    if (side.image) out.image = side.image;
    if (side.imageText) out.imageText = side.imageText;
    return out;
  };

  const save = async () => {
    const next = { front: clean(front), back: clean(back) };
    if (card) await updateCard(doc.fs, doc.id, card.id, (current) => ({ ...current, ...next }));
    else await addCard(doc.fs, doc.id, newCard(next.front, next.back));
    for (const file of dropped) await removeCardImage(doc.fs, doc.id, file);
    props.onClose();
  };

  return (
    <Sheet
      title={card ? t("Edit Card") : t("New Card")}
      wide
      testid="card-editor"
      onClose={props.onClose}
      foot={
        <>
          <button type="button" className="btn flat" onClick={props.onClose} data-testid="card-cancel">{t("Cancel")}</button>
          <button type="button" className="btn primary" disabled={sideIsEmpty(front) && sideIsEmpty(back)} onClick={() => void save()} data-testid="card-save">{t("Save")}</button>
        </>
      }
    >
      <div className="card-editor">
        <SideEditor doc={doc} name={t("Front")} side={front} onChange={setFront} onRemoveImage={(file) => setDropped((now) => [...now, file])} testid="front" />
        <SideEditor doc={doc} name={t("Back")} side={back} onChange={setBack} onRemoveImage={(file) => setDropped((now) => [...now, file])} testid="back" />
      </div>
    </Sheet>
  );
}
