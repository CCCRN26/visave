"use client";

import Script from "next/script";
import { useState } from "react";

export const BOTPRESS_INJECT_URL = "https://cdn.botpress.cloud/webchat/v5.0/inject.js";
export const BOTPRESS_CONFIG_URL = "https://files.bpcontent.cloud/2026/09/08/09/20260908092232-PSZYFODV.js";

export default function BotpressChat() {
  const [injectReady, setInjectReady] = useState(false);

  return (
    <>
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
