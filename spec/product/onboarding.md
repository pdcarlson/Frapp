# Onboarding Flow

## Chapter Creation

1. Prospect visits frapp.live, clicks "Get Started."
2. Redirected to app.frapp.live sign-up (Supabase Auth).
3. After authentication, enters chapter details (name, university).
4. **Accepts Terms of Service and Privacy Policy** (required checkbox).
5. API creates chapter with `subscription_status: incomplete`.
6. API creates a Stripe Customer, stores `stripe_customer_id` on the chapter.
7. API generates a Stripe Checkout URL (with `chapter_id` in metadata).
8. User completes payment on Stripe.
9. Stripe webhook (`checkout.session.completed`) fires; API activates chapter (`subscription_status: active`).
10. Default system roles and default channels (#general, #announcements, #alumni) are seeded.

## Chapter Lifecycle

| Status       | Meaning                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| `incomplete` | Created but not yet paid.                                                       |
| `active`     | Subscription current. Full access.                                              |
| `past_due`   | Payment failed. 3-day grace period (soft lock — can still read, cannot invite). |
| `canceled`   | Subscription ended. Data preserved, read-only (hard lock).                      |

## Invite System

1. Admin generates an invite token (valid for 24 hours, assigned a role).
2. Token is shared as a link (e.g. `app.frapp.live/join?token=abc123`).
3. New user signs up (Supabase Auth) and enters the token.
4. API validates the token (not expired, not used), links user to chapter with the token's role.
5. Token is marked as used.
