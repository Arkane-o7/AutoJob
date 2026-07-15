(function (root) {
  "use strict";

  const ApplyOS = root.ApplyOS = root.ApplyOS || {};

  ApplyOS.buildFollowUpReminders = function buildFollowUpReminders(application, appliedAt = new Date()) {
    const base = appliedAt instanceof Date ? appliedAt : new Date(appliedAt);
    return [
      {
        id: ApplyOS.uid("rem"),
        application_id: application.id,
        type: "follow_up",
        due_at: ApplyOS.addDays(base, 7),
        completed_at: null,
        created_at: ApplyOS.nowISO()
      },
      {
        id: ApplyOS.uid("rem"),
        application_id: application.id,
        type: "final_follow_up",
        due_at: ApplyOS.addDays(base, 14),
        completed_at: null,
        created_at: ApplyOS.nowISO()
      }
    ];
  };

  ApplyOS.generateFollowUpDraft = function generateFollowUpDraft(application, profile = {}, type = "follow_up") {
    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Your name";
    const isFinal = type === "final_follow_up";
    const subject = `${isFinal ? "Final follow-up" : "Following up"} — ${application.role} at ${application.company}`;
    const opening = isFinal
      ? `I wanted to send one final follow-up regarding my application for the ${application.role} position at ${application.company}.`
      : `I’m following up on my application for the ${application.role} position at ${application.company}.`;
    const relevance = application.matched_skills?.length
      ? `My experience with ${application.matched_skills.slice(0, 3).join(", ")} aligns especially well with the role.`
      : "I remain very interested in the role and the opportunity to contribute to your team.";
    const body = [
      "Hello hiring team,",
      "",
      opening,
      relevance,
      "",
      "I’d be happy to provide any additional information that would be useful. Thank you for your time and consideration.",
      "",
      "Best,",
      fullName,
      profile.linkedin || profile.portfolio || ""
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();

    return { subject, body, generated_at: ApplyOS.nowISO(), type };
  };

  ApplyOS.generateThankYouDraft = function generateThankYouDraft(application, interview = {}, profile = {}, contact = {}) {
    const fullName = profile.fullName || [profile.firstName, profile.lastName].filter(Boolean).join(" ") || "Your name";
    const greeting = contact.name ? `Hello ${contact.name.split(/\s+/)[0]},` : "Hello,";
    const interviewLabel = String(interview.type || "interview").replace(/_/g, " ");
    const body = [
      greeting,
      "",
      `Thank you for taking the time to speak with me about the ${application.role} position at ${application.company}. I appreciated learning more about the role and the team.`,
      interview.question_notes ? `I especially enjoyed our discussion about ${interview.question_notes.split(/[.\n]/)[0].trim()}.` : `Our ${interviewLabel} conversation reinforced my interest in the opportunity.`,
      "",
      "Please let me know if I can provide any additional information. I look forward to hearing about the next steps.",
      "",
      "Best,",
      fullName,
      profile.linkedin || profile.portfolio || ""
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n").trim();
    return { subject: `Thank you — ${application.role} interview`, body, generated_at: ApplyOS.nowISO(), type: "interview_thank_you" };
  };

  ApplyOS.buildComposeLinks = function buildComposeLinks(draft = {}, recipient = "") {
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(recipient || "").trim()) ? String(recipient).trim() : "";
    const subject = String(draft.subject || "");
    const body = String(draft.body || "");
    const query = (entries) => entries.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
    return {
      gmail: `https://mail.google.com/mail/?${query([["view", "cm"], ["fs", "1"], ["to", email], ["su", subject], ["body", body]])}`,
      outlook: `https://outlook.office.com/mail/deeplink/compose?${query([["to", email], ["subject", subject], ["body", body]])}`,
      mailto: `mailto:${email}?${query([["subject", subject], ["body", body]])}`
    };
  };
})(globalThis);
