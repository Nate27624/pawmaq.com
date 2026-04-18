# Ledger JSON Design

This folder defines two ledgers as JSON:

1. `user-profile-ledger.schema.json`
2. `post-popularity-ledger.schema.json`

## Why not 16 separate popularity ledgers?

You need 8 timeframes x 2 metrics (`likes`, `approval`) = 16 ranking views.
Instead of 16 separate ledger files, keep one `post-popularity` ledger and store
16 ranked indexes inside `ranking_indexes.by_timeframe`.

This keeps writes and reads simpler:

- one source of truth for post content + engagement
- all ranking windows updated together
- no cross-ledger synchronization bugs

## Approval Formula

`approval = (likes + 0.5 * neutral) / (likes + neutral + dislikes)`

Stored as `approval_score` in each post and used for `approval` ranking indexes.

## Searchability

User search is handled in `user-profile` ledger via:

- `username_index` (normalized username -> `user_id`)
- optional `usertag_index` (`@handle` -> `user_id`)
- `post_interaction_history` inside each profile (`seen`, `liked`, `disliked`, `neutral`, `saved`, `reposted`, `commented`)
- `daily_ledger_quota_by_user` tracks bytes written by profile-ledger updates against the same `200MB` daily cap.
