# SoundBridg — Presence RLS expansion (open reads in v1)

**Status:** shipped 2026-05-01.
**Author:** Claude (Session 5, 2026-05-01).
**Supersedes:** PRESENCE_PROTOCOL.md §6 — the v0 "presence read own channel" SELECT policy.
**Fulfills:** PRESENCE_PROTOCOL.md §3's deferred RLS expansion (the `Cross-user crossover | None` topology claim).

---

## TL;DR

Presence channels are now **world-readable by any authenticated user**. Any signed-in client may subscribe to `presence:user:<X>` for any `X` and observe that user's online devices. Write remains scoped to the owner — only the holder of `auth.uid() = X` can publish to `presence:user:X`.

This is the v1 "open/public" model. Privacy debt is acknowledged, recorded, and deferred to a v2 relationship-gated model. The trigger for the change is the bridg-tap airdrop UX: Adam and Rayan must each see the other's bridg light up before either can tap to share. With the v0 RLS policy this was structurally impossible — RLS denied every cross-account subscribe by definition.

The change is one SQL operation against `realtime.messages` (one DROP, one CREATE). No backend code, no client code, no payload changes. PRESENCE_PROTOCOL.md §3 (channel topology), §6 (RLS policies), §11 (open items), and ROADMAP.md (Week 5) pick up the consequent doc edits.

---

## 1. Decision

The SELECT policy on `realtime.messages` for `extension = 'presence'` no longer constrains by topic. Any signed-in client (`to authenticated`) may read any presence channel. The INSERT policy is unchanged: writes are still owner-only, gated by `realtime.topic() = 'presence:user:' || auth.uid()::text`.

In plain English: anyone signed in can **read** any user's presence channel. Only the owner can **write** to their own.

The `extension = 'presence'` scope on the SELECT policy is preserved so Broadcast (`extension = 'broadcast'`) and database-change traffic (`extension = 'postgres_changes'`) on `realtime.messages` remain unaffected — they have their own gating per PRESENCE_PROTOCOL.md §6.

---

## 2. Rationale — why open, why now

The next product surface — bridg-tap airdrop — requires that two users **see each other** before either can act. Adam taps Rayan's bridg light only if Rayan's bridg light is visible from Adam's app, and vice versa. The v0 RLS policy made this structurally impossible: subscribing to `presence:user:<other-user>` was always denied at the database, so cross-account presence was unobservable by definition.

Without cross-account read there is nothing to tap. The airdrop UX collapses into "tap nothing, get nothing." The decision was therefore between:

- **(a)** Block bridg-tap on first building a relationship model (follows / friends), gating the read policy on that relationship, then shipping the airdrop UX on top.
- **(b)** Ship open reads now, capture privacy debt, defer the relationship model to v2.

We chose **(b)**.

**Why not (a):** the relationship model is its own product surface — find friends, send/accept requests, manage blocked users, surface in onboarding, decide symmetry semantics (mutual vs unidirectional follow), etc. — that deserves dedicated thought. Bolting it on as a sub-feature of presence would produce a half-thought primitive that ossifies and constrains the eventual real version. Building the v2 model under product pressure (real users, real friction) will produce a different shape from the abstract design we'd write today.

**Why open is acceptable today:** at user-count = 2 (Rayan + Adam), the worst-case privacy exposure is "the other user can probe my presence" — which is precisely what we want them to do. The privacy threat model only goes live at meaningful scale.

---

## 3. Privacy debt (acknowledged)

**At today's scale (2 users):** acceptable. The set of users who can probe `presence:user:<X>` is the same set of users who already have one another's UUIDs out-of-band (Adam and Rayan exchanged user IDs during manual pairing). Open reads do not expand the realistic adversary set.

**At any meaningful scale (public signup, 10+ users):** unacceptable. Anyone signed in can probe arbitrary user IDs to learn:

- Whether a given user has any device online at this moment.
- The shape of their device fleet — `client`, `app_version`, `os` from the §4 payload.
- Their `joined_at` timestamp, which leaks session-start time.

