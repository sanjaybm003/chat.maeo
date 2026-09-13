import type { DeliveryIssue } from "./delivery-issues";

export interface UndeliveredInvite {
  email: string;
  /** The browser turns this into a link on the address maeosan is open at. */
  token: string;
}

export interface InviteReport {
  sent: string[];
  alreadyMembers: string[];
  invalid: string[];
  undelivered: UndeliveredInvite[];
  /** Why emails didn't go out, when some didn't. */
  emailIssue: DeliveryIssue | null;
  /** The email provider's own message behind `emailIssue`, for troubleshooting. */
  emailIssueDetail: string | null;
}
