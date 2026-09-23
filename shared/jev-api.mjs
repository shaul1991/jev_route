const API_URL = "https://api.typesafe.ai/v1/systemone"

export async function requestJev(payload, apiKey, signal) {
  return fetch(API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal,
  })
}
