import { beforeEach, describe, expect, it } from "vitest";
import { addDays, dayKey } from "../src/model/days";
import { newCard, type Flashcard } from "../src/model/flashcard";
import { newManifest } from "../src/model/notebook";
import { MemoryFS } from "../src/platform/fs";
import { loadCards, saveManifest } from "../src/storage/package";
import { addCardImage, cardImagePath, readCardImage } from "../src/study/cardImages";
import { addCard, cardForTape, dueByNotebook, sittingKeys, ensureCards, flushCards, gradeCard, refreshSummaries, removeCard, updateCard, useCards } from "../src/study/cardStore";
import { clampRect, padRect, pixelRect, tapeClips, TAPE_CONTEXT } from "../src/study/clip";
import { AGAIN_GAP, answer, cardKey, currentKey, deckSentence, dueAmong, dueSentence, intervalLabel, isFinished, progress, splitKey, startQueue, studiedCount, summariseDue } from "../src/study/queue";


const card = (patch: Partial<Flashcard> = {}): Flashcard => ({ ...newCard({ text: "front" }, { text: "back" }), ...patch });

describe("review queue", () => {
  it("shows the cards in the order given and finishes when each has been answered", () => {
    let queue = startQueue(["a", "b", "c"]);
    expect(currentKey(queue)).toBe("a");
    queue = answer(queue, "good");
    expect(currentKey(queue)).toBe("b");
    queue = answer(queue, "easy");
    queue = answer(queue, "good");
    expect(isFinished(queue)).toBe(true);
    expect(queue.answers).toBe(3);
    expect(queue.again).toBe(0);
    expect(studiedCount(queue)).toBe(3);
    expect(progress(queue)).toBe(1);
  });

  it("brings an Again card back a few cards later", () => {
    let queue = startQueue(["a", "b", "c", "d", "e", "f"]);
    queue = answer(queue, "again");
    expect(AGAIN_GAP).toBe(3);
    expect(queue.waiting).toEqual(["b", "c", "d", "a", "e", "f"]);
    expect(queue.again).toBe(1);
    // The forgotten card is still to be remembered, so nothing counts as done yet.
    expect(progress(queue)).toBe(0);
    expect(progress(answer(queue, "good"))).toBeCloseTo(1 / 6);
  });

  it("puts an Again card last when fewer cards remain than the gap", () => {
    let queue = startQueue(["a", "b"]);
    queue = answer(queue, "again");
    expect(queue.waiting).toEqual(["b", "a"]);
    queue = answer(queue, "good");
    expect(currentKey(queue)).toBe("a");
    queue = answer(queue, "again");
    expect(queue.waiting).toEqual(["a"]);
    queue = answer(queue, "good");
    expect(isFinished(queue)).toBe(true);
    expect(queue.again).toBe(2);
    expect(queue.answers).toBe(4);
    // Two different cards were studied, however many answers it took.
    expect(studiedCount(queue)).toBe(2);
  });

  it("is already finished when there is nothing to study", () => {
    const queue = startQueue([]);
    expect(isFinished(queue)).toBe(true);
    expect(progress(queue)).toBe(1);
    expect(answer(queue, "good")).toBe(queue);
  });

  it("keeps card keys apart across notebooks", () => {
    const key = cardKey("nb-1", "card-9");
    expect(splitKey(key)).toEqual({ notebook: "nb-1", cardID: "card-9" });
  });
});

describe("what is shown under the grade buttons", () => {
  it("says now, days, months and years", () => {
    expect(intervalLabel(0)).toBe("now");
    expect(intervalLabel(1)).toBe("1 day");
    expect(intervalLabel(4)).toBe("4 days");
    expect(intervalLabel(59)).toBe("59 days");
    expect(intervalLabel(90)).toBe("3 months");
    expect(intervalLabel(365)).toBe("1 year");
  });
});

