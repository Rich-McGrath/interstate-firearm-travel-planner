# GunNav — Planning-Tool Feature Backlog

A backlog of features and changes that lean further into GunNav's
planning-tool identity rather than the navigation-app direction.
None of this is committed; pull from it as time and interest allow.

The organizing principle: GunNav's edge is the legal-awareness layer
that no other tool has. Features that sharpen that edge are
high-priority. Features that pull GunNav toward becoming a Waze
competitor dilute the differentiation and are deprioritized.

---

## Quick wins (small, high-leverage)

### Drag-to-reorder stops on the map
Currently stops can only be reordered via the form's up/down arrows.
Letting users drag a marker on the map (or a row in the stops list)
directly is a substantial UX upgrade for trips with three or more
stops. The plumbing is mostly in place — the trip-stops state lives
in `App.tsx` and the form already has reorder handlers.

### Compare two routes side-by-side
When the user picks an alternative route, the primary becomes
invisible. Showing both summaries on screen at once — distance,
duration, states crossed, risk score, permit recognition counts, FOPA
conditions — would make the choice between primary and alternative
much more deliberate. Today the alternative panel is underutilized.

### Named / saved trips
"Recent trips" is currently a chronological list with auto-generated
labels. Letting users rename and pin trips ("Annual hunting trip to
MT," "Visit Mom in NJ") makes the recents list useful as a real
saved-trips library. Pure `localStorage` change, no backend.

### Trip duplication
"Duplicate this trip and edit" — useful when planning the return leg
or a similar trip with a different vehicle. Two clicks. Trivial.

### Print-friendly view
A PDF or printable version of the analysis (carry warning, per-state
breakdown, FOPA conditions, checklist) that someone can print and put
in the glove box. Real users carrying real legal exposure want a
paper copy. CSS-only `@media print` stylesheet. Cheap.

---

## Medium-effort improvements

### "Avoid this state if possible" routing
Click a strict state on the map, hit "Avoid this state if possible,"
and GunNav recomputes the route avoiding it (when geometrically
feasible). Mapbox Directions supports `exclude` parameters for some
constraints. Showcases the legal-awareness angle in a way no other
nav tool does.

### Trip cost estimator
Given MPG, tank size, and a fuel price input, show estimated fuel
cost. Optional per-state info — fuel tax differs meaningfully across
states. Doesn't require new data, just light arithmetic in the UI.

### "What changes if I get a permit?" mode
Currently the carry warning shows what's blocked given the user's
reported permit (or no permit). A toggle that re-evaluates as if
they had a permit from each major issuing state would help users
decide whether getting an additional non-resident permit is worth
it. Pure rule re-evaluation; no new data.

### Multi-trip / "trip planning calendar"
For users who travel routinely, a view that shows a season of
planned trips with collective stats (total days armed under various
recognition tiers, common destinations). A power-user feature.

### Custom waypoint annotations
Let users add notes to a stop ("Mom's house — gun in safe
overnight," "Gas only, don't go inside store with carry") that
persist across reloads. Pure `localStorage`, useful for repeat
trippers.

### Better overnight handling
Right now the trip is treated as one continuous drive. Real users
break long trips into legs (overnight stays). Letting the user mark
a stop as "overnight" changes the legal posture (you're now staying
in a state, not transiting through it — relevant to FOPA) and
changes fuel-aware planning (you'd refuel in the morning regardless
of range). A real product-shape question, not just a UI tweak.

---

## Bigger ideas (real commitment)

### Hotel / lodging integration
Search overnight stops along the route, filter by states with
gun-friendly storage rules. Probably needs an API like Booking.com's
affiliate program. Veers into "becoming a travel app" territory,
which is a bigger pivot.

### User-contributed verification
A "Verify a state" workflow where a user who's actually checked the
state's law can submit a confidence-high entry with a date and
source, curated and moderated by the maintainer. Solves the "only
4 of 51 states are high-confidence" problem at scale, but introduces
real moderation overhead and trust questions. Don't take this
lightly.

### Saved permits and vehicles
The form fields are entered fresh per trip (auto-restored from last
submit, but not multi-permit aware). For a user with two permits
and three vehicles, having a "select my Texas LTC + my truck" preset
would be a quality-of-life upgrade. Requires a profile concept,
which means a settings page, which means a bit more state to manage.

### Real-time legal change alerts
"California passed a new magazine bill this week — your route
through CA changed from caution to high." Requires a feed of legal
changes (could be RSS-driven or manually curated), email
subscription, and a way to associate a saved trip with email alerts.
Real engineering and content work. Could be a paid tier if GunNav
ever monetizes.

### iOS / Android app wrapper
The web app is mobile-friendly, but a real native app (or at
minimum a PWA install prompt) lets users keep GunNav in their
phone's app dock. PWA is cheap and a meaningful UX win. Native
apps are real engineering and app-store overhead — probably not
worth it until there's meaningful traction.

---

## Things to NOT prioritize

These would pull GunNav toward becoming a navigation-app competitor,
which dilutes the planning-tool identity that makes it valuable.

- **Voice navigation / turn-by-turn driving mode** — pulls toward
  the nav-app pivot.
- **Real-time traffic** — same reason, plus expensive at scale.
- **Social features** ("share my trip," forums) — adds moderation
  overhead for marginal value.
- **Multi-language support** — US-only legal content, low payoff
  until international expansion.
- **AI features** (chat about gun laws, etc.) — distracts from the
  deterministic-rules-engine identity that makes GunNav
  trustworthy.

---

## Top three to consider first

If only three of these get built in the next month or two:

1. **Print-friendly view** — cheap, immediately useful for a
   real-world use case. Gun owners want documentation in the car.
2. **"Avoid this state" routing** — showcases the legal-awareness
   differentiator, doesn't require new data, makes for a great
   demo.
3. **Compare two routes side-by-side** — sharpens the existing
   primary / alternative split that today is underutilized.
