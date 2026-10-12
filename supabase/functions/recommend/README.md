# Restaurant recommendation controls

Dish recommendations are on by default and can be switched off from the
owner dashboard. Optional AI recommendations are off by default and work only
when the master dish-recommendation switch is on. First run `supabase/schema.sql`
in the Supabase SQL Editor. Then deploy the Edge Function and add the OpenAI key
as a Supabase secret (never put it in `config.js` or browser code):

```sh
supabase secrets set OPENAI_API_KEY=your-key
supabase functions deploy recommend --no-verify-jwt
```

`--no-verify-jwt` is required because `config.js` uses a publishable key
(`sb_publishable_...`). That key is not a JWT, so the default JWT check would
reject every request from the menu with a 401 error.

`OPENAI_RECOMMENDATION_MODEL` is optional; it defaults to `gpt-4o-mini`.
When the function is unavailable or times out, the customer menu keeps the
instant tag-and-history recommendations. The function only selects from
server-verified eligible menu items, caches by tags and order history for
24 hours, and rate-limits each observed client IP to 12 requests per minute
per function instance. Turn it on from the owner dashboard's Restaurant
settings only after the function and secret are configured. The Chef's pick
flag on each dish gives it a gentle customer-side ranking boost.

Suggestions need evidence before they are shown: at least two paired orders,
matching flavour tags, a Chef's pick flag, or a fitting time context (such as
a breakfast item in the morning). Each suggestion displays its strongest
short reason (such as “Popular choice” or “Pairs well”); category-only guesses
are hidden.

## Customer reorder history

After a successful order, the customer menu can remember the ordered dish IDs
and quantities in that browser (up to 50 orders). It does not save names,
contact details, order notes, or table numbers. Reorder suggestions require
the same basket to have appeared at least twice, and every item is rechecked
for current availability and saved safety needs before it can be added. The
customer can clear this history from the “Order again” section. A “Fancy
trying…” item is shown at most once every 24 hours and follows the same safety
and confidence rules as other recommendations.

## Allergy and dietary safety

The same schema migration adds `allergens`, `may_contain_allergens`, and
`allergen_info_verified` to each dish. Verify ingredient and cross-contact
information with the kitchen or supplier before checking the verification box
in the dashboard. Customers' selections are stored in their browser. When an
allergy is selected, both browser rules and the Edge Function reject dishes
whose allergen information is unverified, or that contain or may contain a
selected allergen. Selected dietary tags must also be explicitly present.
These recommendation filters are not a substitute for confirming ingredients
with restaurant staff.

## Tag-built combo deals

The same schema migration adds `bundles_enabled`, `bundle_discount_percent`,
and `orders.bundle_discount`. Combos are generated from available, safety-
eligible `main`, `drink`, and `dessert` category tags, then ranked using
flavour overlap, Chef's Picks, and order-pair counts. No dish IDs or fixed
pairings are configured. Restaurant owners can enable combos and set a
discount in the dashboard. The customer menu shows a combo as one of at most
three recommendation slots.

Combo discounts are recalculated from current database prices and restaurant
settings by `place_order`; the browser-provided bundle only identifies its
three items and the active safety filters. Apply `supabase/schema.sql` in the
Supabase SQL Editor before using combo orders in production. Until the
migration is applied, the existing live database will not support these
settings or the bundle-aware order RPC.
