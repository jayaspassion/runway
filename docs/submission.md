# Devpost submission kit

Text to paste into the Devpost form, and a script for the demo video.

## Project name

Runway

## Tagline

An AI cash-flow agent for freelancers: it forecasts when PayPal invoices will really be paid, and gets you paid sooner, with your approval.

## Description

### The problem

A freelancer's PayPal dashboard says what they are owed. It does not say when the money will arrive. Clients pay on their own schedule: one is always a week early, another is always a month late. So rent week arrives and a third of the receivables are "outstanding" with no way to tell which will land.

### What Runway does

Runway reads a freelancer's PayPal invoices and does three things.

- **Forecasts.** For every client it measures how late or early they have paid before, and applies that habit to their open invoices. The Cash runway widget shows each invoice's due date next to the date it is actually expected, coloured by risk.
- **Proposes.** Ask the assistant "get me paid faster" and a dedicated cash-flow agent picks the actions with the most cash impact: a friendly reminder for an invoice that just went overdue, an early-payment discount for a large invoice from a chronically late client, sending a draft that is sitting unsent. Each proposal comes with its reasoning, its expected impact and the exact message it would send.
- **Acts, on approval.** The agent cannot touch PayPal. Its proposals land in an Action queue widget; a person approves or dismisses each one, and only an approval calls the PayPal Invoicing API.

The same assistant also builds dashboards on request ("add a chart of expected cash-in by week, split by risk"), because the forecast is exposed to AG Studio as an ordinary data table.

### How we built it

- **PayPal:** Invoicing v2 API for reading invoices and payments and for the three write actions (remind, update with a discount, send), plus Catalog, Billing Plans, Transaction Search and Balances. Everything runs against the sandbox. A seed script creates a realistic five-month invoice history so the forecast has something to learn from.
- **AG Studio:** the dashboard, two custom widgets (Cash runway and Action queue), custom theming, and the Studio Agent Framework. Runway adds a sixth agent to Studio's built-in five and extends the lead agent's delegation so it hands cash-flow requests to it, while chart-building still goes to Studio's own page and widget agents.
- **Gemini:** AG Studio ships an OpenAI example adapter only, so we wrote a Gemini adapter for its agent framework: streaming, parallel tool calls, thought signatures, schema clean-up, and a server proxy that falls back across models when one is rate-limited.
- **Render:** hosting.

### Challenges

- Making the agent safe. The design rule is that the model can only *queue* an action. The server re-checks the invoice's live status before executing, and discounts are capped at 15%.
- Getting AG Studio's multi-agent framework to run on a model it has no adapter for, including Gemini's requirement to return thought signatures with tool results.
- Free-tier rate limits: one user request fans out into many model calls across agents, so the proxy needed model fallback.

### What's next

- Learn from outcomes: did the reminder work? Feed that back into which action is proposed.
- PayPal webhooks, so the forecast updates the moment an invoice is paid.
- Scheduled runs: a Monday-morning digest of proposed actions.

## Tools used (for the "Tools" field)

- PayPal Invoicing v2, Catalog Products, Billing Plans, Transaction Search and Balances APIs (sandbox)
- AG Studio by AG Grid: dashboard, custom widgets, theming, Studio Agent Framework (custom agent, custom tool, delegation from the built-in lead agent)
- Google Gemini (gemini-3-flash-preview with fallbacks) through a custom AG Studio adapter
- Render for hosting
- Claude Code as the coding assistant

## Demo video script (under 3 minutes)

Record at 1440×900 or larger, with the Action queue empty to start ("Clear finished", and dismiss anything pending).

| Time | Show | Say |
| --- | --- | --- |
| 0:00–0:20 | Cash runway page, still | "I'm a freelancer. PayPal tells me I'm owed thirty-eight thousand dollars. It doesn't tell me when I'll get it. This is Runway." |
| 0:20–0:50 | Hover rows in the Cash runway widget | "Runway looks at how each client has paid before. Harbor and Finch pays early, so that's green. Atlas Outdoor pays a month late, every time, and this eleven-thousand-dollar invoice is already beyond even that. Twelve thousand dollars is at risk." |
| 0:50–1:30 | Click Edit, click "Get me paid faster", let it run | "So I ask the assistant to get me paid faster. AG Studio's lead agent hands this to Runway's cash-flow agent, which reads the forecast and decides what's worth doing." (If the model is slow, cut the wait in editing.) |
| 1:30–2:10 | Back to View. Read one reminder and the discount card | "It hasn't done anything yet. It proposed four actions, each with a reason and the exact message. A nudge for an invoice that went overdue yesterday. A five percent early-payment discount for the big Atlas invoice, because a reminder alone hasn't worked on them before." |
| 2:10–2:35 | Click Approve on a reminder, show "Reminder sent" | "I approve this one, and now it goes to PayPal. That's the rule: the agent proposes, I decide." |
| 2:35–2:55 | Edit, ask "Add a column chart of expected cash-in by week, split by payment risk" (or show the existing chart) | "Because the forecast is just another table, the same assistant can build me any view of it." |
| 2:55–3:00 | Cash runway page | "Runway. Know when you'll get paid, and do something about it." |