A motivated probe with a list of UUIDs becomes an "is X online right now" oracle, which is the kind of signal a stalker, a competitor, or a curious ex would want. This is fine for a 2-user sandbox; it is not fine for a public product.

The debt is recorded here, not deferred silently.

---

## 4. Mitigation path (v2)

When the user count crosses the threshold where probe-by-UUID becomes a real exposure (no fixed date — gated on actual user growth, not calendar), introduce a relationship model and re-tighten the SELECT policy.

**Sketch (final shape lands in the v2 surgery):**

1. **Schema:** create a `follows` (or `friends`) table — `(follower uuid references users(id), followee uuid references users(id), created_at timestamptz, primary key (follower, followee))`. Symmetry semantics (mutual-only vs unidirectional) is a v2 product decision.
2. **Backfill:** seed mutual edges between the existing fleet so the airdrop UX continues working uninterrupted across the cutover.
3. **RLS:** drop the open SELECT policy and replace with a relationship-gated one along the lines of:
   ```sql
   CREATE POLICY "presence read followed channel" ON realtime.messages
     FOR SELECT TO authenticated
     USING (
       extension = 'presence'
       AND EXISTS (
         SELECT 1 FROM follows
         WHERE follower = auth.uid()
           AND 'presence:user:' || followee::text = realtime.topic()
       )
     );
   ```
4. **UX:** find-friends + send/accept request flows ship in the same release as the policy tightening, so existing users do not lose visibility to peers they had under the open model.

**No fixed date.** Gated on user growth — when public signup opens, or when telemetry shows the user count crossing the point where probe-by-UUID stops being noise. Captured as TODO in PRESENCE_PROTOCOL.md §11.

---

## 5. SQL applied

Run via the Supabase SQL Editor on the production project:

```sql
DROP POLICY "presence read own channel" ON realtime.messages;
CREATE POLICY "presence read any channel" ON realtime.messages
  FOR SELECT TO authenticated
  USING (extension = 'presence');
```

The `presence write own channel` INSERT policy is left untouched.

**Verification (post-apply):**

- A signed-in client subscribing to `presence:user:<other-user>` succeeds (no RLS denial in the Realtime log surface).
- A signed-in client attempting to `track()` on `presence:user:<other-user>` is denied (INSERT RLS still scoped to `auth.uid()`).
- Broadcast and `postgres_changes` traffic on `realtime.messages` continues to behave per its own (unchanged) gating.

---

## 6. What does NOT change

- **Channel topology (§3) — name shape, identity, cardinality.** Channels remain `presence:user:{user_id}`. Each user still has one channel. Devices still appear as peers within their owner's channel. Only the cross-user crossover claim is amended.
- **Payload v1 (§4).** No fields added, removed, or renamed. `presence_v` stays at `1`.
- **Auth (§5).** ES256-via-JWKS is unchanged; `role: "authenticated"` still gates the `to authenticated` clause on both policies.
- **Write policy.** A user still writes only to their own channel.
- **Backend role (§7).** Not in the data path. No backend code change.
- **Lifecycle / edge cases (§8).** All thirteen cases unchanged.
- **Client code.** `lib/presence.ts` in the mobile repo is **untouched**. The self-loop short-circuit (commit `d489e9a`) stays in place — a user looking at their own bridg bubble shouldn't see themselves as a peer in v1, since their own device is excluded from the peer list (§8 case #12) and the channel they own has no other peers in v1's "Meaning A" presence model. The short-circuit is semantically correct independent of the RLS shape.

The migration is one SQL operation. Nothing else.

---

## 7. References

- PRESENCE_PROTOCOL.md §3 — channel topology (cross-user crossover row amended in this migration).
- PRESENCE_PROTOCOL.md §6 — RLS policies (the v0 "presence read own channel" block is replaced; "presence write own channel" untouched).
- PRESENCE_PROTOCOL.md §11 — open items (v2 relationship-gated read policy added).
- ROADMAP.md §3 Week 5 — open-RLS migration deliverable.
- `docs/migrations/2026-04-jwt-hs256-to-es256.md` — precedent for migration record format.

---

*End of migration record.*
