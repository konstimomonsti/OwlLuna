import { describe, expect, it } from "vitest";
import { inkUntil } from "../src/canvas/PageView";
import { clock, nextRecordingName, pageAtMoment, pickRecordingType, recordingExtension, replayMoment, seekTarget, strokeAtPoint, writtenDuring } from "../src/editor/replayMath";
import { makeStroke, type Stroke } from "../src/model/ink";

const recording = { startedAt: 10_000, duration: 20_000 };

/** A horizontal stroke begun at `at` that takes `ms` to write. */
function line(at: number, y = 0, ms = 200): Stroke {
  const stroke = makeStroke("pen", 0, 2, [{ x: 0, y }, { x: 50, y }], at);
  stroke.pts[3] = 0;
  stroke.pts[7] = ms;
  return stroke;
}

describe("replay time", () => {
  it("maps audio seconds onto the notebook's own clock", () => {
    expect(replayMoment(recording, 0)).toBe(10_000);
    expect(replayMoment(recording, 2.5)).toBe(12_500);
    expect(replayMoment(recording, -1)).toBe(10_000);
  });

  it("knows which ink was written during the recording", () => {
    expect(writtenDuring({ at: 9_999 }, recording)).toBe(false);
    expect(writtenDuring({ at: 10_000 }, recording)).toBe(true);
    expect(writtenDuring({ at: 30_000 }, recording)).toBe(true);
    expect(writtenDuring({ at: 30_001 }, recording)).toBe(false);
  });
});

describe("inkUntil with a start", () => {
  const before = line(5_000, 0), during1 = line(12_000, 10), during2 = line(20_000, 20), after = line(40_000, 30);
  const all = [before, during1, during2, after];

  it("keeps ink from before the recording whole, and hides the rest until its time", () => {
    const shown = inkUntil(all, 10_000, recording.startedAt);
    expect(shown.map((s) => s.id)).toEqual([before.id]);
    expect(inkUntil(all, 12_500, recording.startedAt).map((s) => s.id)).toEqual([before.id, during1.id]);
  });

  it("hides ink written after the recording ended while replaying, and shows it all when not", () => {
    expect(inkUntil(all, 30_000, recording.startedAt).map((s) => s.id)).toEqual([before.id, during1.id, during2.id]);
    // Without a start the old behaviour holds: everything begun by then.
    expect(inkUntil(all, 100_000).length).toBe(4);
  });

  it("still cuts the stroke being written short", () => {
    const partial = inkUntil([during1], 12_100, recording.startedAt);
    expect(partial).toHaveLength(1);
    expect(partial[0].pts.length).toBe(4);
  });

  it("does not cut ink from before the recording, even when it is the start that is asked about", () => {
    const old = line(9_900, 0, 500);
    expect(inkUntil([old], 10_000, recording.startedAt)).toEqual([old]);
  });
});

describe("which page a time belongs to", () => {
  const inks = [
    { pageID: "p1", strokes: [line(5_000), line(11_000), line(15_000)] },
    { pageID: "p2", strokes: [line(18_000), line(29_000)] },
    { pageID: "p3", strokes: [line(50_000)] },
  ];
  it("follows the most recently begun stroke written during the recording", () => {
    expect(pageAtMoment(inks, recording, 11_500)).toBe("p1");
    expect(pageAtMoment(inks, recording, 16_000)).toBe("p1");
    expect(pageAtMoment(inks, recording, 18_000)).toBe("p2");
    expect(pageAtMoment(inks, recording, 40_000)).toBe("p2");
  });
  it("says nothing before the first stroke of the recording, and ignores ink from outside it", () => {
    expect(pageAtMoment(inks, recording, 10_500)).toBeNull();
    expect(pageAtMoment(inks, recording, 55_000)).toBe("p2");
  });
});

describe("seeking by ink", () => {
  it("seeks to when the stroke was written, within the audio", () => {
    expect(seekTarget(line(12_500), recording)).toBe(2.5);
    expect(seekTarget(line(10_000), recording)).toBe(0);
    expect(seekTarget(line(30_000), recording)).toBe(20);
  });
  it("has no target for ink from outside the recording", () => {
    expect(seekTarget(line(9_000), recording)).toBeNull();
    expect(seekTarget(line(31_000), recording)).toBeNull();
  });
});

describe("strokeAtPoint", () => {
  const first = line(12_000, 100), second = line(13_000, 100), old = line(1_000, 200);
  it("finds the topmost stroke written during the recording under the point", () => {
    expect(strokeAtPoint([first, second], { x: 25, y: 100 }, 4, recording)?.id).toBe(second.id);
    expect(strokeAtPoint([first], { x: 25, y: 103 }, 4, recording)?.id).toBe(first.id);
  });
  it("misses the empty page and ink from before the recording", () => {
    expect(strokeAtPoint([first], { x: 25, y: 150 }, 4, recording)).toBeNull();
    expect(strokeAtPoint([old], { x: 25, y: 200 }, 4, recording)).toBeNull();
    expect(strokeAtPoint([first], { x: 200, y: 100 }, 4, recording)).toBeNull();
  });
});

describe("the recorder's small decisions", () => {
  it("prefers webm with opus, then plain webm", () => {
    expect(pickRecordingType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickRecordingType((type) => type === "audio/webm")).toBe("audio/webm");
    expect(pickRecordingType(() => false)).toBeUndefined();
  });
  it("names files by their type", () => {
    expect(recordingExtension("audio/webm;codecs=opus")).toBe("webm");
    expect(recordingExtension("audio/ogg;codecs=opus")).toBe("ogg");
    expect(recordingExtension("audio/mp4")).toBe("m4a");
  });
  it("names recordings in order, skipping names in use", () => {
    expect(nextRecordingName([])).toBe("Recording 1");
    expect(nextRecordingName([{ name: "Recording 1" }, { name: "Lecture" }])).toBe("Recording 3");
    expect(nextRecordingName([{ name: "Recording 2" }])).toBe("Recording 3");
  });
  it("shows time as minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(187.9)).toBe("3:07");
    expect(clock(3729)).toBe("1:02:09");
    expect(clock(Infinity)).toBe("0:00");
  });
});
