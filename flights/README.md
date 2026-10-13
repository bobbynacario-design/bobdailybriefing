# Flights scout

Budget-airline coverage now uses Scoot's current `www.flyscoot.com/flights/`
pages and visible AirAsia MOVE route cards for Manila to Cebu, Boracay,
Puerto Princesa and Bangkok. MOVE fares require a dated, single-adult,
economy one-way flight search link, matching visible route/date/currency/price,
and a recognised operating airline. Flight+hotel packages are excluded.
Cebu Pacific announcements can cover domestic, international or both markets;
their starting base fare never enters ticket-price rankings. Cebu's interactive
booking inventory still requires a user check when no dated fare can be read.

The shortlist ranks exact-date flight + room estimates where fresh converted
hotel prices exist, then airfare-only options labelled with missing hotel costs.
Budgets apply to known costs plus the user's allowance, not a verified final
total. Unknown taxes, bags and transfers remain explicit. Every shortlisted
trip identifies budget airlines lacking fresh same-route, same-date and
same-journey economy samples. One-way budget fares have a separate lane and
are never doubled into invented return-ticket prices. Comparison searches
carry the route and dates; official airline links require setting dates there.

The trip assistant ranks up to three distinct destinations from fresh economy
return samples using PHP fare equivalents, trip nights, optional budget and a
user-provided extra-cost allowance. It explains its choice, offers alternate
observed samples, and lists missing taxes, baggage and stops. A baggage
preference highlights unconfirmed allowance; nonstop-only requires explicit
stop data. Unsupported or stale FX rates are omitted from PHP ranking. This
is a shortlist of advertised samples, not live availability, a verified all-in
total or a claim to find the cheapest possible flight. All other offers remain
in a collapsed browser. No paid provider or model call is used.

Each refreshed offer compares against the previous scout (at most seven days
old). Price changes require matching exact travel dates, route, cabin, journey
and currency. Retained failed-source records never generate new change signals.
New observations and approaching campaign deadlines are labelled separately.
Offers from a page the previous scout did not read are first observations.

Price memory: each scout also writes `briefings-bob/flights-history` (no uid,
so members can read it), holding the lowest advertised fare per route per PHT
day for 60 days. A route is origin, destination, journey, cabin and currency,
across airlines and sample dates, because sample dates rotate between scouts.
Only offers re-read in that scout count. The app compares a city's best fare
with earlier days of the same route only: below every earlier day is a
"new low"; otherwise it states the lowest seen and the difference. Memory
began on 10 Oct 2026, so the first comparison appears after the next day's
scout.

Domestic hotel cards cover Boracay, El Nido, Siargao, Cebu, Bohol and Puerto
Princesa. Manila staycations cover Manila, Makati and Pasay. Where fewer than
two flight-date stays exist, these destinations also price the next two
Friday–Sunday weekends (strictly future check-in dates), within the existing
call budget and quote cache. Weekend cards need no airfare and show room-only
totals, exact dates, guests and checked times. Only qualifying observed rates
get a discount badge; other rates are labelled for comparison.

Hotels: after each scout, `npm run hotels` (refresh-hotels.js) writes
`briefings-bob/hotels-latest` (no uid). For every city in `hotel-cities.js`
it keeps three well-reviewed hotels (Tripadvisor rating 4+, 150+ reviews,
best-value order) plus a cheaper budget pick, each with Tripadvisor's typical
nightly range. Then it prices one room for two adults for the exact dates of
the city's cheapest fresh economy return fare, and of the cheapest from a
second departure airport when those dates differ. The source is Xotelo's free,
keyless API, which relays the booking sites Tripadvisor lists (Booking.com,
Agoda, Trip.com and others), per room per night in USD; the app converts to
PHP with its dated PH market rate. Quotes for unchanged dates are reused for 20
hours, and the hotel list for 7 days. A run makes at most 420 calls, three at a
time. A failed call leaves that hotel unpriced, and a run that reads nothing
keeps the previous document. These are site rates for those dates, not
availability or a final total, and taxes may be extra. Destinations without a
Tripadvisor key get search links only. `npm run hotels:dry-run -- --only=Tokyo,Taipei`
reads the live flight scout and prints the stays without writing.

Your own trips: the Flights page saves the owner's leave windows and poker
trips to `hotel-trips-<uid>` (kind `hotel-trips`, uid-scoped). After the shared
document, the same step prices each trip (at most 12 per account, 1 to 30
nights, a city in `hotel-cities.js`) against its city's hotels and writes
`hotel-stays-<uid>`, which only that account can read. A poker trip whose venue
is a listed hotel (INSPIRE Entertainment Resort, Incheon) adds the venue first;
the venue lookup is one 100-hotel list call, kept for 7 days. Trip quotes are
reused for 20 hours; all accounts share a 150-call budget per run. Shared
documents never hold anyone's dates. `--trips-file=<json>` replaces the saved
requests in a dry run.

The Flights section scouts airline pages and labelled sale announcements for international travel from
Manila (MNL), Cebu (CEB) and Clark (CRK), with flexible dates and worldwide
destinations. It uses no model calls, fare API subscription, affiliate feed or
automated booking. Current sources: PAL Manila/Cebu airport pages and country
pages (Manila to Japan, South Korea, Vietnam, Australia and the US; Cebu to
Japan and the US), Cathay Philippines/Cebu plus Japan, Australia, US, Canada
and UK pages, AirAsia Philippine campaigns, Cebu Pacific seat sales and Scoot
Manila/Cebu/Clark (Scoot currently returns HTTP 403, so Clark has no priced
fares). Fares are trimmed round-robin across routes, cheapest first, to at most
`MAX_OFFERS` (400), so one busy route cannot crowd out a destination and the
document stays well under the 1 MiB Firestore limit; the dry run logs `bytes`.

