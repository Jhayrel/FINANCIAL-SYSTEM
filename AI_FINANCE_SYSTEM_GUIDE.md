# AI Layer Guide for a Financial Management System

This is a single build-and-behavior guide for the AI features in your financial management app. It explains how the AI actually works, how it shows results, how it analyzes data, and exactly what to hand to Claude Code so the AI comes out good and trustworthy.

Your models are free ones from Groq and OpenRouter. That is fine. This guide is written around those limits.

Read the section called "What to paste to Claude Code" at the end. Everything above it is the reasoning and the templates that make that section work.

Note on formatting: this document avoids bold and long dashes on purpose, per your request.

---

## Part 0: The one rule that makes finance AI trustworthy

The language model interprets and explains. Your code computes.

Never ask the model to add numbers, calculate a total, a balance, a percentage, an average, or a running sum. Models get arithmetic subtly wrong, and in a finance app a wrong number is the single worst failure you can ship. It looks confident and it is incorrect.

So the split is always:

- Your backend code computes every number using real math (SQL, JavaScript, or Python). These numbers are exact and repeatable.
- The model receives the already computed numbers and turns them into words: a category, a short explanation, a narrative summary, a suggestion, an answer phrased in plain language.

If you remember nothing else from this guide, remember this. Most of the design below exists to enforce it.

---

## Part 1: How the AI layer works, end to end

Here is the data flow for every AI feature. It never changes.

1. Data lives in your database (transactions, budgets, accounts).
2. Your backend runs a normal query and computes the exact aggregates the feature needs (for example: total spent per category last month, list of merchants, count of transactions).
3. Your backend builds a small, compact context. This is a short block of text or JSON containing only the rows and numbers the model needs for this one task. Not the whole database.
4. Your backend sends that context to the model together with a strict system prompt and a required output shape (JSON schema).
5. The model returns JSON.
6. Your backend validates the JSON. If it is broken, it retries once, then falls back.
7. Your backend renders the result in the UI. Numbers on screen come from step 2, not from the model. Words and labels come from the model.

The model never touches your database directly. It only ever sees the small slice you choose to hand it. This is safer, cheaper, faster, and easier to debug.

A simple mental model: treat the language model as a text-to-text transformation layer with known failure modes, not as a brain that knows your finances. It knows only what is in the prompt you send right now. It has no memory between calls, so every call must contain everything it needs.

---

## Part 2: The providers you are using

Both Groq and OpenRouter speak the OpenAI API format. That means one code path works for both: you only change the base URL, the API key, and the model name. This is what lets you fall back from one to the other.

### Groq

