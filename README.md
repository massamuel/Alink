# Alink

**Voice, verified. Actions, protected.** A React + TypeScript hackathon app combining experimental speaker verification, passkey approval for exact actions, and agent permission assessment.

A customer with a changed voice requests a refund. Alink offers a registered passkey alternative and keeps the refund restricted to the permitted amount and destination. Voice consistency never authorizes an action by itself.

## Quick start

Node 22.12+ and pnpm are required.

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open **http://localhost:3000** (use localhost rather than 127.0.0.1 because the configured WebAuthn origin and host must match). The backend and Vite share port 3000. Production bundle: `pnpm build`, then `pnpm start`. Stop with Ctrl+C.

No credentials are required to inspect the dashboard, run policy replay, and propose mock refunds. Recordings and profile changes require registering and verifying a real passkey. Browsers that do not support WebAuthn cannot perform approval; there is no insecure approval bypass. Use Chrome, Edge, or Safari on localhost with a compatible authenticator. This is first-use provisioning of a local demo profile, **not identity proofing of a real customer**.

## What actually works

- Browser microphone capture and audio-file upload, converted to 16 kHz mono PCM WAV.
- Passkey registration, profile verification, exact-action refund approval, and policy-change approval using SimpleWebAuthn.
- Consent-gated enrollment, playback, and deletion. Verification clips are transient.
- A local persistent JSON/binary store, or real MongoDB records and BSON binary recordings when configured.
- A local SpeechBrain speaker-model adapter; no fake scores when offline.
- ElevenLabs transcription on an explicit user button when configured.
- Five scripted policy attack/legitimate-task replay cases.
- Real Semgrep scans of vulnerable/repaired connector fixtures when installed.
- Simulated, approval-gated refunds with order balance, destination, expiry, policy version, and single-use checks.
- Activity records that avoid raw biometric data and credentials.

## Sponsor setup

### MongoDB

Create an Atlas database or run MongoDB locally. Put `MONGODB_URI` in `.env`; optionally set `MONGODB_DB=alink`. Give the database user access only to this database. The app connects at startup; configured connection failures stop startup rather than silently selecting local storage. Dashboard displays whether MongoDB or local storage is active.

`workspaces` stores profiles, credential public keys, orders, actions, policies, and audit records. `recordings` stores owner-scoped BSON Binary WAV data. Clips are limited to 2–30 seconds and 2 MB, below the BSON 16 MiB document limit. No GridFS is needed for these clips. Configure appropriate database access, encryption, and retention for deployment. Embeddings are sensitive biometric data, not anonymous hashes.

### ElevenLabs

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_STT_MODEL=scribe_v2`. In Action approvals, consent to sending the clip to ElevenLabs, record a request, then click **Transcribe with ElevenLabs**. The returned transcript is for review; a narrow transcript planner can fill the structured form, which controls the actual proposed amount and destination. It never automatically executes an action. No audio is sent during a local speaker check.

This integration is speech-to-text, not speaker identity, liveness, or deepfake detection. A hosted conversational agent and phone-call transport are future integrations; this prototype is browser-based.

### Semgrep

Install the official Semgrep CLI with `.venv/bin/pip install -r requirements-tools.txt` after creating the virtual environment below, or with your package manager, then set `SEMGREP_BIN` to its executable path if it is not on PATH. The backend automatically detects `.venv/bin/semgrep` when no explicit binary is configured. Run `.venv/bin/semgrep scan --config semgrep/rules.yml fixtures --json`, or Permission Doctor → Run permission check. The two custom rules flag direct refund execution and voice-only approval in `fixtures/vulnerable-connector.ts`. `fixtures/repaired-connector.ts` routes through an approved-action interface. These are instructional fixtures and are never imported by the app.

Permission Doctor changes runtime policy after passkey approval. It does **not** silently patch source code. The dashboard shows actual scanner output, or an explicit unavailable state. The GitHub workflow checks both fixture detection and that the repaired fixture scans cleanly.

## Local speaker model

Use Python 3.10–3.12. Install the pinned compatible Torch/SpeechBrain requirements in an isolated environment:

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r voice-service/requirements.txt
.venv/bin/python voice-service/download_asr.py
.venv/bin/uvicorn app:app --app-dir voice-service --host 127.0.0.1 --port 8001
```

The first startup downloads `speechbrain/spkrec-ecapa-voxceleb` from Hugging Face into the ignored model directory. Only model files are downloaded; enrollment audio stays local. Set `VOICE_SERVICE_URL=http://127.0.0.1:8001` and restart Alink if necessary. Run the service **before enrollment** so embeddings are created. If you saved clips with the service offline, delete/re-enroll after independently verifying your passkey. Old clips are not silently submitted anywhere.

The experimental score is mean cosine similarity against compatible **natural** reference samples. High/low/singing comparisons are diagnostic and do not widen the acceptance decision. `VOICE_THRESHOLD=0.65` is an uncalibrated prototype setting, not a probability or a validated security threshold. Evaluate genuine versus consenting impostor samples before interpreting outcomes. Multi-style enrollment does not establish illness robustness. Use actual healthy/sick samples with consent; label artificial voice changes as simulated. Pitch/voice consistency cannot determine liveness or defeat a responsive voice clone.

## Demo walkthrough

