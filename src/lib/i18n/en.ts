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
    title: "Unlock your dashboard",
    body: "Four quick questions so we can tailor your results. Your 7-day free trial starts now — no card needed.",
    name: "Business name",
    website: "Website",
    serviceArea: "Service area",
    serviceAreaHint: "City or region, e.g. Ottawa, ON",
    category: "Business type",
    categoryHint: "e.g. Collision repair, Plumbing, Metal fabrication",
    goal: {
      label: "What do you want most from your website?",
      calls: "More phone calls",
      form_leads: "More quote requests / form leads",
      walk_ins: "More walk-ins",
      lower_ad_spend: "Spend less on ads",
    },
    adSpend: {
      label: "Roughly how much do you spend on Google Ads per month?",
      none: "Nothing / not running ads",
      under_500: "Under $500",
      "500_2000": "$500 – $2,000",
      "2000_5000": "$2,000 – $5,000",
      over_5000: "Over $5,000",
    },
    manager: {
      label: "Who looks after your website?",
      self: "Me or someone on my team",
      agency: "An agency or freelancer",
      nobody: "Nobody right now",
    },
    submit: "Start my free trial",
    errors: {
      name: "Enter a business name (2–100 characters).",
      website: "Enter a website like example.com.",
      required: "Please answer all four questions.",
    },
  },
  trial: {
    daysLeft: (n: number) => (n === 1 ? "1 day left in your free trial" : `${n} days left in your free trial`),
    addCard: "Add a card",
    lockedTitle: "Your free trial has ended",
    lockedBody:
      "Your dashboard is locked, but nothing has been deleted. Add a card to pick up where you left off. If you don't, your data will be deleted 30 days after your trial ended.",
    lockedMember: "Ask the owner of this business to add a card to unlock the dashboard.",
    billingSoon: "Card payments are coming soon. Contact us and we'll unlock your account.",
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
