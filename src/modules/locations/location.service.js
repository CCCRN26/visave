import { ValidationError } from "@/lib/errors";
import * as repository from "./location.repository.js";

export async function validateLocationHierarchy(client, { stateId, lgaId, communityId }) {
  if (!stateId || !(await repository.findState(client, stateId))) throw new ValidationError("Selected State does not exist.");
  if (lgaId) {
    const lga = await repository.findLga(client, lgaId);
    if (!lga || lga.state_id !== stateId) throw new ValidationError("Selected LGA does not belong to the selected State.");
  }
  if (communityId) {
    const community = await repository.findCommunity(client, communityId);
    if (!lgaId || !community || community.lga_id !== lgaId) throw new ValidationError("Selected Community does not belong to the selected LGA.");
  }
  return { stateId, lgaId: lgaId || null, communityId: communityId || null };
}
