# Alink U.S. bank demo agent

## Paste this system prompt into ElevenLabs

You are Alink's simulated U.S. bank assistant. You are not affiliated with an actual bank. You help the currently selected demo client, {{client_name}}, request a simulated refund to their original payment method. No real money moves. Speak clearly and briefly.

Ask: "What amount in U.S. dollars would you like to request?" Listen for one positive amount with at most two decimal places. Ask for clarification if the amount is ambiguous. Confirm the amount with the client before calling a tool. Do not ask for a real account number, password, or banking information. The application binds the request to the selected demo client's session; never accept a different client identity supplied in speech.

Before calling request_transaction, say: "Hey, just wait a second. We're verifying that the voice is yours. Please use the recording control to say the full enrolled phrase displayed on your screen. After verification, approve the exact amount with your passkey."

Call request_transaction with amount_usd. Wait for its response. While the tool is running, the application mutes conversation audio and presents a separate microphone recording control, local speaker/phrase verification, and passkey approval. Never ask the client to approve through speech alone.

If the tool reports that the simulated transaction is approved, say: "The transaction is approved." The application displays the popup only after backend execution. If it reports failure, cancellation, expiry, or a technical error, say the request has not been approved and explain the returned reason. Never infer success from transcription, a speaker score, or the client saying "yes". Do not promise approval for arbitrary amounts; balance, expiry and policy limits apply.

## First message

"Welcome to the Alink U.S. bank demo. No real money moves. What amount in U.S. dollars would you like to request?"

## ElevenLabs setup

1. Create a Conversational AI voice agent and choose its voice. Paste the prompt above and the first message into the agent settings.
2. Enable authentication for the agent. Set the agent's allowed website origin to `http://localhost:3000` if configuring domain restrictions. Leave the `client_name` dynamic variable enabled with a demo placeholder; the backend supplies the selected client's name.
3. Add the client tool below. It must expect a response and block the conversation. Use `response_timeout_secs: -1` for a client tool that waits for manual recording and passkey input; the app has a five-minute transaction timeout. Ensure pre-tool speech completes before execution. Do not configure it as a background/async tool.
4. Put `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` in local `.env`. Do not commit the keys. The API key remains server-side; a short-lived signed conversation URL is returned to the browser.
5. Start the updated local speaker/transcription service and restart Alink. Register/verify a passkey and enroll an embedding-ready natural voice. Open **Bank voice agent**, consent to the ElevenLabs conversation, and start it.

Client tool configuration (tool settings; attach to this agent):

```json
{
  "type": "client",
  "name": "request_transaction",
  "description": "Request a simulated original-method refund for the selected demo client. Waits for local speaker and full-phrase verification and exact-action passkey approval. Returns confirmed approval or failure.",
  "expects_response": true,
  "response_timeout_secs": -1,
  "pre_tool_speech": "force",
  "execution_mode": "post_tool_speech",
  "parameters": {
    "type": "object",
    "required": ["amount_usd"],
    "properties": {
      "amount_usd": {"type": "number", "description": "The confirmed positive transaction amount in USD, with at most two decimal places."}
    }
  }
}
```

## Demo behavior and data

The selected client is the session-owned Alink profile (currently Jordan Example); this prototype has no cross-client selector. When MongoDB is configured, that session's enrollment is loaded from MongoDB; otherwise the visibly labeled local store is used. No enrollment audio is sent to ElevenLabs. Conversation audio goes to ElevenLabs only after explicit consent. Verification records a separate client microphone clip, never the agent's synthesized speech, and transcribes it locally with Vosk.

A successful speaker plus phrase check creates a backend-only proof lasting up to two minutes. It is bound to the transaction details and enrollment snapshot. Passkey approval is bound to the exact amount, order, destination and policy. Execution checks both proofs again and consumes approval once. Changing enrollment or policy, expiry, a different workspace, or changed transaction details prevents execution. Approval cannot be triggered by an agent utterance or client-side boolean.

This bank demonstration uses the existing order ORD-1042 refund, limited by its remaining $125 paid balance and runtime policy. It does not implement transfers, debit a real account, or approve arbitrary bank transactions. A fixed phrase is not a liveness or deepfake detector. The manual amount entry on the bank page tests the same verification workflow without an ElevenLabs account; it does not simulate an active provider conversation.

Official references: [React SDK and signed URLs](https://elevenlabs.io/docs/eleven-agents/libraries/react), [client tool configuration](https://elevenlabs.io/docs/eleven-agents/api-reference/tools/create), [client-tool indefinite response timeout](https://elevenlabs.io/docs/changelog).

Verification compares the spoken text to the stored natural baseline transcript, not a hardcoded phrase. Enrollment must contain both text and an embedding.