Cebu Pacific's JavaScript seat-sale page is also checked, with a public Hello
Mnl press-release RSS feed and Logistics News PH's Cebu Pacific feed as labelled
fallbacks. Article links are checked during the scout; matching campaigns prefer
a reachable publisher. When no publisher opens, the card keeps the extracted
terms and airline booking link, but shows the announcement link as unavailable.
The reader requires an
international campaign, an explicit one-way base fare, fee exclusions, booking
dates and a travel window. Missing booking years come from the dated article;
old, expired or incomplete announcements are rejected. Campaigns appear first,
are filtered by overlapping travel windows, and disappear after the booking
deadline in Philippine time. Saved expired campaigns remain historical only.
They never imply the base fare is a final ticket total or available on a
particular route. The article link and publisher are shown separately from the
official airline booking link. This is a continuing feed reader, not a
hard-coded listing of the October sale.

`npm run dry-run` reads without writing. `npm run refresh` writes
`briefings-bob/flights-latest` and the dated `flights-YYYY-MM-DD` snapshot, using
the existing Firebase service account or ADC. The GitHub intelligence workflow
scouts at 08:00 and 20:00 PHT daily; scheduled starts may be delayed. Reruns
within six hours reuse the last scout unless `--force` is provided.

The HTML reader scopes price/date/currency/journey fields to one fare card. It
rejects domestic routes, unsupported origins, past departures, invalid amounts
and incomplete round trips. Aggregate page headline prices are never assigned
to a route. Dates, amounts and currencies are not generated or inferred.
AirAsia's visible discount campaigns are separate, unpriced records; hidden
accessibility-label prices are ignored. Missing booking deadlines and travel
windows remain explicitly unverified, not advertised as active sales.

Pages requiring JavaScript or rejecting the reader remain visible in source
coverage as unavailable. No anti-bot bypass is attempted. Partial scans publish
successful sources and can retain quotes from failed sources for at most 48
hours with their **original** check timestamp. A completely failed scout leaves
the last successful snapshot intact and records a failed feed-health status.
Offers older than 26 hours are labelled old in the UI. Airline-advertised fares
may already be unavailable even when the source check is recent.

The UI filters airports, destination/airline, cabin (Economy by default; the
status line counts hidden business and premium fares), journey and departure
window. Priced fares appear on a destination board: one row per city (airports
such as NRT/HND/TYO merge), grouped by region near to far and separated by journey and cabin, ranked by the PHP
estimate with fares lacking a current rate after them. Opening a city lists every
observed date pair with weekday dates, nights, airline link and Save. Each fare retains expandable restrictions, its source-check timestamp and the dated exchange rate. Discount
percentages are never ranked against priced fares.
USD and AUD fares also show approximate PHP equivalents using the existing
PH market snapshot rates, with their date and an older-rate label at four days.
Unsupported currencies or failed FX reads show no inferred conversion. Bank or
card rates and fees may differ. Converted amounts are display-only and are not
stored in the shortlist.
Date filters omit
undated campaigns. Coverage is not an exhaustive worldwide search or live
inventory. Tax, baggage and connection uncertainty are explicit. The airline
link opens the offer/search page for the user to confirm the final itinerary.

Saved offers are transactionally written to `flights-saved-<uid>` with a `uid`
field, limited to 100 snapshots. Removal merges against the latest transaction
snapshot. A failed preference read disables saving; account changes discard
pending renders. Saved snapshots remain available when the live offer changes
or disappears and are clearly labelled historical/expired where applicable.

Domestic selector: International remains the default. Domestic choices are limited to Boracay (Caticlan/MPH), El Nido (ENI), and Siargao (IAO), with individual destination choices. PAL destination pages are scouted for Boracay and Siargao; only departures from Manila, Cebu and Clark are accepted. Other Philippine destinations and broad international campaigns are excluded from domestic results. El Nido provides a labelled Cebu Pacific booking fallback when no readable quote is available, without claiming a confirmed route, fare or seat. Domestic shortlist checks omit Philippine international travel tax.

Hotel recommendation safeguards: quotes are old in the UI after 40 hours (missing
or invalid timestamps are also old). The scout reuses a quote for up to 20
hours and its twice-daily runs can start hours late, so a current quote can
reach about 36 hours; 40 marks only a quote the scout has really missed. Old rates never feature as deals or enter
current totals. The 10% threshold uses the raw price, and the label explicitly
compares with Tripadvisor's typical minimum, not a verified same-room saving.
Featured deals prefer matches with planned trip dates, then estimated flight
plus stay cost; unconverted totals sort last. The source does not provide room
type, cancellation, breakfast or tax inclusion; one note per list says so.

Signed-in owners can edit a stay's dates, 1–4 rooms and 1–8 adults (at least one
adult per room). Dates must be real calendar dates and a future stay of 1–30
nights. Edits are saved with the private trip requests, survive reloads, and
are priced by the next scout. Cache reuse requires identical dates and guests;
new settings never display old occupancy quotes. Rates are per room per night,
so stay totals multiply by the requested room count (Xotelo returned the same
per-room figure for 1 and 2 rooms on 12 Oct 2026). Google Hotels ignores guests
in the search text, so links carry dates only and an edited stay says what to
set there ("set 2 rooms, 4 adults there").
Reset hotel settings removes an override. Edits whose check-in has come, or
edited fare stays whose fare has left the scout, are dropped from the saved
requests (never when the scout failed to load). Shared quotes remain one room/two
adults. Use arrival, rather than departure, as the hotel check-in date.
