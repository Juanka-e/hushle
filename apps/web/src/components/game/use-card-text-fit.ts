"use client";

import { useLayoutEffect, type RefObject } from "react";
import {
    chooseCardTextFit,
    type CardTextFit,
    type CardTextFitConfig,
    type CardTextFitStep,
} from "@/lib/game/card-text";

function applyStep(element: HTMLElement, step: CardTextFitStep, breakInsideWords: boolean): void {
    element.style.fontSize = `${step.fontSize}px`;
    element.style.lineHeight = `${step.lineHeight}px`;
    element.style.overflowWrap = breakInsideWords ? "anywhere" : "normal";
}

/**
 * Measures the element at each step and keeps the largest one that fits.
 * Layout sizes (not transformed boxes) are used, so card flips do not matter.
 */
export function fitCardText(element: HTMLElement, config: CardTextFitConfig): CardTextFit | null {
    if (element.clientWidth === 0) {
        // Not laid out (hidden); the resize observer refits once it has a width.
        return null;
    }

    const fit = chooseCardTextFit(config, (step) => {
        applyStep(element, step, false);
        return {
            overflowsX: element.scrollWidth > element.clientWidth,
            lines: Math.round(element.offsetHeight / step.lineHeight),
        };
    });
    applyStep(element, fit.step, fit.breakInsideWords);
    element.dataset.fitSize = String(fit.step.fontSize);
    element.dataset.fitBreak = fit.breakInsideWords ? "true" : "false";
    return fit;
}

/** Keeps `text` fully visible inside the element's width. */
export function useCardTextFit(
    ref: RefObject<HTMLElement | null>,
    text: string,
    config: CardTextFitConfig
): void {
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }

        let active = true;
        let fittedWidth = -1;
        const refit = () => {
            if (!active) {
                return;
            }
            fitCardText(element, config);
            fittedWidth = element.clientWidth;
        };

        refit();

        // Refit on the next frame, not inside the observer callback: changing the
        // font size there resizes the observed element again in the same frame,
        // which browsers report as a "ResizeObserver loop" error.
        let frame = 0;
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(() => {
                    if (frame !== 0) {
                        return;
                    }
                    frame = requestAnimationFrame(() => {
                        frame = 0;
                        if (element.clientWidth !== fittedWidth) {
                            refit();
                        }
                    });
                });
        observer?.observe(element);

        // Web fonts swap in after the first layout and change text widths.
        const fonts = typeof document === "undefined" ? undefined : document.fonts;
        fonts?.addEventListener?.("loadingdone", refit);
        void fonts?.ready.then(refit);

        return () => {
            active = false;
            observer?.disconnect();
            if (frame !== 0) {
                cancelAnimationFrame(frame);
            }
            fonts?.removeEventListener?.("loadingdone", refit);
        };
    }, [ref, text, config]);
}
