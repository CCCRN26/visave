import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { getMyMeeting } from "@/modules/member-meetings/member-meeting.service";
import MemberMeetingLiveView from "@/components/member-meeting-live-view";

export default async function MemberMeeting({ params }) {
  const { id, meetingId } = await params;
  const user = await requireAuth();
  const data = await getMyMeeting(id, meetingId, user);
  return <>
    <p><Link href="/my-meetings">â† Meeting History</Link></p>
    <MemberMeetingLiveView groupId={id} meetingId={meetingId} initial={data}/>
  </>;
}
