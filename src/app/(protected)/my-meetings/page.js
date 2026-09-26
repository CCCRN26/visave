import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { listMyMeetings } from "@/modules/member-meetings/member-meeting.service";
import { formatDate } from "@/lib/utils/date";

const modeLabels = { PHYSICAL: "Physical", VIRTUAL: "Virtual", HYBRID: "Hybrid" };

export default async function MyMeetings() {
  const user = await requireAuth();
  const meetings = await listMyMeetings(user);
  return <>
    <h1>Meeting History</h1>
    <p className="muted">Read-only meetings from savings groups linked to your membership.</p>
    <div className="panel table-wrap">
      <table>
        <thead><tr><th>Group</th><th>Meeting</th><th>Date</th><th>Type</th><th>Attendance</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {meetings.map((meeting) => <tr key={meeting.id}>
            <td><strong>{meeting.groupName}</strong><br/><small className="muted">{meeting.groupCode}</small></td>
            <td>#{meeting.meetingNumber}<br/><small className="muted">{meeting.meetingCode}</small></td>
            <td>{formatDate(meeting.meetingDate)}</td>
            <td>{modeLabels[meeting.meetingMode] || "Physical"}</td>
            <td>{meeting.attendanceStatus}</td>
            <td><span className="badge">{meeting.status}</span></td>
            <td><Link href={`/my-groups/${meeting.groupId}/meetings/${meeting.id}`}>Open</Link></td>
          </tr>)}
          {!meetings.length && <tr><td colSpan={7}>No meeting history is available for your linked memberships.</td></tr>}
        </tbody>
      </table>
    </div>
  </>;
}
