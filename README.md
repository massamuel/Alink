# Alink

React + TypeScript voice enrollment and verification prototype. Enrollment stores a WAV recording, the locally extracted transcript, and its SpeechBrain speaker embedding together. Verification checks both speaker similarity and the spoken words against the saved natural baseline.

## Run locally

Node 22.12+ and pnpm:

```sh
pnpm install
cp .env.example .env # first setup only; keep an existing .env
pnpm dev
```

Open http://localhost:3000 directly in a browser that supports WebAuthn and microphone recording. Build with `pnpm build`; run the compiled app with `pnpm start`. Stop servers with Ctrl+C.

## Local voice service

Use Python 3.10–3.12:

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r voice-service/requirements.txt
.venv/bin/python voice-service/download_asr.py
.venv/bin/uvicorn app:app --app-dir voice-service --host 127.0.0.1 --port 8001
```

Set `VOICE_SERVICE_URL=http://127.0.0.1:8001`. First startup downloads the SpeechBrain ECAPA model; the download script installs the local English Vosk transcription model. No enrollment or verification audio is uploaded to a cloud provider. `/health` reports speaker readiness and `transcriptionReady`. Keep this service running before saving enrollment.

## Enroll and verify

1. Register/verify a passkey for the local demo profile. This is local provisioning, not proof of a real person's identity.
2. Select your built-in microphone in macOS Sound → Input, then allow browser microphone access. Alink uses the default input device.
3. Open Voice profile, consent to storing audio/text/embedding, select Natural voice, record the displayed phrase, and save. Extraction failures prevent saving an incomplete new enrollment.
4. Confirm the enrollment row shows its extracted baseline text and “Embedding ready”. Older samples without text must be re-enrolled; old audio is never silently retranscribed.
5. Record the full saved baseline phrase once and run verification. Results show Verification successful, Verification failure, or Verification unavailable, with separate speaker and phrase results.

Verification selects the first compatible natural baseline and compares speaker embeddings only from references carrying the same normalized text. Capitalization, punctuation and whitespace are ignored; missing, reordered, changed or extra words fail. Higher/lower/singing samples remain supporting diagnostics. Deleting an enrollment removes its audio, text and embedding. Verification clips and transcripts are transient.

`VOICE_THRESHOLD=0.65` is an uncalibrated prototype cosine threshold, not a probability. Similarity is not byte-identical audio matching. Recognition errors, illness, microphone changes and background noise can affect results. Neither speaker matching nor a fixed phrase proves liveness or defeats replay/deepfakes.

## Storage and ElevenLabs

Empty `MONGODB_URI` selects the explicitly labeled local JSON/binary store. Set a local MongoDB or Atlas URI and `MONGODB_DB=alink` to use MongoDB. Profiles store transcripts and embeddings; owner-scoped recordings store BSON Binary WAV data. Configured MongoDB connection failures stop startup. Clips are limited to 2–30 seconds and 2 MB. Never commit `.env`, biometric data or `.data`.

Optional ElevenLabs speech-to-text for reviewed refund requests uses `ELEVENLABS_API_KEY` and `ELEVENLABS_STT_MODEL=scribe_v2`. Only the explicit consented Transcribe button sends a request clip to ElevenLabs. Local enrollment/verification uses Vosk. No Conversational AI agent is used.

## Action approvals

The remaining action page simulates refunds for the sample order. A narrow transcript planner can fill a reviewed form. Every execution requires a passkey bound to the exact action, amount, destination, policy version and expiry. Approvals are single-use and remaining paid balance is enforced. Existing runtime policy limits are retained. Requests from the retired bank-agent flow cannot execute. No real money moves.

## Checks

```sh
pnpm test
pnpm build
pnpm test:api # with the app and voice service running
```

For isolated API tests, start `node scripts/mock-voice-service.mjs`, point a separate app server's `VOICE_SERVICE_URL` at http://127.0.0.1:8003, and set `ALINK_TEST_VOICE=1` for `pnpm test:api`. `ALINK_TEST_ORIGIN` selects that test app's localhost origin. The mock is only a transport/security test fixture and must never be used for actual voice verification. Tests do not establish biometric accuracy or physical-authenticator compatibility.

Semgrep remains an optional development/CI fixture scan (`pnpm scan`, or `.venv/bin/semgrep scan --config semgrep/rules.yml fixtures --json` after installing `requirements-tools.txt`). It has no app page or runtime API. The Permission Doctor and bank-agent pages, tools and routes have been removed.

This application is a localhost hackathon prototype. There is no production identity provisioning, recovery, real banking connector or public hosting.

### Backend diagnostic logs

The Node server and Python voice service emit one JSON event per line to stdout/stderr. Capture these streams with your process manager. Each browser response includes `X-Request-ID`; search that ID in both services to trace processing. Node generates the ID and forwards it to the local voice service.

Events cover HTTP status and duration, host/origin/rate-limit rejections, passkey challenge issuance and successful verification, passkey-protected enrollment access, validated audio quality, local embedding/transcription success or failure, baseline persistence, and baseline verification outcomes. `voice.baseline_checked` includes the selected pitch, enrollment count, whether a compatible baseline was found, speaker score/threshold, phrase status, and combined status. Provider failures report HTTP status or a fixed failure category. `request.failed` identifies the failing route and error category; the paired HTTP event reports status.

Enrollment requires a verified profile passkey and recording consent. Voice verification selects a baseline with matching pitch/model/dimensions and checks the speaker and words against that baseline. A voice match is not liveness proof; refund execution still requires exact-action passkey approval.

Diagnostic logs omit audio, embeddings, transcripts/baseline text, cookies, passkey material, request bodies, query strings, and raw exception messages. They contain voice similarity scores; configure access and retention in your log collector. Existing in-app audit history is separate from these diagnostics. Logs go to process streams; no log file or collector is configured automatically.
