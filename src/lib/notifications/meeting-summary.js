const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatNaira(value) {
  return naira.format(Number(value));
}

/** A future production channel may use this; Twilio trial mode must not. */
export function renderMeetingSummary(payload) {
  return [
    "Visave Meeting Summary",
    "",
    `Meeting: ${payload.meetingNumber}`,
    `Saved this meeting: ${formatNaira(payload.meetingTotalSavings)}`,
    `Loans disbursed this meeting: ${formatNaira(payload.meetingTotalLoansDisbursed)}`,
    `Group total savings: ${formatNaira(payload.groupTotalSavings)}`,
    `My total savings: ${formatNaira(payload.memberTotalSavings)}`,
    "",
    "Thank you for saving with Visave.",
  ].join("\n");
}
