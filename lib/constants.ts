/**
 * Identity embedded in every Access Token app/api/token/route.ts issues.
 * app/api/voice/route.ts checks that incoming calls originate from this
 * exact identity (Twilio reports it as "client:<identity>") before dialing
 * out anywhere, so this must stay in sync between the two routes - hence
 * the shared constant instead of copy-pasting the string.
 */
export const AGENT_IDENTITY = "amar-dialer";
