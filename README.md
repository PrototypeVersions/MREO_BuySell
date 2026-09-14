# MREO Buy / Sell

As-is property and portfolio marketplace built from the existing BuySellProperty site.

## Try the site

Open [MREO BuySell](https://prototypeversions.github.io/MREO_BuySell/).

- Submit buyer interest or seller information, then complete the clearly marked $1 **test** participation step.
- Open **Auctions** to see the countdown and bid count. Buyers see only their own bids, with no leading or outbid signals. Positive whole-dollar bids are accepted independently of other offers, including lower and equal amounts. The highest qualifying bid wins at close; equal bids use the earliest received bid. Other buyers’ amounts stay private after closing. The examples include Dallas, Fort Worth, Plano, and the REO portfolio; the Turkey property is not an auction example. Open **Test the auction** to select Test Buyer A, B, C, or Test Seller, advance to the result, or restart the example.
- A green light means a qualifying winning bid; a red light means the bid did not win or the reserve was not met. A winning bid still requires seller acceptance and closing.
- Seller view shows all associated bids, the highest price at close in green, and proceeds after MREO’s fee. The $1,000 fee is due only if the sale closes, once per property or whole-portfolio transaction. Other closing costs and obligations are separate.
- Choose **Sell portfolio as is**, upload Excel or CSV, review the import, and set your minimum. The portfolio appears in Available Portfolios after the test participation step.
- Click **Search Available Portfolios**, then select **MREO Buy Portfolio As Is** to open the spreadsheet view and Excel download.

The default is a complete browser demonstration: test credits, simulated buyers, and saved test auctions are stored only in that browser. The three test bidders never run in the connected service. Test auctions start with one day; 21 days is the standard option. Results appear on the auction screen and persist when it is revisited. No email or text notifications are sent.

## Portfolio data and media

The 150-property REO workbook contains fictional properties spanning good condition through major rehabilitation. Aggregate reference value is **$68,635,000**; the example asking price is **$4,804,450**, or 7% of reference value. This is an illustration, not a real bank portfolio or valuation. The workbook includes Properties and Summary sheets, formulas, filters, and a frozen header. Both Excel and CSV downloads are included, plus a blank CSV template.

The generic portfolio artwork is generated for this site. The $7.5 million Turkey property is third in Available Properties, with “Address awaiting confirmation” and NA for unknown specifications. Its View / Prepare Interest link opens a dedicated image and video page, followed by a Prepare Interest link that fills in the buyer form. The gallery uses all seven 1280×720 video-frame PNGs supplied by the user in `assets/`, with `videoframe_14441.png` as the listing cover. Every gallery image uses the same size in a two-column desktop layout, stacking into one column on phones. Full-resolution WebP copies in `assets/turkey/photos/` keep page loading fast; selecting any gallery image opens the original PNG. The images show the exterior, courtyard, pool, waterfront, living area, and bedroom from the supplied [property video](https://www.youtube.com/watch?v=MUdBlpLWFEY). They replace the temporary public video previews. No generative changes, crops, or invented property details were added to the uploaded photos. The file mapping and dimensions are recorded in `assets/turkey/source.json`. The original sample listings and property-record lookup remain available. Existing photo/video inputs preview media locally; permanent media storage is not yet connected.

## Connect payments and shared auctions

The frontend is ready to call the included Cloudflare Worker and Durable Object in `backend/`. Real payment credentials must be collected on Stripe’s hosted checkout page, never in browser storage or this repository. The default site does not charge money or save a card.

1. Deploy `backend/worker.js` with the Durable Object binding in `backend/wrangler.toml`. Set `SITE_URL` to the actual HTTPS site URL, including its repository path.
2. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` as Worker secrets. Start with Stripe test credentials. For example, from `backend/`, use `npx wrangler secret put STRIPE_SECRET_KEY` and `npx wrangler secret put STRIPE_WEBHOOK_SECRET`, then `npx wrangler deploy`.
3. Configure the Stripe webhook URL as `https://YOUR-WORKER.workers.dev/webhook` for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded`, and `charge.dispute.created`.
4. In `mreo-config.js`, set `mode: "connected"` and `apiBase` to the deployed Worker’s HTTPS origin.
5. Verify a Stripe test checkout for both roles, cancel a checkout, verify refund handling, and test two separate browser sessions bidding on the same auction before enabling live transactions.
6. To accept actual $1 payments, use the live Stripe credentials and webhook secret, and explicitly set `ALLOW_LIVE_PAYMENTS = "true"` in the Worker configuration. Connected live auctions require the 21-day standard duration.

A verified $1 payment creates an internal participation credit and saves the Stripe customer/payment-method relationship for future payments the participant approves. This is not a withdrawable or transferable wallet. The backend checks the amount, currency, payment status, session-to-account binding, and Stripe live/test mode. Webhook signatures are checked and credits are idempotent. Refunded or disputed participation payments revoke future auction access. Historic bids are retained for review. The $1,000 closing fee is displayed but is not automatically charged by this implementation; collection belongs in a verified closing workflow.

The connected service uses server time and serialized auction updates, accepts blind bids without a price increment, rejects late bids, restricts the full bid list to the listing seller, stores results, and closes auctions with a Durable Object alarm even when no page is open. Participant credentials are bearer sessions saved in the current browser tab; account recovery and cross-device login are not implemented. Keep the registration tab for later account access. Connected auctions and spreadsheets persist on the server. This integration has automated mocked payment verification tests; deployment and live Stripe checkout require the account setup above.

## Validation

- `npm test`: auction rules, fees, deadline handling, reserve outcomes, CSV validation, sample portfolio arithmetic, webhook signatures, payment binding/idempotency, authorization and concurrent bids.
- `npm install`, `npx playwright install chromium`, `npm run test:browser`: actual browser flows at desktop and mobile sizes, including the supplied Excel workbook upload.
- GitHub Actions runs these checks on pushes and pull requests.

Spreadsheet import uses the official [SheetJS standalone distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/), pinned to 0.20.3 and loaded only when needed. CSV import works without that dependency. Payment creation follows [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create); signature verification follows [Stripe’s webhook guidance](https://docs.stripe.com/webhooks/signature). Server scheduling follows [Cloudflare Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).
