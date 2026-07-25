---
name: plain-prose
description: Write or edit prose a person will actually read - site copy, headings, captions, README and docs text, PR and issue bodies, release notes, commit messages. Use it before writing that text, not only when someone complains it reads like AI. Catches significance inflation, false-sophistication vocabulary, participle commentary, rule-of-three padding, em-dash overuse, and copy that explains a design decision instead of just making it.
---

# Plain prose

Most AI writing fails the same way: it keeps telling the reader that what it
just said was important. Cut that habit and almost everything else follows.

Two rule sets are merged here. Read both, then the checklist.

## The five rules

From `kylehughes/writing-prose-like-a-human-for-agents`.

**1. Be specific, not significant.** State the fact. Do not rate it. "The
building was renovated in 1987" beats "the 1987 renovation played a pivotal
role in shaping the building's enduring legacy."

**2. Use plain verbs.** `is`, not `serves as`. `shows`, not `showcases`.
`has`, not `boasts`. Better still, name the action: "validates inputs" beats
"serves as a validation mechanism."

**3. End the sentence at the fact.** Trailing participles are opinion wearing
the costume of analysis. Delete "highlighting its importance", "reflecting
broader trends", "underscoring the need for".

**4. Vary the rhythm.** Not every list is three items. Not every sentence
carries two clauses. Do not open consecutive sentences with Additionally,
Furthermore, Moreover.

**5. Earn every adjective.** If removing it does not change the meaning,
remove it. `vibrant`, `stunning`, `bustling`, `sharply`, `actually`.

## The thirteen tells

From `Byk3y/no-slop`, which encodes Wikipedia's *Signs of AI Writing* - a
living page maintained by editors who read a great deal of AI text.

1. Watchlist vocabulary. See `references/vocabulary.md`.
2. Dressed-up copulas: `serves as`, `stands as`, `boasts`, `represents`.
3. Promotional tone in technical writing: `groundbreaking`, `revolutionary`,
   `game-changing`.
4. Vague attribution: `experts say`, `studies suggest`, `it is widely
   regarded`. Name the source or drop the claim.
5. Structural formulas: rule of three, `not just X but Y`, `from A to B`.
6. Participle chains: strings of `-ing` clauses doing filler work.
7. Elegant variation: three different words for one thing across a paragraph.
   Repeat the word. Repetition is not an error.
8. Overstated significance: `marks a turning point`, `a testament to`.
9. Em dash overuse. One or two per page. Use a comma, a full stop, or
   parentheses.
10. Collaborative filler: `let's explore`, `as we can see`, `now, let's`.
11. Knowledge-cutoff and capability disclaimers, unless genuinely load-bearing.
12. Formatting excess: over-bolding, emoji as section markers, Title Case
    Headings, a table for two values.
13. The inverse - human habits worth keeping: contractions, uneven sentence
    length, concrete nouns, an opinion stated outright.

## Two more, learned on this project

**Do not explain the design to the reader.** If a section is placed somewhere
deliberate, place it. Copy that says "asked here, after your design, because
this is where it starts to matter" is the writer talking about their own
decision. Cut to the thing itself.

**Structural devices must encode something true.** Numbered markers
(01 / 02 / 03), steppers and eyebrows are only earned when the content really
is a sequence. Four renders of an assembly are a sequence. Four product shots
are not.

## Checklist before shipping copy

- [ ] Every sentence would survive a reader asking "so what did you actually
      say?"
- [ ] No word from `references/vocabulary.md` survives without a reason.
- [ ] No sentence ends in a participle that comments on the sentence.
- [ ] Fewer than three em dashes on the page.
- [ ] Lists are the length the content is, not three.
- [ ] Headings are sentence case.
- [ ] Straight quotes and apostrophes, not curly.
- [ ] Nothing tells the reader how to feel about what they just read.

## This repository specifically

Bee Home copy is **adapted from the original beehome.design**, recovered in
`docs/reference/extracted/original-copy.md`. Reach for that file before
writing anything new. The original voice is plain and slightly formal, writes
to a person who is about to make something, and never oversells the object.

Match it. Do not generate fresh marketing prose alongside it - the seam shows
immediately.

## Sources

- `kylehughes/writing-prose-like-a-human-for-agents` - the five rules.
- `Byk3y/no-slop` (MIT) - the thirteen patterns, derived from Wikipedia's
  *Signs of AI Writing* (CC BY-SA).
- Also worth reading: `hardikpandya/stop-slop`, `yzhao062/agent-style`.

Rules here are restated in our own words and extended with project-specific
guidance; nothing is vendored.
