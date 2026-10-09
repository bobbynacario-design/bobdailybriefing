# Flights scout

The Flights section scouts airline-owned pages for international travel from
Manila (MNL), Cebu (CEB) and Clark (CRK), with flexible dates and worldwide
destinations. It uses no model calls, fare API subscription, affiliate feed or
automated booking. Current sources: PAL Manila/Cebu, Cathay Philippine/US/UK
offers, AirAsia Philippine campaigns, Cebu Pacific seat sales and Scoot
Manila/Cebu/Clark.

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

The UI filters airports, destination/airline, currency, journey and departure
window. Quotes are sorted within native currency, journey and cabin groups;
discount percentages are never ranked against priced fares. Date filters omit
undated campaigns. Coverage is not an exhaustive worldwide search or live
inventory. Tax, baggage and connection uncertainty are explicit. The airline
link opens the offer/search page for the user to confirm the final itinerary.

Saved offers are transactionally written to `flights-saved-<uid>` with a `uid`
field, limited to 100 snapshots. Removal merges against the latest transaction
snapshot. A failed preference read disables saving; account changes discard
pending renders. Saved snapshots remain available when the live offer changes
or disappears and are clearly labelled historical/expired where applicable.
