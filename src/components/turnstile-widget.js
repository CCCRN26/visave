"use client";

import Script from "next/script";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

const TurnstileWidget = forwardRef(function TurnstileWidget({ enabled, siteKey, action, onTokenChange }, ref) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const callbackRef = useRef(onTokenChange);
  const [scriptReady, setScriptReady] = useState(false);
  const [status, setStatus] = useState(enabled ? "verifying" : "disabled");

  useEffect(() => { callbackRef.current = onTokenChange; }, [onTokenChange]);
  useImperativeHandle(ref, () => ({
    reset() {
      callbackRef.current("");
      setStatus("verifying");
      if (widgetIdRef.current !== null && window.turnstile) window.turnstile.reset(widgetIdRef.current);
    },
  }), []);

  useEffect(() => {
    if (!enabled) { callbackRef.current(""); setStatus("disabled"); return undefined; }
    if (!siteKey) { callbackRef.current(""); setStatus("unavailable"); return undefined; }
    if (!scriptReady && !window.turnstile) return undefined;
    if (!window.turnstile || !containerRef.current || widgetIdRef.current !== null) return undefined;
    setStatus("verifying");
    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        action,
        theme: "auto",
        size: "flexible",
        appearance: "interaction-only",
        "response-field": false,
        retry: "auto",
        callback(token) { callbackRef.current(token); setStatus("verified"); },
        "error-callback"() { callbackRef.current(""); setStatus("unavailable"); return true; },
        "expired-callback"() {
          callbackRef.current(""); setStatus("expired");
          if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current);
        },
        "timeout-callback"() {
          callbackRef.current(""); setStatus("timeout");
          if (widgetIdRef.current !== null) window.turnstile?.reset(widgetIdRef.current);
        },
      });
    } catch { callbackRef.current(""); setStatus("unavailable"); }
    return () => {
      if (widgetIdRef.current !== null && window.turnstile) window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, [action, enabled, scriptReady, siteKey]);

  if (!enabled) return null;
  const messages = {
    verifying: "Verifying you are human…",
    verified: "Human verification complete.",
    expired: "Verification expired. Please verify again.",
    timeout: "Verification timed out. Please verify again.",
    unavailable: "Human verification is temporarily unavailable. Please try again.",
  };
  return (
    <div className="turnstile-field">
      {siteKey && <Script id="cloudflare-turnstile-api" src={SCRIPT_URL} strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => { callbackRef.current(""); setStatus("unavailable"); }} />}
      <div ref={containerRef} className="turnstile-widget" />
      <p className={status === "unavailable" || status === "expired" || status === "timeout" ? "form-error" : "form-help"} role="status" aria-live="polite">{messages[status]}</p>
    </div>
  );
});

export default TurnstileWidget;

