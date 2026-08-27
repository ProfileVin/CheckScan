const fs = require('fs');
const { getApiKey } = require('./secureSettings');

const MODEL = 'claude-opus-5'; // vision-capable

const EXTRACTION_PROMPT = `This is a check, though not necessarily a standard bank check - it's mostly similar to one. \
The amount can be handwritten. The date can be handwritten. \
The bottom right has a barcode - ignore it. Below the barcode are the routing and account numbers. \
The routing number may include one or more MICR symbols; exclude those, they are not part of the number. \
Identify the issuing bank from its printed logo or name.

Return strict JSON only, no markdown code fences, in exactly this shape:
{"amount": number, "date": "YYYY-MM-DD", "bank": string, "routingNumber": string, "accountNumber": string, "donorName": string, "checkNumber": string, "confidence": {"amount": "high"|"medium"|"low", "date": "high"|"medium"|"low", "bank": "high"|"medium"|"low", "routingNumber": "high"|"medium"|"low", "accountNumber": "high"|"medium"|"low", "donorName": "high"|"medium"|"low", "checkNumber": "high"|"medium"|"low"}}

Each confidence value is your certainty in that field: "high" (clearly legible, confident), \
"medium" (readable but some doubt), or "low" (hard to read or guessed). \
If a field cannot be read at all, use null for its value and "low" for its confidence.`;

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Sends a scanned check image to the Anthropic API and asks for amount, date, bank,
 * routing/account numbers, donor name, check number, and per-field confidence.
 * @param {string} imagePath - local disk path to the check JPEG.
 */
async function extractCheck(imagePath) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Anthropic API key is not set. Add it in Settings before extracting check data.');
  }

  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      // Generous headroom: claude-opus-5 spends output tokens on internal reasoning before
      // the visible JSON, so a tight limit truncates the answer mid-string.
      model: MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
            },
            { type: 'text', text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic extraction failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const textBlock = data.content.find((block) => block.type === 'text');
  if (!textBlock) {
    const blockTypes = data.content.map((block) => block.type).join(', ') || '(empty)';
    throw new Error(
      `Anthropic response contained no text content. stop_reason=${data.stop_reason}, blocks=[${blockTypes}]`
    );
  }

  if (data.stop_reason === 'max_tokens') {
    throw new Error(
      'Anthropic response was cut off before the JSON finished (stop_reason=max_tokens). ' +
      'Raise max_tokens in extractCheck.js.'
    );
  }

  const raw = stripCodeFences(textBlock.text);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Could not parse extraction JSON (${err.message}). Model returned: ${raw.slice(0, 500)}`);
  }
}

module.exports = { extractCheck };
