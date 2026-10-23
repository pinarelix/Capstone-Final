# Patrol Prioritization Rules for Incident Record Types

## Purpose

Classify each incident record type by whether it warrants a patrol, and define when a normally non-patrol type should trigger a **barangay patrol schedule** because of a high severity risk score.

## Core Principle

Patrol is appropriate for crimes that are **visible, location-based, ongoing or likely to recur, and preventable by physical presence**. Crimes that are document-based, online, or private disputes are better handled through investigation, mediation, or case follow-up.

## Classification Summary

| Class | Meaning | Patrol action |
|---|---|---|
| **TIER_1** | High priority | Auto-patrol (regular or hotspot) |
| **TIER_2** | Moderate priority | Conditional patrol (periodic or time-based, driven by frequency and location clustering) |
| **SEVERITY_OVERRIDE** | Excluded by default | Barangay patrol schedule **only if risk score is High or above** |
| **NO_PATROL** | Investigation, mediation, or referral | No patrol, even at high severity |
| **UNCLASSIFIED** | Needs a human decision | Flag for supervisor review |

---

## TIER_1: Auto-patrol

- Homicide
- Attempted Murder
- Robbery
- Arson
- Attempted Arson
- Illegal Release of Fire Arms
- Kidnapping
- Theft
- Qualified Trespass to Dwelling
- Trespassing
- Vandalism
- Hit and Run
- Suspicious Activity
- Curfew Violation
- Alarms and Scandals

## TIER_2: Conditional patrol

Patrol when incidents repeat or cluster at the same location or time window.

- Physical Injury
- Less Serious Physical Injuries
- Slight Physical Injuries and Maltreatment (typical: brawls, drinking sessions)
- Grave Threat (when tied to a known location; also see override rules below)
- Noise Complaint
- Traffic Obstruction
- Anti Electricity Pilferage
- Occupation of Real Property or Usurpation of
- Altering Boundaries of Landmarks
- Missing (search and visibility patrol)
- Abandonment of a Person in Danger

## SEVERITY_OVERRIDE: Barangay patrol schedule when risk score is High or above

These are excluded from routine patrol, but a high severity risk score signals a live threat to a specific person or place.

| Record type | Trigger for override | Coordination |
|---|---|---|
| VAWC | Highest priority. Repeat or escalating abuse, protection order in effect, or respondent known to loiter near the victim's home | Barangay VAW desk |
| Child Abuse | Ongoing danger to a child at a known address | Barangay BCPC, DSWD / social welfare |
| Grave Threat | Credible threat to a named person with a known residence. Scheduled visibility near the complainant's home | Barangay |
| Threats | Same as Grave Threat | Barangay |
| Harassment | Stalking or repeated in-person harassment at the complainant's home or workplace | Barangay |
| Act of Lasciviousness | Offender lives or loiters nearby, or the victim is a minor | Barangay |
| Voyeurism Act | Perpetrator operates locally (e.g., peeping at a specific house or CR) | Barangay |
| Suicide | High-risk individual flagged for welfare checks | Health / mental health referral. Do not rely on enforcement alone |
| Abandoning a Minor | Child still at risk or missing | Barangay BCPC, DSWD |
| Inducing a Minor to Abandon His/her Home | Child still at risk or missing | Barangay BCPC, DSWD |
| Abandon | Child welfare case with unresolved safety concern | Barangay BCPC |
| BCPC | Child welfare case with unresolved safety concern | Barangay BCPC |
| Light Threats | Only if tied to an escalating neighbor conflict with violence risk | Barangay |
| Oral Defamation | Only if tied to an escalating neighbor conflict with violence risk | Barangay |

## NO_PATROL

Handle through investigation, mediation, or legal referral. Do not schedule patrols even at high severity.

- Falsification of Documents
- Scam
- Swindling of Estafa
- Estafa
- Estafa/Debts
- Fencing of Stolen Properties
- Breach of Contract
- Breach Contact
- Child Support
- Cybercrime Prevention Act 2012 (RA 10175)
- Cyber Bullying
- Intriguing Against Honor
- Unlawful Use of Means of Publication and Unlawful Utterances
- Prohibiting Publication of Acts Referred to in the Proceedings
- Incriminating Innocent Persons
- Threatening to Publish and offer to prevent
- Removal, Sale or Pledge of Mortgaged Property
- Safe Special Act
- Bastos Law
- Animal Welfare Acts
- Others

## UNCLASSIFIED: Flag for supervisor review

These were not covered in the original analysis. Do not auto-assign a patrol decision.

- Reckless Impudence Resulting to Damage to Property and Physical Injury
- Reckless Impudence Resulting Physical Injury
- Reckless Impudence Resulting to Damage to Property
- Crime Type (appears to be a placeholder or field label rather than a real record type; verify the data source)

Suggested default: treat the Reckless Impudence variants as TIER_2 only where they cluster at known traffic hotspots, otherwise NO_PATROL.

---

## Decision Logic

```
for each record:
    if type in TIER_1:
        patrol = AUTO
    elif type in TIER_2:
        patrol = CONDITIONAL   # based on recurrence + location clustering
    elif type in SEVERITY_OVERRIDE and risk_score >= HIGH:
        patrol = BARANGAY_SCHEDULE
    elif type in NO_PATROL:
        patrol = NONE
    elif type in UNCLASSIFIED:
        patrol = FLAG_FOR_REVIEW
    else:
        patrol = FLAG_FOR_REVIEW
```

Types in both TIER_2 and SEVERITY_OVERRIDE (e.g., Grave Threat) follow the TIER_2 rule by default, and are upgraded to a barangay patrol schedule when risk score is High or above.

## Review Cadence

- Reassess classifications and active schedules every **30 days**.
- Reassess sooner if an incident repeats at the same address.

## Notes for the Implementing Agent

- Patrol decisions must ultimately follow the unit's SOPs and supervisor guidance. Treat this document as a decision-support default, not an authority.
- Confirm how "High or above" maps to the system's actual risk score scale before implementing thresholds.
- Where a record has a known address, prefer location-specific schedules over general area patrol.
- Optional extension: a scoring matrix weighting severity, recurrence, and location clustering.
