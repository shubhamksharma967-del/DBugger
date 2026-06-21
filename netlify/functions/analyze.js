// D-Bugger — Netlify Serverless Function
// Uses Google Gemini API (Free Tier)
// Environment variable required: GEMINI_API_KEY
// Optional: GEMINI_MODEL (defaults to gemini-2.0-flash)

export const handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  }

  try {
    const body = JSON.parse(event.body || '{}')
    const { system, userMsg } = body

    if (!userMsg || !userMsg.trim()) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing userMsg in request body.' })
      }
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return {
        statusCode: 503,
        headers,
        body: JSON.stringify({
          error: 'GEMINI_API_KEY is not set. For local testing, create a .env file in the project root with GEMINI_API_KEY=AIza... and run with `netlify dev`. For production, add it in Netlify Site configuration -> Environment variables and redeploy.'
        })
      }
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const geminiPayload = {
      contents: [
        {
          parts: [
            { text: `${system || 'You are a helpful assistant.'}\n\n${userMsg}` }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 1400,
        topP: 0.8
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' }
      ]
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiPayload)
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const detail = data?.error?.message || response.statusText || 'Unknown error'
      return {
        statusCode: response.status,
        headers,
        body: JSON.stringify({ error: `Gemini API error: ${detail}` })
      }
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text

    if (!text) {
      // Could be blocked by safety filters or empty candidates
      const finishReason = data?.candidates?.[0]?.finishReason
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Gemini returned no text (finishReason: ${finishReason || 'unknown'}). Try again.` })
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text: text.trim() })
    }

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + err.message })
    }
  }
}