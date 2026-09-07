export async function findState(client, stateId) {
  return (await client.query("SELECT id,name,code,country_code FROM states WHERE id=$1", [stateId])).rows[0];
}

export async function findLga(client, lgaId) {
  return (await client.query("SELECT id,state_id,name,code FROM lgas WHERE id=$1", [lgaId])).rows[0];
}

export async function findCommunity(client, communityId) {
  return (await client.query("SELECT id,lga_id,name FROM communities WHERE id=$1", [communityId])).rows[0];
}
