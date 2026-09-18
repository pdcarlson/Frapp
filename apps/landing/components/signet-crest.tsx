/*
 * The locked emblem B crest, in one place.
 *
 * The path is copied verbatim from
 * `packages/brand-assets/assets/signet-emblem-B-glyph.svg`, which is the vector
 * source every raster in that package is rendered from. Do not hand-edit it
 * here; re-copy it if the source moves.
 *
 * **Why it is a module rather than a literal at each call site.** The mark is
 * LOCKED (`spec/ui/brand-identity.md` §2, `spec/ui/assets.md` §1), so a copy
 * that drifts is a brand defect rather than a formatting one. The token cutover
 * inlined it in two files, which agreed; slice 3 needed a third for the social
 * card and extracted instead of adding one. The geometry now has a single home
 * and the three surfaces that draw it read from here.
 *
 * **The fill is the literal `#DDB844` the vector carries, never
 * `var(--primary)`.** Wiring the mark to the accent slot is the one lock a
 * reskin is most likely to break by accident, and on this surface the two values
 * happen to be identical today (D1) — which is exactly what would make the
 * mistake invisible. The mark never takes theme or chapter accent.
 *
 * `SIGNET_CREST_PATH` is exported separately because `app/opengraph-image.tsx`
 * renders through Satori, which lays out its own JSX tree and takes the raw `d`.
 */

/** The `d` attribute of the single path in `signet-emblem-B-glyph.svg`. */
export const SIGNET_CREST_PATH =
  "M188.98 592.26C188.6 595.81 190.31 599.31 191.21 602.67 C192.59 607.82 193.92 612.93 195.64 617.99C201.79 636.11 209.25 654 218.22 670.92 C267.26 763.42 350.53 832.37 437.81 887.43C454.9 898.21 472.03 908.94 489.15 919.67 C494.21 922.84 499.31 925.92 504.43 928.99C506.9 930.47 509.97 933.16 513 932.89 C516.21 931.55 518.79 927.14 520.96 924.49C526.22 918.09 531.25 911.52 535.94 904.69 C550.88 882.9 563.79 859.35 572.88 834.49C592.01 782.13 597.69 723.86 581.4 669.85 C572.94 641.79 559.85 615.7 543.19 591.62C514.52 550.21 473.55 519.59 443.03 479.74 C418.94 448.28 403.41 410.82 398.95 371.41C397.67 360.06 396.7 348.99 396.67 337.54 C396.65 333.35 395.65 327.04 397.64 323.23C398.61 322.65 402.87 333.99 403.56 335.54 C409.84 349.67 417.72 363.45 426.95 375.87C456.99 416.33 500.91 443.82 546.91 462.85 C554.25 465.89 561.55 469.05 568.9 472.1C572.15 473.45 576.33 476.04 579.93 475.61 C583.26 474.33 585.66 469.9 588 467.31C592.67 462.14 597.73 457.34 602.98 452.76 C619.64 438.24 638.1 426.94 658.47 418.4C677.36 410.49 698.21 406.45 718.51 404.41 C730.73 403.18 743.25 403.88 755.26 400.79C793.72 390.89 822.82 359.69 831.62 321.02 C832.37 317.72 833.7 312.59 832.74 309.27C831.34 304.47 823.85 300.08 820.2 296.94 C812.17 290.02 803.98 283.22 796.21 276C794.2 274.13 787.16 269.58 787.63 266.66 C789.39 264.15 793.47 263.83 796.22 263.06C801.87 261.47 808.05 260.49 813.91 259.96 C816.83 259.7 833.44 261.13 833.83 258.7C833.12 256.13 830.24 254.07 828.26 252.43 C821.65 246.96 813.33 243.62 805.24 241.04C781.88 233.6 757.56 228.61 733.55 223.72 C726.37 222.26 719.22 220.81 712.07 219.2C707.47 218.17 701.79 217.88 698 214.78 C691.19 209.2 686.5 200.91 680.54 194.47C672.01 185.24 661.53 177.81 650.38 172.09 C634.03 163.72 616.35 158.99 598.54 155.04C560.49 146.61 519.5 147.45 481.42 155.11 C454.91 160.44 428.32 168.81 405.82 184.28C384.17 199.16 368.22 219.58 354.92 241.95 C333.13 278.62 319.26 321.41 309.44 362.71C299.8 403.2 293.23 444.11 276.67 482.63 C264.4 511.19 245.85 538.41 224.18 560.67C217.25 567.79 209.99 574.74 202.34 581.08 C198.68 584.12 190.72 587.8 188.98 592.26ZM637.89 843.52 C642.22 842.8 647.64 835.39 650.86 832.47C663.14 821.35 674.65 809.27 685.44 796.71 C714.5 762.88 742.28 720.43 730.02 673.67C724.4 652.25 715.33 631.67 704.92 612.13 C691.03 586.02 675.21 559.91 668.16 530.91C663.39 511.29 662.93 489.19 668.04 469.57 C668.88 466.33 677.4 446.98 675.61 445.52C673.05 445.5 669.99 448.94 668.05 450.44 C661.4 455.58 655.48 461.07 650.42 467.8C646.82 472.58 643.07 477.16 640.01 482.32 C635.9 489.25 632.7 496.4 630.44 504.12C615.15 556.28 645.87 607.39 659.04 656.45 C661.42 665.3 664.24 674.56 665.2 683.69C669.51 724.75 667.12 764.52 653.33 803.75 C651.46 809.07 649.79 814.4 647.67 819.64C646.6 822.27 636.73 842.86 637.89 843.52ZM637.98 233.8 C635.99 238.01 627.34 242.23 623.53 244.98C608.22 256.03 590.81 261.83 572.01 256.79 C564.57 254.8 558.08 250.56 551.82 246.22C548.79 244.12 541.73 241.42 540.07 238.22 C540.19 234.79 548.21 228.75 550.62 226.24C564.62 211.66 584.01 206.35 603.46 212.61 C611.35 215.16 618.44 219.88 625.22 224.52C627.84 226.31 637.68 230.62 637.98 233.8Z";

/** The fill the vector carries. Never the accent slot; see the note above. */
export const SIGNET_CREST_GOLD = "#DDB844";

/**
 * The crest as decoration. Every call site so far pairs it with text that
 * already names the brand, so it announces nothing of its own.
 */
export function SignetCrest({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role="presentation"
      focusable="false"
      aria-hidden="true"
    >
      <path fill={SIGNET_CREST_GOLD} d={SIGNET_CREST_PATH} />
    </svg>
  );
}
