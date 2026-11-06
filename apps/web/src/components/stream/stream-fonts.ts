import { Big_Shoulders, Bricolage_Grotesque, Cormorant_Garamond, Inter, Kalam } from "next/font/google";
import localFont from "next/font/local";

// The stream screen's type, self-hosted by next/font (no request to Google at run time). Each
// family is a CSS variable that the theme blocks of stream-screen.css map onto --font-ui and
// --font-hand. Nothing is preloaded: a browser source downloads only the faces its theme draws.
//
// The prototype's "Big Shoulders Display" is the display cut of the variable Big Shoulders; the
// optical-size axis lets the large studio type take that cut. next/font reads these options
// statically, so each call spells them out.
//
// Shippori Mincho is a Japanese family: its Google stylesheet carries 360+ unicode-range slices
// and next/font/google downloads every one of them at build, where a single failed download
// breaks the build. The screen needs only the latin and latin-ext faces, so those six files
// (fonts.gstatic.com v17, SIL OFL 1.1, see fonts/OFL.txt) are kept here and split by the same
// unicode ranges Google uses: the latin family first, the latin-ext family behind it.

const bricolage = Bricolage_Grotesque({
    variable: "--font-stream-bricolage",
    subsets: ["latin", "latin-ext"],
    axes: ["opsz"],
    display: "swap",
    preload: false,
});

const kalam = Kalam({
    variable: "--font-stream-kalam",
    subsets: ["latin", "latin-ext"],
    weight: ["400", "700"],
    display: "swap",
    preload: false,
});

const shoulders = Big_Shoulders({
    variable: "--font-stream-shoulders",
    subsets: ["latin", "latin-ext"],
    axes: ["opsz"],
    // next/font has no metrics for this family to size a fallback with.
    adjustFontFallback: false,
    display: "swap",
    preload: false,
});

const cormorant = Cormorant_Garamond({
    variable: "--font-stream-cormorant",
    subsets: ["latin", "latin-ext"],
    weight: ["500", "700"],
    style: ["normal", "italic"],
    display: "swap",
    preload: false,
});

// No metric-adjusted fallback on these two: it would answer for latin-ext before the second family.
const shippori = localFont({
    variable: "--font-stream-shippori",
    src: [
        { path: "./fonts/shippori-mincho-500-latin.woff2", weight: "500", style: "normal" },
        { path: "./fonts/shippori-mincho-700-latin.woff2", weight: "700", style: "normal" },
        { path: "./fonts/shippori-mincho-800-latin.woff2", weight: "800", style: "normal" },
    ],
    declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
    adjustFontFallback: false,
    display: "swap",
    preload: false,
});

const shipporiExt = localFont({
    variable: "--font-stream-shippori-ext",
    src: [
        { path: "./fonts/shippori-mincho-500-latin-ext.woff2", weight: "500", style: "normal" },
        { path: "./fonts/shippori-mincho-700-latin-ext.woff2", weight: "700", style: "normal" },
        { path: "./fonts/shippori-mincho-800-latin-ext.woff2", weight: "800", style: "normal" },
    ],
    declarations: [{ prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" }],
    adjustFontFallback: false,
    display: "swap",
    preload: false,
});

const inter = Inter({
    variable: "--font-stream-inter",
    subsets: ["latin", "latin-ext"],
    display: "swap",
    preload: false,
});

/** Class names that define the font variables; they go on the .hushle-stream wrapper. */
export const streamFontClassName = [bricolage, kalam, shoulders, cormorant, shippori, shipporiExt, inter]
    .map((font) => font.variable)
    .join(" ");
