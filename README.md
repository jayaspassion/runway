# Runway

**An AI cash-flow agent for freelancers, built on PayPal invoicing.**

Freelancers know what they are owed. What they don't know is *when it will actually arrive*, or what to do about the invoices that are drifting. Runway answers both:

1. **Forecasts** when each open PayPal invoice will really be paid, from how late (or early) that client has paid before.
2. **Proposes** PayPal actions to bring the cash in sooner: a reminder, an early-payment discount, or sending a draft.
3. **Acts only on approval.** The agent can queue an action; it cannot execute one. A person clicks Approve, and only then does the request go to PayPal.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## What it looks like

The **Cash runway** page is the home screen:

- **Cash runway widget** – one row per open invoice: its due date, the date it is expected to be paid, and the gap between them, coloured by risk.
- **Action queue widget** – the actions the agent has proposed, each with its reasoning, the message it would send, and Approve / Dismiss buttons.
- **Expected cash-in by week** and **Average days late by client** – ordinary AG Studio charts over the same forecast.

Open the AI assistant (click **Edit**) and try:

- *"Get me paid faster"* – the cash-flow agent reads the forecast and queues up to four actions.
- *"Who is at risk?"* – answered from the forecast table.
- *"Add a column chart of expected cash-in by week, split by payment risk"* – AG Studio's own agents build the widget.

## How it works

```
PayPal Invoicing API ──► lib/dashboard-data.ts ──► AG Studio data sources (incl. Cash Forecast)
                              │                          │
                              ▼                          ▼
                     payment habits per client     built-in agents: lead, planning, data, page, widget
                     + expected pay date                     │ delegate_to
                                                             ▼
                                                   cash-flow agent (custom)
                                                             │ propose_action
                                                             ▼
                                                   Action queue widget (custom)
                                                             │ Approve (a person)
                                                             ▼
                                              POST /api/actions ──► PayPal Invoicing API
```

| Piece | Where | What it does |
| --- | --- | --- |
| Forecast | `lib/dashboard-data.ts` | For every paid invoice, days between due date and payment. A client's average becomes the expected lateness of their open invoices. Invoices already later than the client's habit are flagged "At risk". |
| Cash-flow agent | `app/dashboard/runway/agent.ts` | A custom agent registered beside AG Studio's five built-in agents. The lead agent's `delegate_to` tool is extended so it can hand cash-flow requests over. Its only tool is `propose_action`. |
| Approval queue | `app/dashboard/runway/store.ts` | Proposals live in the browser until a person approves or dismisses them. |
| Custom widgets | `app/dashboard/runway/widgets.tsx` | Cash runway and Action queue, registered through `createWidgets` and described to the AI so it can place them. |
| Actions | `app/api/actions/route.ts`, `lib/paypal.ts` | Re-checks the invoice's live status, then calls PayPal: `POST …/remind`, `PUT …/invoices/{id}` (discount), `POST …/send`. Discounts are capped at 15%. |
| Gemini adapter | `app/dashboard/studio/gemini-adapter.ts`, `app/api/ai/gemini/route.ts` | AG Studio ships an OpenAI example adapter only. This implements the same contract for Gemini (streaming, tool calls, thought signatures) behind a server proxy that holds the key and falls back through several models when one is busy. |

## Tools used

- **PayPal** – Invoicing v2 API (list, detail, send, remind, update, record payment), Catalog, Billing Plans, Transaction Search and Balances, all against the sandbox with plain `fetch`.
- **AG Studio (AG Grid)** – the dashboard, its data engine, custom widgets, theming, and the Studio Agent Framework: a custom agent that the built-in lead agent delegates to, a custom tool, and custom tool labels in the chat.
- **Google Gemini** – the model behind every agent, through a custom AG Studio adapter.
- **Render** – hosting (`render.yaml`).

## Run it locally

Requires Node.js 20.9 or later.

1. **PayPal sandbox app.** In the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox), create a sandbox REST app and enable the **Invoicing** and **Transaction search** features. Copy the client ID and secret.
2. **Gemini key.** Create one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). The free tier works but is rate-limited; one assistant request makes many model calls, so a billed key is much faster.
3. **AG Studio licence (optional).** A [trial key](https://www.ag-grid.com/studio/license-pricing/) removes the watermark.
4. **Configure and seed.**

   ```bash
   npm install
   cp env.example .env.local   # then fill in the values
   npm run seed                # creates 33 sample invoices in your sandbox
   npm run dev
   ```

5. Open <http://localhost:3000/dashboard>.

`npm run seed` creates a freelance studio's invoice history: seven clients with distinct payment habits, five months of paid invoices, and a set of open, overdue, partly paid and draft ones. It is safe to re-run; existing invoice numbers are skipped. `npm run seed -- --dry` prints the plan without calling PayPal.

## Deploy

`render.yaml` describes a single Node web service. Create a Blueprint from the repository on [Render](https://render.com) and enter the four environment variables when asked.

The hosted app has no sign-in. That is deliberate for a sandbox demo, but it means anyone with the URL can use the assistant and approve actions against the configured **sandbox** account. Never point it at live PayPal credentials. The assistant route has a per-address rate limit to protect the Gemini quota.

## Limits and honest notes

- The forecast is a per-client average, not a statistical model. It is meant to be explainable: every expected date traces back to "this client usually pays N days late".
- Reminder and send emails go to the sandbox, which does not deliver real mail.
- Invoices are assumed to be in one currency (the seed uses USD).
- Proposals are stored in the browser's localStorage, not on the server.

## Credits

Started from PayPal's [hackathon boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate), which supplied the Next.js shell, the PayPal read client and the base AG Studio dashboard. The Gemini adapter, forecast, cash-flow agent, approval flow, PayPal write actions, custom widgets and seed script were built during the hackathon.

## Licence

[MIT](LICENSE)
