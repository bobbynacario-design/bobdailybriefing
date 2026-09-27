# Phase G: the update cycle (closed by rehearsal)

Status: **closed, 2026-09-27.** Bob asked to close this phase rather than wait
for the ABS to publish August 2026 CPI on 30 September. Phase G exists to prove
that the lifecycle, the consumers' replacement handling and the receipts work
end to end. That was proven with the production code, the live release history
and RiskM8's real import state. Only the August figure was test data.

When the real August release arrives, it goes through this same path as routine
operation (see "When the real release arrives").

## The rehearsal

1. **Daybook.** The real publisher (`grounding/publisher/publish.js`) with the
   real registry ran on a scratch clone of the live `grounding-data` branch
   (release 000003). It was fed an August-shaped ABS page and Data API answer
   (**3.3%, test data**) and the real, stored FWO pay guide. It cut release
   000004 in scratch; nothing was pushed.
   - `abs_cpi_all_groups_annual_change@2026-08#r1` is current and supersedes
     `@2026-07#r1`. July is kept as history, marked superseded.
   - The change notice reads "CPI, all groups, annual change (Australia):
     3.5% → 3.3% (2026-07 → 2026-08)".
   - The CPI watch moved to the ABS's next date (2026-10-28).
   - The award is untouched.
2. **RiskM8.** Its own importer (`functions/scripts/import-daybook-grounding.js
   --release`) ran on that release. It used a scratch copy of its real
   `docs/daybook-imports/import-state.json` (July imported from release 2), and
   everything it wrote went to scratch. `git status` in RiskM8 was empty before
   and after.
   - **1 candidate:** `dbk_abs_cpi_2026_08`, marked "replacement for …@2026-07#r1".
     It is source-linked, fact-verified, cross-checked and plausible, with the BI
     note as it would print: "Consumer prices (CPI, annual change): 3.3% in the 12
     months to August 2026 …".
   - **1 flag:** July is superseded, with the instruction "retire it in
     library/provenance.js ACCEPTED_FACTS and consider the replacement".
   - **1 skip:** the award, "series not allowlisted".
   - The receipt names release 4, its manifest and `riskm8-daybook-map/2`. The
     state now holds both record ids, with July flagged.
   - **Run again:** "noop: release 4 already imported". No duplicate candidate.
3. **BI-Assessor**, planned with the same contract code, from its current
   position (release 3 imported, the award applied): nothing to import.
   - The award is a **duplicate**, so it is never proposed twice.
   - July is historical (superseded).
   - August CPI is "series not allowlisted".

## What the rehearsal cannot prove

Only that the real August page reads the same way. If the ABS changes its
wording or layout, the parser fails closed: the CPI watch turns **blocked**,
saying what it saw, and that reaches the Morning 5 as a Numbers item. If the
Data API disagrees, the result is a **conflict**; if it can't be reached, the
figure is held for the day. None of these can publish a wrong figure.

## When the real release arrives (routine, not a phase)

- **1 October, 04:15 PHT, automatic.** Daybook publishes the next release with
  the real August figure. It is 000005, because Phase H-1 took 000004. The Morning 5 shows "CPI … 3.5% → x% (2026-07 → 2026-08)"
  under Numbers.
- **RiskM8, when Bob sees that item.** Run the network import. The review file
  says exactly what to do: accept the replacement into
  `library/provenance.js`, retire July's accepted fact, commit, and deploy.
- **BI-Assessor:** nothing to do.
