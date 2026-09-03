---
name: yolo-design
description: Design decisions for Yolo Learn - palette, type scale, buttons, icons, layout. Use before changing any visual styling in this repo, or when tempted to add a colour, a card, or an icon.
---

# Yolo Learn design rules

Written after four palettes were built and three were thrown away. Every rule
here exists because something specific failed. Read the reason, not just the
rule, because the reason is what generalises.

## The one rule that matters

**Actions are monochrome. Colour means something or it is not used.**

Measured on the two reference sites for this category, in September 2026:

| | Primary button | Weight | Size | Radius |
| --- | --- | --- | --- | --- |
| vercel.com | `rgb(23,23,23)` on white | 500 | 16px | 8px |
| linear.app | `rgb(229,229,230)` on near-black | 510 | 16px | pill |

Neither puts a brand colour on its primary action. Lime, then blue, then deep
green were each rejected for the same underlying reason: a coloured CTA is what
a template does, and the eye reads it as decoration competing with the content.

So: primary action is `var(--ink)` with `var(--page)` text. Colour is reserved
for severity (`high` red, `medium` amber) and flow health (`healthy`,
`drifted`). When the only colour on screen is a red chip, it cannot be missed,
which is the entire point of having it.

## Type

Measured on linear.app, vercel.com and resend.com: display type is **large,
LIGHT and set at leading 1.0**. All three. Bold-at-30px was the single biggest
amateur tell in the first build.

- `h1` `clamp(34px, 5.4vw, 56px)`, weight **450**, leading **1.02**, tracking `-0.035em`
- `h2` 30px, weight 450, leading 1.12
- Body 16px, leading 1.55
- Buttons 15px, weight **500** and never 600
- Geist Variable, self-hosted. Never a Google Fonts `<link>`.

## Buttons

```css
button, .cta { font-size: 15px; font-weight: 500; border-radius: 8px; padding: 9px 16px; }
button.primary, .cta { background: var(--ink); color: var(--page); }
button { background: var(--surface); border: 1px solid var(--border-strong); }
```

A cramped bold button is the loudest amateur signal in a developer tool. Give
it real horizontal padding.

Every interactive element gets one focus treatment:
`outline: 2px solid var(--ink); outline-offset: 2px`.

## Icons

Hand-written SVG, deliberately, against the general advice to use a library.
This is a zero-dependency project and an icon set would be its largest
dependency, and no generic set has a mark for "the site moved out of register".

Two passes failed in opposite directions and that is the lesson:

- Too much detail (opacity, dashes, eight segments) turns to mud at 16px.
- Bare primitives are legible and say nothing. A plus sign is not "mint".

What works is a **distinctive silhouette**. Rules: stroke 1.9, everything
inside a 20x20 safe area, no feature under 2px, no opacity, no dashes.

**Render every new glyph at 16/20/28px and look at the sheet before shipping.**
Three passes were wasted designing them in the abstract. Pair related concepts:
drift is two frames out of register, heal is the frame back in register.

Never repeat one glyph down a list. Four identical slashed circles read as a
stamp; give each item its own subject and let the heading carry the negation.

## Layout

- One theme per page. Sections never invert.
- No three-column equal feature cards.
- No layout family twice on one page.
- Max one small-caps eyebrow per three sections.
- **Zero em-dashes** anywhere user-visible. Use a plain hyphen.
- Evidence goes near the top. The strongest proof sat five sections down and
  nobody reached it.

## Before shipping any visual change

1. Screenshot it and actually look. Three icon passes and two palettes shipped
   without this and all five were wrong.
2. Check both themes.
3. Check contrast: an accent that cannot carry text needs a second darkened
   token everywhere, which is how the lime palette became unmaintainable.
