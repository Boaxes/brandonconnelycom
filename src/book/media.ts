/**
 * Pictures and screen recordings for the portfolio pages. The book is built before these arrive, so each
 * page redraws itself when one of its pictures loads. Videos (the old GIFs, re-encoded) are muted loops
 * that only play while their page can be seen.
 */
import type { Page } from './Page';
import type { Img } from './ink';

const BASE = `${import.meta.env.BASE_URL}portfolio/`;

export interface Picture { img: Img | null; ready: boolean }

/** An image under public/portfolio; `page` is redrawn once it has loaded. */
export function picture(file: string, page: Page): Picture {
  const pic: Picture = { img: null, ready: false };
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => {
    pic.img = im;
    pic.ready = true;
    page.rebuild();
  };
  im.src = BASE + file;
  return pic;
}

export interface Clip {
  video: HTMLVideoElement;
  ready: boolean;
  /** counts the video's new frames; null where the browser can't say when one arrives */
  frame: number | null;
}

/**
 * A muted, looping video under public/portfolio that plays from the start each time `page` comes into
 * view (it's rewound as the page goes out of view).
 */
export function clip(file: string, page: Page): Clip {
  const video = document.createElement('video');
  const c: Clip = { video, ready: false, frame: null };
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.addEventListener('loadeddata', () => {
    c.ready = true;
    if (c.frame !== null) c.frame++;
  }, { once: true });
  // the recordings run at 2-21 frames a second: their prints need redrawing only when a new one is up
  if ('requestVideoFrameCallback' in video) {
    c.frame = 0;
    const onFrame = () => {
      c.frame!++;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  }
  video.src = BASE + file;
  const prev = page.onShow;
  page.onShow = (shown) => {
    prev?.(shown);
    if (shown) video.play().catch(() => { /* it'll try again next time the page shows */ });
    else {
      video.pause();
      video.currentTime = 0;
    }
  };
  return c;
}

/** For Page.frames: whether any of these videos has a frame the page hasn't drawn yet. */
export function newFrames(clips: Clip[]) {
  const seen = clips.map(() => -1);
  return {
    changed: () => clips.some((c, i) => c.frame === null || c.frame !== seen[i]),
    taken: () => clips.forEach((c, i) => { seen[i] = c.frame ?? -1; }),
  };
}