describe("counting due cards", () => {
  const today = "2026-11-16";
  it("counts cards due today or before", () => {
    expect(dueAmong(["2026-11-15", "2026-11-16", "2026-11-17"], today)).toBe(2);
    expect(dueAmong([], today)).toBe(0);
  });
  it("sums notebooks that have any", () => {
    const summary = summariseDue({ a: 3, b: 0, c: 4 });
    expect(summary).toEqual({ cards: 7, notebooks: 2 });
    expect(dueSentence(summary)).toBe("7 cards due in 2 notebooks");
    expect(dueSentence({ cards: 1, notebooks: 1 })).toBe("1 card due in 1 notebook");
  });
  it("describes a deck", () => {
    expect(deckSentence([card(), card()], 1)).toBe("2 cards, 1 due today");
  });
});

describe("clipping rectangles", () => {
  it("widens by the context on every side", () => {
    expect(padRect({ x: 100, y: 200, w: 50, h: 20 }, 8)).toEqual({ x: 92, y: 192, w: 66, h: 36 });
    const { back, front } = tapeClips({ x: 100, y: 200, w: 50, h: 20 });
    expect(back).toEqual({ x: 100, y: 200, w: 50, h: 20 });
    expect(front).toEqual({ x: 100 - TAPE_CONTEXT, y: 200 - TAPE_CONTEXT, w: 50 + TAPE_CONTEXT * 2, h: 20 + TAPE_CONTEXT * 2 });
  });
  it("clamps to the page and drops what is outside it", () => {
    const page = { x: 0, y: 0, w: 612, h: 792 };
    expect(clampRect({ x: -30, y: 10, w: 100, h: 50 }, page)).toEqual({ x: 0, y: 10, w: 70, h: 50 });
    expect(clampRect({ x: 700, y: 10, w: 100, h: 50 }, page)).toBeNull();
  });
  it("turns page points into pixels of a canvas drawn at 2x", () => {
    const region = { x: 0, y: 0, w: 612, h: 792 };
    const canvas = { width: 1224, height: 1584 };
    expect(pixelRect(region, { x: 100, y: 200, w: 50, h: 20 }, canvas)).toEqual({ x: 200, y: 400, w: 100, h: 40 });
    // Part off the page is cut away.
    expect(pixelRect(region, { x: 580, y: 780, w: 100, h: 100 }, canvas)).toEqual({ x: 1160, y: 1560, w: 64, h: 24 });
    expect(pixelRect(region, { x: 900, y: 900, w: 10, h: 10 }, canvas)).toBeNull();
  });
  it("grows fractions of a pixel outward so no edge is lost", () => {
    const box = pixelRect({ x: 0, y: 0, w: 100, h: 100 }, { x: 10.2, y: 10.2, w: 10.1, h: 10.1 }, { width: 200, height: 200 })!;
    expect(box.x).toBe(20);
    expect(box.x + box.w).toBeGreaterThanOrEqual(Math.ceil(20.3 * 2));
  });
  it("handles a whiteboard region that does not start at the origin", () => {
    const box = pixelRect({ x: -100, y: -100, w: 400, h: 200 }, { x: 0, y: 0, w: 100, h: 50 }, { width: 800, height: 400 })!;
    expect(box).toEqual({ x: 200, y: 200, w: 200, h: 100 });
  });
});

