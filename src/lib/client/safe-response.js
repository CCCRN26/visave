export async function readActionResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const detail = (await response.text()).trim();
  return {
    error: {
      message: "We couldn't complete this action. Please try again.",
      detail: detail.slice(0, 500),
    },
  };
}
