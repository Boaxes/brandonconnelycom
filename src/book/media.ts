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

export interface Clip { video: HTMLVideoElement; ready: boolean }

/** A muted, looping video under public/portfolio that plays while `page` is in view. */
export function clip(file: string, page: Page): Clip {
  const video = document.createElement('video');
  const c: Clip = { video, ready: false };
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.addEventListener('loadeddata', () => { c.ready = true; }, { once: true });
  video.src = BASE + file;
  const prev = page.onShow;
  page.onShow = (shown) => {
    prev?.(shown);
    if (shown) video.play().catch(() => { /* it'll try again next time the page shows */ });
    else video.pause();
  };
  return c;
}
