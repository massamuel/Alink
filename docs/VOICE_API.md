# User voice embedding API

This local demo provisions one example user, Jordan Example, per browser session. A persistent user ID is attached to the existing profile; existing enrollments and passkeys are preserved. The session cookie owns the profile: knowing a different user ID does not grant access. This is not production account authentication.

## Register the example user

`POST /api/users` with JSON `{ "name": "Jordan Example" }` returns `{ "user_id": "…", "name": "Jordan Example" }`. Returns 201 on creation, 200 on repeat calls, retaining the same ID. The app registers this user automatically on load. Other names are rejected in this single-user demo.

## Create an embedding

`POST /api/users/:user_id/embeddings?pitch=normal` with raw mono 16 kHz PCM WAV bytes, `Content-Type: audio/wav`, `X-Recording-Consent: yes`, the session cookie, and the configured same-origin `Origin` header. Pitch is `normal`, `high`, or `low`; the legacy `variation=natural|higher|lower` values are also accepted. A recently verified passkey is required.

The server extracts a speaker vector and speech-to-text locally and stores both with the recording under this user's profile in MongoDB (or the configured local fallback). Empty transcripts or unavailable embeddings are rejected without saving. Response is updated AppState including `profile.userId`, recording IDs, and baseline text for the authenticated owner; numeric vectors stay server-side.

There are at most three saved embeddings, one per pitch. A fourth returns HTTP 409 with exactly `{ "error": "User has reached voice embedding limit" }`. A duplicate pitch below the limit returns 409 requiring deletion before replacement. Limits are rechecked inside the serialized/revision-checked database update to handle concurrent requests. Legacy recordings count toward the limit and are never silently deleted.

## Verify

`POST /api/users/:user_id/embeddings/verify?pitch=normal` uses the same audio, consent, cookie and Origin headers. The server selects this user's baseline for the specified pitch and compatible speaker model, compares the speaker vector, and checks the full transcript against that baseline's stored text. Case and punctuation are ignored; missing, extra, changed, or reordered words fail. Another pitch cannot override a failed match.

Response includes `user_id`, `name`, `verification` ("Verification successful", "Verification failure", or "Verification unavailable"), speaker score, phrase result, and baseline sample ID. Unavailable distinguishes a missing baseline or offline service from a failed comparison. Verification audio is not stored. Voice matching grants no transaction approval and does not establish liveness.

The app prompts Jordan to say the selected baseline text. Verify a passkey to reveal stored text. The removed bank conversational agent is not restored by this change.

Legacy `/api/voices` and `/api/voices/verify` remain compatible and enforce the same limits. Existing owner-scoped `DELETE /api/voices/:id` and `GET /api/voices/:id/audio` manage samples; deletion requires a recently verified passkey and frees the pitch slot.

## Local validation

With services managed separately, run `pnpm typecheck`, `pnpm test`, and `pnpm build`. Tests include pitch slot limits, exact limit text, ownership, and selected-baseline speaker/text checks. No services need to start for these checks.
