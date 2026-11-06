import type { CameraSize, CameraSlot } from "@hushle/domain-streamer";

// Where the webcam hole sits on the stream screen's 1920x1080 canvas. Pure geometry with type
// imports only, so the screen's renderer and the streamer panel (which shows the same numbers
// next to the OBS addresses) can share it. docs/stream/platform-connections-guide.md §8.3
// lists the same table.

export type { CameraSize, CameraSlot };

export interface CameraRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Width and height of a corner hole for each camera size. */
export const CAMERA_HOLE_SIZES: Readonly<Record<CameraSize, readonly [number, number]>> = {
    s: [480, 270],
    m: [560, 315],
    l: [640, 360],
};

/** The hole for a slot and size: corners 70 px from the edges, halves exact, `none` has none. */
export function cameraRect(slot: CameraSlot, size: CameraSize): CameraRect | null {
    const [w, h] = CAMERA_HOLE_SIZES[size] ?? CAMERA_HOLE_SIZES.m;
    switch (slot) {
        case "tl":
            return { x: 70, y: 70, w, h };
        case "tr":
            return { x: 1850 - w, y: 70, w, h };
        case "bl":
            return { x: 70, y: 1010 - h, w, h };
        case "br":
            return { x: 1850 - w, y: 1010 - h, w, h };
        case "left":
            return { x: 0, y: 0, w: 960, h: 1080 };
        case "right":
            return { x: 960, y: 0, w: 960, h: 1080 };
        default:
            return null;
    }
}
