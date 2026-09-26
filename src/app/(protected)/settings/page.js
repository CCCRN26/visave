import { requireAuth } from "@/lib/auth/session";
import { getGoogleConnectionStatus } from "@/modules/google-integration/google-connection.service";
import { getGoogleMeetIdentity } from "@/modules/users/google-meet-identity.service";
import GoogleMeetIntegrationPanel from "@/components/google-meet-integration-panel";
import GoogleMeetEmailPanel from "@/components/google-meet-email-panel";

export default async function Settings() {
  const user = await requireAuth();
  const canManageGoogle = user.permissions?.includes("organization.manage");
  const [googleStatus, identity] = await Promise.all([
    canManageGoogle ? getGoogleConnectionStatus(user.organization_id) : Promise.resolve(null),
    getGoogleMeetIdentity(user),
  ]);

  return <>
    <h1>Settings</h1>
    <div className="panel" style={{padding:24}}>
      <h2>Appearance</h2>
      <p className="muted">The interface follows the selected light or dark browser theme.</p>
    </div>
    <GoogleMeetEmailPanel initialEmail={identity.googleMeetEmail}/>
    {canManageGoogle && <GoogleMeetIntegrationPanel status={googleStatus}/>}
  </>;
}
