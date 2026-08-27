/**
 * Throwaway checker: sends check image(s) to the Anthropic vision API using the same
 * prompt as electron/ai/extractCheck.js, and prints the extracted fields (amount, date,
 * bank/logo, routing/account numbers, etc.) with per-field confidence.
 *
 * Usage:
 *   $env:ANTHROPIC_API_KEY="sk-ant-..."
 *   node electron/scripts/test-logo-detection.js                # every image in "Sample Check"
 *   node electron/scripts/test-logo-detection.js "C:\path\to\check.jpg"   # a single file
 *
 * TIFF inputs are converted to PNG on the fly via PowerShell + System.Drawing
 * (no new npm dependency) since Anthropic's vision API only accepts JPEG/PNG/GIF/WebP.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const MODEL = 'claude-opus-5';
const SAMPLE_DIR = path.join(__dirname, '..', '..', 'Sample Check');

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

/** Converts a TIFF to PNG via PowerShell/System.Drawing, returning the temp PNG path. */
function convertTiffToPng(tiffPath) {
  const pngPath = path.join(os.tmpdir(), `${path.basename(tiffPath, path.extname(tiffPath))}-${Date.now()}.png`);
  const script = [
    'Add-Type -AssemblyName System.Drawing;',
    `$img = [System.Drawing.Image]::FromFile('${tiffPath.replace(/'/g, "''")}');`,
    `$img.Save('${pngPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png);`,
    '$img.Dispose();',
  ].join(' ');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  return pngPath;
}

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  throw new Error(`Unsupported extension for Anthropic vision API: ${ext}`);
}

async function extractOne(filePath, apiKey) {
  const mediaType = mediaTypeFor(filePath);
  const imageBase64 = fs.readFileSync(filePath).toString('base64');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
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
  if (!textBlock) throw new Error('Anthropic response contained no text content.');
  return JSON.parse(stripCodeFences(textBlock.text));
}

/** Resolves the files to test: a single CLI-provided path, or every image in SAMPLE_DIR. */
function resolveTargets() {
  const cliPath = process.argv[2];
  if (cliPath) {
    if (!fs.existsSync(cliPath)) {
      console.error(`File not found: ${cliPath}`);
      process.exit(1);
    }
    if (!/\.(jpe?g|png|tiff?)$/i.test(cliPath)) {
      console.error(`Unsupported file type: ${cliPath} (expected .jpg, .png, or .tif)`);
      process.exit(1);
    }
    return [{ name: path.basename(cliPath), originalPath: cliPath }];
  }

  if (!fs.existsSync(SAMPLE_DIR)) {
    console.error(`Sample Check folder not found at ${SAMPLE_DIR}`);
    process.exit(1);
  }
  return fs
    .readdirSync(SAMPLE_DIR)
    .filter((name) => /\.(jpe?g|png|tiff?)$/i.test(name))
    .map((name) => ({ name, originalPath: path.join(SAMPLE_DIR, name) }));
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Set ANTHROPIC_API_KEY in the environment before running this script.');
    process.exit(1);
  }

  const targets = resolveTargets();

  for (const { name, originalPath } of targets) {
    const isTiff = /\.tiff?$/i.test(name);
    const targetPath = isTiff ? convertTiffToPng(originalPath) : originalPath;

    try {
      const result = await extractOne(targetPath, apiKey);
      console.log(`\n=== ${name} ===`);
      console.log(`bank: ${result.bank}  (confidence: ${result.confidence?.bank})`);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.log(`\n=== ${name} ===`);
      console.error(`ERROR: ${err.message}`);
    } finally {
      if (isTiff) fs.unlinkSync(targetPath);
    }
  }
}

main();
