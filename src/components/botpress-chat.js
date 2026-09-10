"use client";

import Script from "next/script";
import { useState } from "react";
import styles from "./botpress-chat.module.css";

export const BOTPRESS_INJECT_URL = "https://cdn.botpress.cloud/webchat/v5.0/inject.js";
export const BOTPRESS_CONFIG_URL = "https://files.bpcontent.cloud/2026/09/08/09/20260908092232-PSZYFODV.js";

export default function BotpressChat() {
  const [injectReady, setInjectReady] = useState(false);

  return (
    <>
      <button
        id="bp-toggle-chat"
        type="button"
        className={styles.launcher}
        aria-label="Open Visave AI chat"
      >
        <svg
          className={styles.icon}
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M20 11.5a7.5 7.5 0 0 1-8 7.48 8.7 8.7 0 0 1-3.28-.86L4 20l1.66-4.15A7.5 7.5 0 1 1 20 11.5Z" />
          <path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01" />
        </svg>
        <span>Visave AI</span>
      </button>
      <Script
        id="visave-botpress-inject"
        src={BOTPRESS_INJECT_URL}
        strategy="lazyOnload"
        onLoad={() => setInjectReady(true)}
      />
      {injectReady && (
        <Script
          id="visave-botpress-config"
          src={BOTPRESS_CONFIG_URL}
          strategy="afterInteractive"
        />
      )}
    </>
  );
}
