import "server-only";

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

interface InviteEmailInput {
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
}

/** Table-based and inline-styled so it renders the same in Gmail and Outlook. */
export function renderInviteEmail({ workspaceName, inviterName, acceptUrl }: InviteEmailInput) {
  const workspace = escapeHtml(workspaceName);
  const inviter = escapeHtml(inviterName);
  const url = escapeHtml(acceptUrl);

  const subject = `${inviterName} invited you to ${workspaceName} on maeosan`;

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#f4f0e8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f0e8;padding:40px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5dfd2;border-radius:24px;overflow:hidden;">
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td style="height:12px;background:#f2542d;"></td>
                <td style="height:12px;background:#f5b31b;"></td>
                <td style="height:12px;background:#3355f0;"></td>
                <td style="height:12px;background:#2e9e5b;"></td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 36px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#191713;">
              <p style="margin:0 0 24px;font-size:18px;font-weight:700;letter-spacing:-0.5px;">maeosan</p>
              <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;letter-spacing:-0.8px;">Join ${workspace}</h1>
              <p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#4c473d;">
                ${inviter} invited you to chat with the team at <strong style="color:#191713;">${workspace}</strong>.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 36px 12px;">
              <a href="${url}" style="display:inline-block;background:#191713;color:#f4f0e8;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;padding:14px 26px;border-radius:999px;">Accept invitation</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 36px 36px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#847d6f;">
              The invitation expires in 14 days. If the button doesn't work, paste this link into your browser:<br />
              <a href="${url}" style="color:#3355f0;word-break:break-all;">${url}</a>
            </td>
          </tr>
        </table>
        <p style="margin:20px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:12px;color:#847d6f;">
          Not expecting this? You can safely ignore it.
        </p>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = `${inviterName} invited you to ${workspaceName} on maeosan.

Accept the invitation: ${acceptUrl}

The invitation expires in 14 days. Not expecting this? You can ignore it.`;

  return { subject, html, text };
}
