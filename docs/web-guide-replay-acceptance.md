# Web getting-started replay

Implemented on 2026-11-28. Every authenticated dashboard account can open the three-step English guide from Getting started in the navigation. The mobile label is Guide, with the full accessible name Getting started and an explicit 44px minimum touch target. The guide opens on the current dashboard page and starts at its first step each time.

## Behavior and persistence

Manual viewing uses the existing application tracking, schedule and documents content. Back and Next navigate between steps. Close, Escape, the title-bar close button and backdrop dismissal return to the current page. The final Add an application button opens the existing Add Job page. An active modal prevents a second guide from opening. Keyboard focus stays within the guide and returns to its navigation entry after dismissal.

The browser distinguishes an automatic invitation from a user-opened guide. Status refreshes and pending preference retries can update automatic eligibility while a manual guide remains open. Recorded completed/skipped outcomes and their original timestamps remain authoritative. When already loaded, a recorded terminal choice needs no further write on replay. During a late status read, the existing atomic server update preserves the first persisted choice. A first manual visit can save completed/skipped through the existing authenticated preference endpoint.

Unsaved choices keep their account-scoped local queue and existing retry controls. Closing a replay preserves that pending choice. Stopped account clients cannot open a guide, and late responses cannot move their state into another account. The existing automatic guide retains first-application wording, eligibility and skip behavior. Native onboarding remains future work.

## Acceptance

The targeted API/browser-state suite covers existing onboarding plus terminal-choice replay, status-read races, pending local writes and stopped accounts. Actual isolated NextAuth/MongoDB/Chrome acceptance checks existing applications, repeated views, completed/skipped timestamps, first manual choice, focus refresh, other dashboard routes, fresh login/storage, Add Job navigation, account switching, modal overlap, mobile entry visibility and keyboard/focus restoration. Existing automatic onboarding and empty-page browser flows are checked separately. Production build, scoped lint, reviewed captures and workbook/evidence validation are recorded in JG-032.

All browser accounts, jobs and preferences are synthetic in disposable local databases. Production deployment observations refer to the exact implementation revision. Native distribution remains a separate acceptance step.