- Base URL: `https://api.groq.com/openai/v1`
- Format: OpenAI compatible (use the OpenAI SDK, just change base URL and key)
- Free tier limits (verify current numbers on Groq's site, they change): about 30 requests per minute, about 6,000 tokens per minute, about 14,400 requests per day. These limits apply to your whole account (organization level), so making extra API keys does not raise them.
- Speed: very fast, often several hundred tokens per second. This is Groq's main advantage.
- The real bottleneck is tokens per minute, not requests per minute. A single long prompt can eat half your per-minute token budget. Keep prompts short.
- Adding a credit card (no minimum spend) unlocks the Developer tier with roughly ten times the limits. Useful later if you outgrow free.

Good Groq model choices:

- `llama-3.1-8b-instant`: small and very fast. Use this for high-volume simple tasks like categorizing one transaction. Cheapest on your token budget.
- `llama-3.3-70b-versatile`: larger and smarter. Use this for the harder tasks like monthly narrative summaries or answering a nuanced question. Costs more tokens.
- Groq also hosts other open models (for example a large GPT-OSS model, Qwen, Kimi). Treat the two Llama models above as your defaults and only branch out if you test and prefer another.

### OpenRouter

- Base URL: `https://openrouter.ai/api/v1`
- Format: OpenAI compatible
- Free models have an ID that ends in `:free`, for example `meta-llama/llama-3.3-70b-instruct:free`. If you leave off `:free`, you get charged.
- Free tier limits (verify current numbers): about 20 requests per minute always, and about 50 requests per day, which rises to about 1,000 per day after a one-time purchase of about 10 dollars in credits that never expires.
- The list of which models are free rotates constantly. Models appear and disappear without notice. Do not hardcode one free model ID and forget it. Read the live list, and always keep a fallback ready.

Important privacy note for OpenRouter free models: some free providers may store your inputs or even use them to train their models. This is stated in their data policies. For a finance app this matters, because you are sending money data. Before you send real user financial data through a free OpenRouter model, read that model's data policy, prefer providers that offer zero data retention, or route anything sensitive through the provider you trust most. When in doubt, keep real financial data on the provider with the clearest no-training policy and use the others only for non-sensitive or masked text.

### Why two providers

Free tiers hit rate limits and free models sometimes go down or get pulled. Having Groq as your main and OpenRouter as your backup (or the reverse) means your AI features keep working when one is busy. The section on fallback shows how.

---

## Part 3: The AI features and exactly how each one works

Here are the core features for a financial management system. For each one you get: what your code computes and passes in, what the model does, the output shape, and how it shows up in the UI.

### Feature 1: Automatic transaction categorization

This is the most valuable and most common AI feature in a finance app. It turns a raw bank line like `SQ *BLUE BOTTLE 0454` into a clean category like `Coffee and Cafes`.

The strong pattern (this is what good finance apps actually do):

1. Keep a fixed list of allowed categories in your code. The model must pick from this list, never invent a new one.
2. Before categorizing a new transaction, your code searches the user's own past transactions for similar merchants or descriptions that already have a category. You pass those in as examples. This teaches the model the user's personal labeling style without any training or fine-tuning.
3. Deduplicate. If the user has 40 transactions from the same merchant string, categorize that unique merchant once and apply the answer to all 40. This saves huge amounts of your token budget.
4. Only touch transactions that are not already categorized. Never overwrite a category the user set by hand.
5. Give the model a fallback category (for example `Uncategorized`) to use when it is unsure, instead of forcing a wrong guess.

Input your code builds and passes:

- The one merchant string or description to categorize.
- The fixed list of allowed categories.
- A few of the user's past examples: merchant string plus the category they used.

Output shape the model must return:

```json
{
  "reasoning": "short note on why this category fits",
  "category": "one value copied exactly from the allowed list",
  "confidence": "high | medium | low"
}
```

Why "reasoning" is first: models generate text left to right, so a field placed first is decided first. Making the model write a short reason before it commits to the category improves the category. You can hide this field in the UI, it is just there to make the answer better.

How it shows in the UI:

- Apply the category automatically when confidence is high.
- When confidence is medium or low, still apply it but flag it for review, or leave it as `Uncategorized` and let the user pick.
- Always let the user correct a category with one tap. When they do, save that correction. Next time, feed it back as one of the past examples. This is a feedback loop that makes categorization better over time for free.

### Feature 2: Spending summary and insights

This is the "here is what happened with your money this month" narrative.

The key move: your code does all the counting. The model only writes the story around the numbers.

Input your code builds and passes:

- Total spent this period, and total last period, already computed.
- Spend per category, already computed and sorted.
- The top few merchants by spend.
- Any budget limits and how close the user is to them.
- Do not send raw transactions here. Send the summary numbers.

Output shape:

```json
{
  "headline": "one short sentence summary of the period",
  "highlights": [
    "short plain-language point about a notable change",
    "another short point"
  ],
  "watch_outs": [
    "a gentle flag about a category that is trending up or near budget"
  ]
}
```

How it shows in the UI:

- Show your own charts and totals from the computed numbers.
- Place the model's headline and highlights next to the charts as the readable narrative.
- Because the model never produced the numbers, the numbers are always correct. The model just made them readable.

### Feature 3: Natural language questions (the finance chat)

This is where the user types "how much did I spend on eating out last month" and gets an answer.

Do not let the model query your database freely. That path invites wrong queries, made up column names, and security problems. Use the safe two-step pattern instead.

Step one, understand the question. Send the user's question to the model and ask it to return a structured description of what they want, not an answer.

Output shape for step one:

```json
{
  "intent": "sum | list | compare | count | trend",
  "category": "eating out",
  "time_range": "last_month",
  "needs_clarification": false,
  "clarifying_question": ""
}
```

Step two, your code runs the actual query. Your backend takes that structured intent, runs a normal safe database query, and computes the exact number. Then, if you want a conversational reply, you send the computed result back to the model and ask it to phrase a one or two sentence answer around that exact number.

Output shape for step two:

```json
{
  "answer": "You spent [amount] on eating out last month, which is [up or down] from the month before."
}
```

Your code fills the real amount into the answer, or instructs the model to use only the number you provided and not to invent any figure.

How it shows in the UI:

- Stream the text answer so it feels instant.
- Show the underlying number and, ideally, a small breakdown or a link to the filtered transaction list, so the user can verify it themselves. Verifiability builds trust.

If you ever do decide to let the model write database queries directly (text to SQL), protect it hard: use a read-only database connection, allow only a whitelist of tables and columns, always add a row limit, never run the query if it references anything outside the whitelist, and never put user data at risk. The two-step intent pattern above avoids all of this and is the recommended default.

### Feature 4: Unusual spending and anomaly flags

Spot a charge that is out of pattern, like a subscription that doubled or a merchant the user never uses.

Again, your code finds candidates with plain rules first (for example, a transaction more than three times the user's average for that category, or a new recurring charge). Then the model writes the human explanation of why it might matter.

Input passed: the flagged transaction plus the relevant baseline number your code computed (for example the usual amount for that merchant).

Output shape:

```json
{
  "is_notable": true,
  "reason": "short plain explanation of why this stands out",
  "suggested_action": "optional gentle suggestion, or empty"
}
```

Detection is done by your rules. The model only decides how to phrase it and whether it is worth surfacing.

### Feature 5: Recurring and subscription detection

Find repeating charges (streaming, gym, software) so the user can see all subscriptions in one place.

Your code does the detection by grouping similar merchant strings that repeat on a regular cadence with similar amounts. The model helps only by giving a clean display name and a category for each detected group, using the same categorization approach as Feature 1.

### Feature 6: Budget coaching and suggestions

Turn the numbers into gentle, practical advice.

Input passed: category spend versus budget, trend direction, all precomputed.

Output shape:

```json
{
  "suggestions": [
    {
      "category": "name",
      "message": "short, specific, non-judgmental suggestion"
    }
  ]
}
```

Keep the tone supportive, never shaming. Tell the model this explicitly in the system prompt, because money advice that feels like scolding makes people abandon the app.

---

## Part 4: Getting reliable JSON out of a free model

Free open models are less consistent than paid frontier models at returning perfect JSON, so you must engineer for it. There are three levels of reliability. Use as many as your models support.

1. Ask for JSON in the prompt. Tell the model to return only JSON matching your shape, with no extra words and no markdown fences. This alone works most of the time but fails on edge cases.
2. Use the API's JSON mode. Both Groq and OpenRouter accept a `response_format` set to `json_object` on many models. This makes valid JSON much more likely. Use it whenever the model supports it.
3. Validate what comes back, every time. Parse the JSON inside a try and catch. Check that required fields exist and have the right type. Never trust the JSON just because JSON mode was on. A model can still return valid JSON that is missing a field or renamed one.

Rules that raise your success rate a lot:

- Set temperature low for anything structured: 0.0 to 0.2. Low temperature means more consistent, more repeatable output. Save higher temperature only for the narrative writing features where a little variety is nice.
- Keep each schema small. If a task needs more than about eight to ten fields, split it into two calls. Large schemas degrade quality on smaller models.
- Put reasoning fields before answer fields, as explained earlier.
- Make a field optional if the data might genuinely be absent. Forcing a required field when there is no data pushes the model to make something up.
- On a parse failure, retry once and include the broken output plus the error in the retry prompt, asking the model to fix it. Models are good at correcting their own mistake when you show it to them. If the retry also fails, fall back to another model or degrade gracefully.

Retry logic, which errors to retry:

- Retry these: malformed JSON, a missing field, a rate limit error (status 429), a server error (status 500 or similar). These are temporary or self-correctable.
- Do not retry these: the model returned valid data but it fails your business rules (for example it picked a category not in your list). Retrying will not help. Instead fall back to your default category, or ask the user.

There are libraries that wrap all of this for you (for example Instructor for Python, or Zod plus a small wrapper for JavaScript). If you are starting out, using one of these gives you validation and automatic retries out of the box. If you prefer no dependency, the manual try, validate, retry loop above is enough.

---

## Part 5: How results are shown to the user

This is where trust is won or lost.

- Every number on screen comes from your computed values, never from the model's text. Bind the UI number to the value your code calculated.
- The model's text is for narrative, labels, explanations, and suggestions only. It sits next to the numbers, it does not replace them.
- For the finance chat, stream the answer token by token so it appears immediately. Streaming makes even a slow reply feel fast.
- Show the source. Next to an AI answer, show the number and a way to see the transactions behind it. When users can check the AI, they trust it.
- For categorization, show confidence and make correction one tap. Store corrections and feed them back. This is your quality flywheel.
- Never block the whole page waiting on the AI. The app must be fully usable if the AI call is slow or fails. Show a small loading state for the AI panel only, and if it fails show a quiet "could not load insights, tap to retry" instead of an error that breaks the page.
- When you are rate limited, say something soft like "insights are refreshing, check back in a minute" rather than a raw error.

---

## Part 6: Working within free rate limits

Groq's token per minute cap and OpenRouter's low daily request cap are your real constraints. Design around them.

- Send less. Only include the rows and numbers a task needs. Aggregate and summarize in code before sending. A short prompt is a cheap prompt.
- Deduplicate before you call. Unique merchants, not every transaction. This is the single biggest saving for categorization.
- Batch overnight. For bulk categorization of many transactions, run it as a scheduled nightly job at a steady pace under the rate limit, rather than firing one call per transaction in real time.
- Cache results. Store the generated monthly summary and reuse it. Only regenerate when the underlying data actually changes. Do not regenerate the summary every time the user opens the screen.
- Do not call on every keystroke or every page load. Debounce user-triggered calls. Trigger insight generation on a real event (new transactions imported, month rolled over), then serve the cached result.
- Reuse a stable system prompt. Keeping the system prompt identical across calls lets prompt caching kick in, which on Groq means those cached tokens do not count against your token per minute limit. Changing the system prompt every call throws that away.
- Pick the smallest model that passes. Use the fast small model (Llama 8B) for simple, high-volume tasks like single-transaction categorization, and reserve the larger model (Llama 70B) for the few tasks that truly need more reasoning. This stretches your budget furthest.

---

## Part 7: The fallback chain (so free tiers do not break your app)

Because any single free source can rate limit or go down, wrap your model calls in a fallback chain. Try the first, and on failure move to the next.

A sensible order for this app:

1. Groq Llama 8B for the simple, cheap, high-volume task.
2. Groq Llama 70B for harder tasks, or as the next step up if 8B output is weak.
3. An OpenRouter free model as the backup when Groq is rate limited.
4. Optional last resort: a very cheap paid model if you later add a few dollars of credit, placed last so it only runs when everything free has failed.

Rules that matter:

- Because everything is OpenAI-format, a fallback is just the same request with a different base URL, key, and model name.
- Validate the output yourself before accepting it. A provider can return a 200 success with useless content, and an automatic router will not catch that. Your validation is what catches it and triggers the next fallback.
- Use exponential backoff with a little random jitter between retries on rate limit and server errors. This means wait a bit longer each attempt, with a small random offset so retries do not all fire at once.
- Handle timeouts as their own case, separate from other errors, so a slow provider does not hang your whole request.
- Do not over-engineer on day one. If your volume is low, one provider with a single backup is plenty. Add more only when you actually hit limits.
- One caution: some providers, including Groq, keep generating and billing even if you cancel a stream early. If you cancel streamed responses, be aware the generation may continue on their side.

---

## Part 8: Privacy and security (this is a finance app, so it matters more)

- Keep API keys on the server only. Never put a Groq or OpenRouter key in frontend or mobile client code. A key in the client can be stolen and your quota drained. All model calls go through your backend.
- Send the minimum personal data. The model needs a merchant string and an amount to categorize. It rarely needs the user's name, full account number, or address. Strip or mask what the task does not need.
- Check provider data policies before sending real financial data, especially on OpenRouter free models where some providers may retain or train on inputs. Prefer zero data retention options for anything sensitive.
- Do not log full prompts that contain sensitive financial data. If you log for debugging, redact amounts and identifiers.
- Consider masking. For example, send `card ending 1234` rather than a full number, or a merchant name rather than a full memo line that might contain personal detail.

---

## Part 9: Testing so the AI is actually good, not just present

You cannot tell if the AI is good by trying it once. Build a tiny evaluation set and measure.

- Make a small spreadsheet of real-looking transactions with the correct category you expect for each. Run your categorizer over them and measure the percentage it gets right. This is your accuracy score. Improve prompts until it is high, then keep the sheet to catch regressions later.
- Measure JSON validity rate. Out of 100 calls, how many returned parseable JSON with all required fields on the first try. If it is low, tighten the schema, lower temperature, or turn on JSON mode.
- Test the weird inputs on purpose: an empty description, a refund or negative amount, a foreign currency, a huge transaction, a transaction in another language, a merchant string that is just numbers. These break naive prompts. Make sure each is handled.
- Compare models on your set. Run the 8B and the 70B over the same test transactions. If the small fast one passes, use it and save your budget. Only pay the token cost of the big one where it clearly wins.
- Re-run the set whenever you change a prompt or swap a model, because free model rosters change and a prompt that worked can drift.

---

## Part 10: Common mistakes to avoid

- Asking the model to do arithmetic. Compute every number in code. This is the top mistake.
- Sending the whole database or thousands of raw transactions in one prompt. Aggregate first, send a small slice.
- Hardcoding one free model ID. Free models get pulled without notice. Keep a fallback and read the live list.
- Trusting JSON without validating it. Always parse in a try and catch and check the fields.
- No fallback for rate limits. Free tiers will hit 429. Without a fallback your feature just dies.
- Putting API keys in the client. Keys live on the server only.
- Blocking the UI on the AI. The app must work fully even if the AI is down. AI is an enhancement layer, not the foundation.
- Letting the model invent categories. Give a fixed list and a default, and reject anything off-list.
- Ignoring refunds, negative amounts, and multiple currencies. Handle them explicitly.
- Regenerating summaries on every page load. Cache and regenerate only on data change.
- Sending sensitive financial data through a free model that trains on inputs. Check the policy first.

---

## Part 11: Reusable prompt templates

These are starting points. Fill the bracketed parts from your code. Keep the system prompt stable so caching helps you.

### Categorization system prompt

```
You are a transaction categorizer for a personal finance app.
You will receive one merchant description and a fixed list of allowed categories.
You may also receive examples of how this user categorized similar past transactions.

Rules:
- Choose exactly one category, copied verbatim from the allowed list.
- If you are not confident, choose the category named Uncategorized.
- Never invent a category that is not in the list.
- Prefer the pattern shown in the user's own past examples when relevant.

Return only JSON in this exact shape and nothing else:
{"reasoning": "one short sentence", "category": "exact value from the list", "confidence": "high | medium | low"}
```

### Categorization user message

```
Merchant description: [RAW_DESCRIPTION]

Allowed categories: [COMMA_SEPARATED_ALLOWED_LIST]

This user's past examples:
[FOR EACH EXAMPLE: "DESCRIPTION" -> "CATEGORY"]
```

### Monthly summary system prompt

```
You are a friendly, supportive personal finance summarizer.
You will receive already-calculated totals. Do not do any math yourself.
Do not invent, change, or recompute any number. Use only the numbers given.
Keep it short, plain, and encouraging. Never shame the user.

Return only JSON in this exact shape:
{"headline": "one sentence", "highlights": ["point", "point"], "watch_outs": ["gentle flag"]}
```

### Question understanding system prompt (step one of finance chat)

```
You convert a user's finance question into a structured request.
Do not answer the question. Do not produce any number.
Only describe what they are asking for.

Return only JSON in this exact shape:
{"intent": "sum | list | compare | count | trend", "category": "text or empty", "time_range": "text or empty", "needs_clarification": true or false, "clarifying_question": "text or empty"}
```

### Answer phrasing system prompt (step two of finance chat)

```
You phrase a short, friendly answer to a finance question.
You are given the exact figure already computed by the system.
Use only that figure. Never change it and never add figures of your own.

Return only JSON in this exact shape:
{"answer": "one or two sentences using the given figure"}
```

---

## Part 12: What to paste to Claude Code

Copy the block below into Claude Code as your build instructions. Adjust the stack names to match your project.

```
Build the AI layer for my financial management app. Follow these rules exactly.

CORE PRINCIPLE
- The language model interprets and explains. My code computes every number.
- Never let the model do arithmetic. All totals, balances, percentages, averages,
  and sums are computed in code with real queries. The model only receives finished
  numbers and turns them into words, categories, or short explanations.

PROVIDERS (both are OpenAI API compatible)
- Primary: Groq. Base URL https://api.groq.com/openai/v1.
  Models: llama-3.1-8b-instant for simple high-volume tasks,
  llama-3.3-70b-versatile for harder tasks.
- Backup: OpenRouter. Base URL https://openrouter.ai/api/v1. Use a model ID ending in :free.
- Keep API keys on the server only. Never expose them to any client.
- Build one function that calls a model given base URL, key, and model name, so I can
  switch providers by changing those three values.

FALLBACK
- Wrap model calls in a fallback chain: Groq 8B, then Groq 70B, then an OpenRouter free
  model. Try each in order on failure.
- Validate the model's output before accepting it. A 200 response with bad content must
  trigger the next fallback.
- Use exponential backoff with jitter on 429 and 5xx errors. Handle timeouts separately.

STRUCTURED OUTPUT
- Every AI call must return JSON matching a defined shape.
- Turn on the API JSON mode (response_format json_object) where the model supports it.
- Always parse inside try and catch and validate required fields and types.
- Set temperature 0.0 to 0.2 for structured tasks.
- Put any reasoning field before answer fields in the schema.
- On parse failure, retry once by sending the broken output and the error back to the
  model to fix. If it fails again, fall back or degrade gracefully.

FEATURES TO BUILD
1. Transaction categorization.
   - Fixed list of allowed categories in code. Model must pick from it, never invent one.
   - Provide the user's own similar past transactions as few-shot examples.
   - Deduplicate by unique merchant before calling. Only categorize uncategorized rows.
   - Never overwrite a user-set category. Provide an Uncategorized fallback.
   - Store user corrections and feed them back as future examples.
2. Monthly spending summary.
   - Code computes all totals and per-category numbers. Model writes the narrative only.
3. Finance chat (two-step, safe).
   - Step one: model converts the question into a structured intent JSON. No answer, no numbers.
   - Step two: my code runs a safe query and computes the exact figure, then the model
     phrases a short answer using only that figure.
   - Do not give the model direct database access. If text to SQL is ever used, restrict to
     a read-only connection, a table and column whitelist, and a row limit.
4. Anomaly flags and recurring/subscription detection.
   - Detection is done by code rules. Model only writes the human-readable explanation.
5. Budget suggestions.
   - Supportive, never shaming tone. Short and specific.

PERFORMANCE AND LIMITS
- Send only the small slice of data each task needs. Aggregate in code first.
- Cache generated summaries. Regenerate only when underlying data changes.
- Batch bulk categorization as a nightly job under the rate limit.
- Reuse a stable system prompt so prompt caching helps.
- Use the small fast model for simple tasks and the large model only where it clearly wins.

UI BEHAVIOR
- Numbers on screen come from computed values, never from model text.
- Stream chat answers. Show the source number and a link to the underlying transactions.
- Never block the page on an AI call. If AI fails, show a quiet retry, not a broken page.

PRIVACY
- Send the minimum personal data needed. Mask account numbers and names where possible.
- Do not log prompts containing sensitive financial data without redaction.
- Before sending real financial data through any free model, respect that model's data
  policy and prefer no-training or zero data retention options.

TESTING
- Create a small labeled test set of transactions and measure categorization accuracy.
- Measure JSON validity rate. Test empty descriptions, refunds, negatives, foreign
  currency, and non-English inputs.
```

---

## Quick reminders

- Verify current free-tier limits and the current list of free OpenRouter models before you rely on them, because both change often.
- Start simple. One provider plus one backup, low temperature, validated JSON, and the rule that code does the math will already put you ahead of most AI finance apps.
- Your quality flywheel is user corrections fed back as examples. Wire that in early.
