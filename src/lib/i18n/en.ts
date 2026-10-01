// All user-facing text lives here so a French translation can be added for
// Quebec (PRD §10) by providing a second file with the same shape.
export const en = {
  appName: "TorqueRank",
  common: {
    signOut: "Sign out",
    save: "Save",
    cancel: "Cancel",
    owner: "Owner",
    member: "Member",
  },
  login: {
    title: "Sign in to TorqueRank",
    emailLabel: "Work email",
    emailButton: "Email me a sign-in link",
    or: "or",
    googleButton: "Continue with Google",
    googleNote: "Google sign-in only shares your name and email with us.",
    checkTitle: "Check your email",
    checkBody: "We sent you a sign-in link. It works once and expires in 15 minutes.",
    errors: {
      invalidEmail: "Enter a valid email address.",
      rateLimited: "Too many sign-in emails. Try again in an hour.",
      generic: "Sign-in didn't work. Try again, or use another method.",
      accountNotLinked:
        "This email already signed in another way. Use the same method as before (email link or Google).",
      linkExpired: "That sign-in link is invalid or has expired. Request a new one.",
    },
  },
  onboarding: {
    title: "Set up your business",
    body: "Tell us about the business you want to grow. You can change this later.",
    name: "Business name",
    website: "Website (optional)",
    serviceArea: "Service area (optional)",
    serviceAreaHint: "City or region, e.g. Ottawa, ON",
    category: "Business type (optional)",
    categoryHint: "e.g. Collision repair, Plumbing, Metal fabrication",
    submit: "Create",
    errors: {
      name: "Enter a business name (2–100 characters).",
      website: "Enter a website like example.com.",
    },
  },
  app: {
    overviewTitle: "Overview",
    overviewBody: "Your dashboard will appear here once your data is connected.",
    switchOrg: "Switch business",
    nav: { overview: "Overview", team: "Team" },
  },
  team: {
    title: "Team",
    members: "Members",
    you: "(you)",
    remove: "Remove",
    makeOwner: "Make owner",
    makeMember: "Make member",
    invitesTitle: "Pending invites",
    noInvites: "No pending invites.",
    revoke: "Revoke",
    expires: "Expires",
    inviteTitle: "Invite a teammate",
    inviteBody:
      "Invite your web agency or anyone who manages your Google Search Console or Analytics. The link works once and expires in 7 days.",
    inviteEmail: "Email",
    inviteRole: "Role",
    inviteSubmit: "Send invite",
    inviteSent: "Invite sent.",
    ownersOnly: "Only owners can manage the team.",
    errors: {
      invalidEmail: "Enter a valid email address.",
      rateLimited: "Daily invite limit reached. Try again tomorrow.",
      alreadyMember: "That person is already a member.",
      lastOwner: "A business needs at least one owner.",
      emailFailed: "The invite email couldn't be sent, so the invite was cancelled. Try again later.",
    },
  },
  invite: {
    title: "Join a business on TorqueRank",
    body: (org: string) => `You've been invited to join ${org}.`,
    signedInAs: (email: string) => `Signed in as ${email}.`,
    accept: "Accept invite",
    invalid:
      "This invite is invalid, expired, already used, or was sent to a different email address than the one you're signed in with.",
    emailSubject: (org: string) => `You're invited to ${org} on TorqueRank`,
    emailBody: (org: string, url: string) =>
      `You've been invited to join ${org} on TorqueRank.\n\nAccept the invite:\n${url}\n\nThis link works once and expires in 7 days. If you weren't expecting it, ignore this email.`,
  },
} as const;

export const t = en;
