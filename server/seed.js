/**
 * seed.js — first-run content.
 *
 * Runs ONCE, only when the database is completely empty. It gives you a
 * library that opens in a working state instead of a blank shell. Every
 * prompt here is an example: delete them, they are not special.
 *
 * Skip it entirely with SEED=0 npm start.
 */

const CATEGORIES = [
  { name: "UI/UX",             hue: "--h-violet" },
  { name: "Digital Marketing", hue: "--h-cyan"   },
  { name: "Graphic Design",    hue: "--h-pink"   },
  { name: "Other",             hue: "--h-amber"  },
];

const PROMPTS = [
  { cat: "Digital Marketing", title: "SEO Content Strategist", body:
`Act as an SEO strategist. Help me build SEO content for [brand/business/niche].
My target audience is [target audience], and my primary goal is [traffic/leads/sales/awareness].

Give me:
1. 20 keyword suggestions around [topic]
2. The search intent behind each keyword
3. A difficulty rating: beginner, medium, or advanced
4. Blog topic ideas tied to each keyword
5. A suggested title, meta description, and content angle
6. FAQs people are likely searching for
7. A basic content cluster structure

Keep it practical and easy for a beginner to follow.` },

  { cat: "Digital Marketing", title: "Content Pillar Builder", body:
`Act as a content marketing strategist. Build a content strategy for [brand/business/niche].
The audience I'm targeting is [target audience] and my goal is [brand awareness/lead generation/community building/sales].
I want content built around [main topic].

Give me:
1. 5 content pillars
2. 10 content ideas for each pillar
3. The best format for each idea — reel, carousel, blog, newsletter, LinkedIn post, or short video
4. A hook for each content idea
5. A CTA for each content idea
6. How each idea helps the audience
7. How each idea supports the business goal

Make sure the content stays clear, valuable, and beginner-friendly.` },

  { cat: "Digital Marketing", title: "Social Calendar — 30 Days", body:
`Act as a social media manager for [brand/business/niche] on [platform].
Audience: [target audience]. Tone: [tone]. Posting [n] times per week.

Build me a 30-day calendar with, for each slot:
- Format (reel / carousel / static / story / short video)
- Hook line, written to stop the scroll in under 2 seconds
- Caption with a clear CTA
- 8 hashtags mixing broad and niche
- What the post is actually doing for the funnel: reach, trust, or conversion

Flag which three posts are most likely to outperform, and say why.` },

  { cat: "Digital Marketing", title: "Paid Ads Angle Generator", body:
`Act as a paid media buyer running [Meta Ads/Google Ads] for [brand/business/niche].
Budget is [monthly budget], target CPA is [target CPA], offer is [offer].

Give me:
1. 6 distinct campaign angles — each built on a different buyer motivation
2. 3 primary text variants per angle
3. 3 headline variants per angle
4. The audience/targeting hypothesis behind each angle
5. Which creative format suits each angle
6. A simple testing order: what to kill first, what to scale

Write the copy so a human wrote it, not a template.` },

  { cat: "UI/UX", title: "Design Critique — Heuristic Pass", body:
`Act as a senior product designer reviewing [screen/flow] for [product].
The user is trying to [user goal]. Success looks like [success metric].

Run a critique in this order:
1. What the screen communicates in the first 3 seconds
2. Visual hierarchy — what wins attention, what should have
3. Nielsen heuristic violations, named and located
4. Cognitive load: what can be removed outright
5. Accessibility: contrast, target size, focus order, screen reader labels
6. Three concrete revisions, ranked by impact-to-effort

Be direct. Skip the compliments — I need what's wrong.` },

  { cat: "UI/UX", title: "User Flow Skeleton", body:
`Act as a UX architect. Map the flow for [feature] in [product].
Primary user: [persona]. Entry point: [entry point]. Desired end state: [end state].

Produce:
1. The happy path, step by step, with the decision at each step
2. Every branch: error, empty, loading, permission-denied, offline
3. What the user must already know at each step, and where they learn it
4. The single step most likely to cause drop-off, plus a fix
5. Which steps can be removed or deferred without breaking the goal

Output as a numbered flow I can hand to engineering.` },

  { cat: "Graphic Design", title: "Brand Identity Brief", body:
`Act as a brand designer. Write an identity brief for [brand name], a [category] serving [target audience].
Brand personality: [3 adjectives]. Direct competitors: [competitors].

Deliver:
1. A one-line positioning statement
2. Logo direction — wordmark, lettermark, or symbol — and why that one
3. A 5-colour palette with hex codes, and the job each colour does
4. A type pairing: display and body, with the reason for each
5. Three things the brand must never look like
6. How the identity holds up at 16px and on a billboard

Justify every choice against the positioning, not taste.` },

  { cat: "Graphic Design", title: "Poster Concept Sprint", body:
`Act as an art director. Generate 8 poster concepts for [event/product].
Format: [size]. Must include: [required elements]. Mood: [mood].

For each concept give me:
- The single visual idea in one sentence
- Composition: where the eye enters, travels, and lands
- Type treatment and hierarchy
- Colour approach
- The one risk that could make it fail

Rank all 8 from safest to boldest, and tell me which you'd actually print.` },

  { cat: "Other", title: "All-In-One Master Prompt", body:
`You are my senior operator across strategy, design, marketing, and copy.
Context: [business/project]. Audience: [target audience]. Goal this quarter: [goal].
Constraints: [budget/time/team].

Before answering anything:
1. Restate the real problem in one sentence
2. Name the assumption most likely to be wrong
3. Give the recommendation, then the reasoning — that order
4. Include what you would NOT do, and why
5. End with the single next action, doable in under an hour

Never hedge. If the ask is wrong, say so and give me the better ask.` },
];

/** Seeds only a truly empty database. Safe to call on every boot. */
function seedIfEmpty(store) {
  if (!store.isEmpty()) return { seeded: false, reason: "database already has content" };
  if (process.env.SEED === "0") return { seeded: false, reason: "SEED=0" };

  const byName = new Map();
  for (const c of CATEGORIES) byName.set(c.name, store.createCategory(c));
  for (const p of PROMPTS) {
    store.createPrompt({ title: p.title, body: p.body, categoryId: byName.get(p.cat).id });
  }
  return { seeded: true, categories: CATEGORIES.length, prompts: PROMPTS.length };
}

module.exports = { seedIfEmpty, CATEGORIES, PROMPTS };
