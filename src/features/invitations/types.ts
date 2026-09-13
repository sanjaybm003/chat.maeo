export interface UndeliveredInvite {
  email: string;
  link: string;
}

export interface InviteReport {
  sent: string[];
  alreadyMembers: string[];
  invalid: string[];
  undelivered: UndeliveredInvite[];
}
