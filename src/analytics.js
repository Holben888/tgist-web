const ANALYTICS_AUTHORIZATION_ENDPOINT = '/api/analyticskey'
const ANALYTICS_KEY_PHRASES_ENDPOINT =
  'https://eastus.api.cognitive.microsoft.com/text/analytics/v2.0/keyPhrases'
const ANALYTICS_SENTIMENT_ENDPOINT =
  'https://eastus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment'

// ranking factors
const KEY_PHRASE_WEIGHT = 18
const MONEY_WEIGHT = 5
const NUMERAL_WEIGHT = 4
const LENGTH_WEIGHT = 0.05

// best sentence filters
const K_SCORE_THRESHOLD = 0.35
const MIN_ITEMS = 5

// increase to make sentiment more volatile
const SENTIMENT_CHANGE_RATE = 0.2

const analyticsKey = fetch(ANALYTICS_AUTHORIZATION_ENDPOINT).then(req =>
  req.text()
)

function processBestSentences(transcript) {
  const taggedTranscript = transcript
    .map((item, index) => ({ ...item, index }))
    .filter(({ recognized }) => recognized)
  const transcriptText = taggedTranscript
    .map(({ recognized }) => recognized)
    .join('\n')

  analyticsKey
    .then(key =>
      fetch(ANALYTICS_KEY_PHRASES_ENDPOINT, {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': key,
        }),
        body: JSON.stringify({
          documents: [
            {
              language: 'en',
              id: '1',
              text: transcriptText,
            },
          ],
        }),
      })
    )
    .then(req => req.json())
    .then(res => {
      const { keyPhrases } = res.documents[0]
      const sentenceMap = getSentenceRanks(taggedTranscript, keyPhrases)
      const bestSentences = getNBestSentences(sentenceMap, taggedTranscript)
      const sentenceIdxs = new Set(bestSentences.map(({ index }) => index))
      taggedTranscript.forEach((_, i) => {
        transcript[i].important = sentenceIdxs.has(i)
      })
    })
}

function processSentiment(customerTranscript) {
  return analyticsKey
    .then(key =>
      fetch(ANALYTICS_SENTIMENT_ENDPOINT, {
        method: 'POST',
        headers: new Headers({
          'Content-Type': 'application/json',
          'Ocp-Apim-Subscription-Key': key,
        }),
        body: JSON.stringify({
          documents: [
            {
              language: 'en',
              id: '1',
              text: customerTranscript[customerTranscript.length - 1].recognized,
            },
          ],
        }),
      })
    )
    .then(req => req.json())
    .then(res => {
      const currSentiment = res.documents[0].score
      if (customerTranscript.length > 1) {
        const prevSentiment =
          customerTranscript[customerTranscript.length - 2].sentiment
        customerTranscript[customerTranscript.length - 1].sentiment =
          SENTIMENT_CHANGE_RATE * currSentiment +
          (1 - SENTIMENT_CHANGE_RATE) * prevSentiment
      } else {
        customerTranscript[0].sentiment = currSentiment
      }
      return customerTranscript[customerTranscript.length - 1].sentiment
    })
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // $& means the whole matched string
}

function getSentenceRanks(transcript, keyPhrases) {
  keyPhrases = keyPhrases.map((keyPhrase, i) => ({
    regex: new RegExp(`\\b${escapeRegExp(keyPhrase)}\\b`, 'g'),
    weight: KEY_PHRASE_WEIGHT * Math.pow(1 - i / keyPhrases.length, 3),
  }))

  const sentencesDict = new Map()
  transcript.forEach(({ recognized, index }) => {
    let score = 0
    keyPhrases.forEach(({ regex, weight }) => {
      score += (recognized.match(regex) || []).length * weight
    })
    score += /\d/.test(recognized) * NUMERAL_WEIGHT
    score += /\$|\bdollars?\b|\bmoney\b/.test(recognized) * MONEY_WEIGHT
    score += recognized.length * LENGTH_WEIGHT
    sentencesDict.set(index, score)
  })

  return sentencesDict
}

function getNBestSentences(sentenceMap, transcript) {
  const sentenceTuples = Array.from(sentenceMap.entries()).sort(
    (a, b) => b[1] - a[1]
  )
  let filtered = sentenceTuples.filter(
    ([i, score]) => score >= K_SCORE_THRESHOLD * transcript.length
  )
  if (filtered.length < MIN_ITEMS) {
    filtered = sentenceTuples.slice(0, MIN_ITEMS)
  }
  filtered = filtered
    .sort((a, b) => a[0] - b[0])
    .map(([k, v]) => ({ ...transcript[k], score: v }))

  return filtered
}

export { processBestSentences, processSentiment }