1. Overview: review honest integration statuses. Register a passkey using a supported browser.
2. Voice profile: consent, record natural samples and optional styles, and save. Speaker service offline means audio is saved but no embedding is invented.
3. Record a fresh clip; inspect consistency and per-style scores if the model is running. For uncertainty, use the passkey alternative without changing the threshold.
4. Permission Doctor: scan broad sample policy, inspect the five replay cases and Semgrep output. Verify and apply the proposed repair.
5. Action approvals: propose a $50 refund to the original card. Verify the exact details with the registered passkey, then execute the mock refund once.
6. Try an external destination or amount exceeding the remaining order balance. The backend blocks it.
7. Activity trail: inspect decisions. Rollback requires a fresh purpose-specific passkey proof and invalidates old approvals.

The policy replay illustrates an intentionally broad configuration. The **live mock executor always requires a valid passkey proof**, even before repair. Changed-voice/replay scenarios are scripted authorization cases, not an empirical deepfake or speaker benchmark.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm scan
# With the local server running:
pnpm test:api
```

Tests cover altered amounts/destinations, replay, expiry, policy changes, over-refunds, missing approval, voice-model failure, score aggregation, and unusable WAV data. A software-authenticator integration client additionally checks real WebAuthn signature verification and audio persistence against localhost. It is not a production bypass. Physical passkey ceremonies require user interaction and cannot be established by these unit tests.

## Architecture

```text
Browser recording → local speaker service → owner-scoped enrollment comparison
                    ↓ result never grants approval
Reviewed refund request → policy checks → exact-action WebAuthn approval
                    → atomic mock execution → audit
Doctor → policy replay + Semgrep fixture scan → review → passkey → policy repair
```

- `src/App.tsx`: dashboard, voice profile, approvals, doctor, activity.
- `src/components/Recorder.tsx`: microphone lifecycle and WAV conversion.
- `src/server/engine.ts`: permission and exact-action approval enforcement.
- `src/server/store.ts`: local and MongoDB persistence; serialized/CAS workspace updates.
- `src/server/providers.ts`: speaker, ElevenLabs, and Semgrep adapters; WAV validation.
- `server.ts`: same-origin session-owned API and WebAuthn ceremonies.
- `voice-service/`: optional local pretrained speaker inference.
- `docs/PROJECT_BRIEF.md`: scope and teammate review notes.

## Prototype boundaries

Localhost only. Session cookie possession identifies a local demo workspace; initial enrollment is first-use profile provisioning. There is no verified bank identity, production account recovery, public hosting, phone-call interception, OAuth connector, or general vulnerability discovery. A real deployment needs authenticated identity provisioning and recovery, transport security, tenancy and role separation, durable session management, protected approval displays, deployment-specific biometric consent/retention, and actual provider integration tests. Voice is not relied on as a banking authenticator. Neither model consistency nor these tests establish production security.

Never commit `.env`, recordings, embeddings, credentials, or `.data`. The existing AgentPermissionsDoctor repository is separate and unchanged.

## Speaker plus phrase verification

Verification now transcribes the **same WAV clip** locally using Vosk and compares it to “The rain in Spain falls mainly on the plain”. A passing result requires both compatible natural-speaker embeddings above the prototype threshold and the complete phrase in order. Case, punctuation, and whitespace are ignored; missing, changed, reordered, or extra words fail. Say the phrase once, without an introduction. No expected-phrase grammar or prompt is given to the recognizer.

Install the updated Python requirements and run `.venv/bin/python voice-service/download_asr.py`, then restart **both** the voice service and the Alink server. The health endpoint includes `transcriptionReady`. If transcription is offline or errors, verification is unavailable rather than a voice-only pass. Existing embedding-ready natural enrollment can still be used; no re-enrollment is needed just for this feature.

The result shows expected text, recognized text, and separate speaker/phrase outcomes. Recognition errors can cause false rejection; inspect the transcript and retry in a quiet room. Matching a fixed phrase does not establish liveness or prevent playback of a complete recording. Refund approval still requires a passkey. Verification audio/transcript are not persisted or sent to ElevenLabs by this feature.

## ElevenLabs bank voice agent

Open **Bank voice agent** for the selected demo client's amount → voice/phrase verification → exact-action passkey → simulated approval popup workflow. Configure your ElevenLabs voice agent using [docs/BANK_AGENT.md](docs/BANK_AGENT.md), then add `ELEVENLABS_AGENT_ID` alongside `ELEVENLABS_API_KEY` in `.env`. Restart Alink to load these values. The API key stays on the server. The page offers a manual amount entry to test the same backend checks before provider setup. This is still the sample original-card refund, not a real banking connector. Live provider conversation testing requires your configured agent and credentials.

## Stored baseline text verification

Enrollment now stores the locally extracted `transcript` alongside the same sample's recording, embedding, model, and ID in the profile (MongoDB when configured, otherwise the local store). New enrollment is rejected if either embedding extraction or transcription fails; “saved” means both are present. Verification uses the first compatible natural sample with stored text as the phrase baseline and compares embeddings only from recordings with that same normalized transcript. It never combines a matching phrase from one enrollment with speaker evidence from a different phrase.

The displayed expected phrase comes from that stored baseline. Punctuation/capitalization/whitespace are ignored; missing, extra, reordered or changed words fail. A successful result requires both transcript equality and speaker similarity above the experimental threshold. The UI shows **Verification successful**, **Verification failure**, or **Verification unavailable**, with separate evidence. This compares speaker characteristics, not byte-identical audio. Both voice and phrase recognition can make errors; this is not liveness verification.

Older samples without transcripts remain visible but cannot form a complete baseline. Verify your passkey and record a new natural baseline with the updated speaker/transcription service running. The app does not silently retranscribe old audio. Enrollment text follows the recording's deletion lifecycle and is shown only with recent profile authentication. Verification transcripts remain transient. Restart the Alink server after updating; the Python service does not need changes for this feature if its `/transcribe` endpoint is already running.