describe("the card store", () => {
  beforeEach(() => {
    useCards.setState({ cards: {}, summaries: {}, edit: null });
  });

  it("loads lazily, saves after changes, and grades with the schedule", async () => {
    const fs = new MemoryFS();
    const c = card({ id: "c1" });
    await addCard(fs, "nb", c);
    // Nothing is on disk until the debounce, or a flush.
    expect(await loadCards(fs, "nb")).toEqual([]);
    await flushCards("nb");
    expect((await loadCards(fs, "nb")).map((x) => x.id)).toEqual(["c1"]);

    await gradeCard(fs, "nb", "c1", "good");
    await flushCards("nb");
    const stored = (await loadCards(fs, "nb"))[0];
    expect(stored.interval).toBe(1);
    expect(stored.due).toBe(dayKey(addDays(new Date(), 1)));
    expect(stored.reviews).toBe(1);
  });

  it("updates and removes, deleting clippings with a removed card", async () => {
    const fs = new MemoryFS();
    const image = await addCardImage(fs, "nb", new Uint8Array([1, 2, 3]));
    await addCard(fs, "nb", card({ id: "c1", front: { text: "", image } }));
    await updateCard(fs, "nb", "c1", (x) => ({ ...x, back: { text: "answer" } }));
    expect((await ensureCards(fs, "nb"))[0].back.text).toBe("answer");
    expect(await readCardImage(fs, "nb", image)).not.toBeNull();
    await removeCard(fs, "nb", "c1");
    expect(await ensureCards(fs, "nb")).toEqual([]);
    expect(await fs.read(cardImagePath("nb", image))).toBeNull();
  });

  it("keeps cards images in cards/, not assets/", async () => {
    const fs = new MemoryFS();
    const image = await addCardImage(fs, "nb", new Uint8Array([9]));
    expect(cardImagePath("nb", image)).toBe(`nb.owlluna/cards/${image}`);
  });

  it("finds the card made from a tape", async () => {
    const fs = new MemoryFS();
    await addCard(fs, "nb", card({ id: "c1", tapeID: "t1" }));
    expect(cardForTape("nb", "t1")?.id).toBe("c1");
    expect(cardForTape("nb", "other")).toBeUndefined();
  });

  it("reads each notebook's cards once for the library, skipping locked and trashed ones", async () => {
    const fs = new MemoryFS();
    const a = newManifest({ title: "A" }), b = newManifest({ title: "B" }), c = newManifest({ title: "C" });
    const manifests = { [a.id]: a, [b.id]: { ...b, locked: true }, [c.id]: { ...c, trashedAt: Date.now() } };
    for (const m of [a, b, c]) await saveManifest(fs, m);
    const past = card({ due: "2000-01-01" }), future = card({ due: "2999-01-01" });
    for (const m of [a, b, c]) {
      await addCard(fs, m.id, past);
      await addCard(fs, m.id, future);
      await flushCards(m.id);
    }
    useCards.setState({ cards: {}, summaries: {} });
    await refreshSummaries(fs, manifests, []);
    const summaries = useCards.getState().summaries;
    expect(Object.keys(summaries)).toEqual([a.id]);
    expect(dueByNotebook(manifests, [], summaries)).toEqual({ [a.id]: 1 });
    // Unlocking offers the locked one once its cards are read.
    await refreshSummaries(fs, manifests, [b.id]);
    expect(dueByNotebook(manifests, [b.id], useCards.getState().summaries)).toEqual({ [a.id]: 1, [b.id]: 1 });
  });

  it("reads a notebook again when its modifiedAt has moved", async () => {
    const fs = new MemoryFS();
    const a = newManifest({ title: "A" });
    await saveManifest(fs, a);
    await addCard(fs, a.id, card({ due: "2000-01-01" }));
    await flushCards(a.id);
    useCards.setState({ cards: {}, summaries: {} });
    await refreshSummaries(fs, { [a.id]: a }, []);
    expect(useCards.getState().summaries[a.id].dues).toHaveLength(1);
    // A card file changed elsewhere is picked up only once the manifest says the notebook changed.
    await fs.write(`${a.id}.owlluna/cards.json`, JSON.stringify({ version: 1, cards: [] }));
    await refreshSummaries(fs, { [a.id]: a }, []);
    expect(useCards.getState().summaries[a.id].dues).toHaveLength(1);
    await refreshSummaries(fs, { [a.id]: { ...a, modifiedAt: a.modifiedAt + 1 } }, []);
    expect(useCards.getState().summaries[a.id].dues).toHaveLength(0);
  });

  it("builds a sitting from the cards due across notebooks, oldest first", async () => {
    const fs = new MemoryFS();
    await addCard(fs, "x", card({ id: "x1", due: "2000-01-03" }));
    await addCard(fs, "x", card({ id: "x2", due: "2999-01-01" }));
    await addCard(fs, "y", card({ id: "y1", due: "2000-01-02" }));
    expect(sittingKeys(["x", "y"], false, "2026-11-16")).toEqual([cardKey("y", "y1"), cardKey("x", "x1")]);
    expect(sittingKeys(["x", "y"], true, "2026-11-16")).toHaveLength(3);
  });
});
