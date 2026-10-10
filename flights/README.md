# Flights scout

The Flights section scouts airline pages and labelled sale announcements for international travel from
Manila (MNL), Cebu (CEB) and Clark (CRK), with flexible dates and worldwide
destinations. It uses no model calls, fare API subscription, affiliate feed or
automated booking. Current sources: PAL Manila/Cebu, Cathay Philippine/US/UK
offers, AirAsia Philippine campaigns, Cebu Pacific seat sales and Scoot
Manila/Cebu/Clark.

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

The UI filters airports, destination/airline, currency, journey and departure
window. Quotes are sorted within native currency, journey and cabin groups;
discount percentages are never ranked against priced fares.
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
